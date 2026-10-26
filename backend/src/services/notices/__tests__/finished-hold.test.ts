import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import type { TaskOutcomeRow } from '../notices.repo.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/database.js')>()),
  getDatabase: () => testDb,
}));
vi.mock('../../agent/test-catalog.service.js', () => ({ getTestMetadata: () => null }));

// Settings are read from a real integrations.json under a temp HOME.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-notices-finished-hold-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { mockSendMail, edrOn } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  edrOn: { value: true },
}));
vi.mock('../../outcomes/edr.js', () => ({ fetchEdrDocs: async () => ({ status: 'not_configured', docs: new Map() }) }));
vi.mock('../../edr/agent-kill-reconcile.service.js', () => ({ isAnyEdrConfigured: () => edrOn.value }));
vi.mock('../../alerts/email.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../alerts/email.service.js')>()),
  sendMail: mockSendMail,
}));
vi.mock('../../alerts/slack.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../alerts/slack.service.js')>()),
  sendSlackText: vi.fn(async () => true),
}));

const { finishedHoldActive } = await import('../notices.repo.js');
const { processNotices } = await import('../notices.service.js');

const NOW = new Date('2026-10-26T16:30:00.000Z');
const MIN = 60_000;
const OFFLINE = 'Agent went offline during execution';
const OVERDUE = 'Task exceeded execution timeout';
const RECIPIENTS = ['soc@x.com'];
const SETTINGS_DIR = path.join(os.homedir(), '.projectachilles');

/** SQLite datetime('now') form, as the watchdog writes completed_at. */
const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
const ago = (ms: number) => sqlTime(new Date(NOW.getTime() - ms));

const TERMINATION = {
  vendors: ['sentinelone'],
  alert_ids: ['s1-threat-1'],
  killed_at: '2026-10-26T16:06:32.000Z',
  reconciled_at: '2026-10-26T16:12:00.000Z',
};

function outcome(o: Partial<TaskOutcomeRow> & { error?: string } = {}): TaskOutcomeRow {
  const { error = OFFLINE, ...rest } = o;
  return {
    id: 'k1',
    status: 'failed',
    result: JSON.stringify({ error, exit_code: -1 }),
    assigned_at: ago(20 * MIN),
    completed_at: ago(5 * MIN),
    original_task_id: null,
    retry_count: 0,
    created_at: ago(25 * MIN),
    category: 'intel-driven',
    es_ingested: 0,
    ...rest,
  };
}

describe('finishedHoldActive', () => {
  it('holds Finished while a cut-off task awaits reconciliation', () => {
    expect(finishedHoldActive([outcome()], NOW, true)).toBe(true);
    expect(finishedHoldActive([outcome({ error: OVERDUE })], NOW, true)).toBe(true);
  });

  it('releases the hold after 15 minutes', () => {
    expect(finishedHoldActive([outcome({ completed_at: ago(15 * MIN) })], NOW, true)).toBe(false);
    expect(finishedHoldActive([outcome({ completed_at: ago(15 * MIN - 1000) })], NOW, true)).toBe(true);
  });

  it('does not hold without an EDR', () => {
    expect(finishedHoldActive([outcome()], NOW, false)).toBe(false);
  });

  it('does not hold once reconciled', () => {
    expect(finishedHoldActive([outcome({ es_ingested: 1 })], NOW, true)).toBe(false);
  });

  it('does not hold for agent-reported failures', () => {
    expect(finishedHoldActive([outcome({ error: 'binary not found' })], NOW, true)).toBe(false);
    expect(finishedHoldActive([outcome({ status: 'completed', result: JSON.stringify({ exit_code: 101 }) })], NOW, true)).toBe(false);
  });

  it('evaluates only the latest attempt: a completed retry of a cut-off original does not hold', () => {
    const original = outcome({ id: 'k1' });
    const retry = outcome({ id: 'k2', status: 'completed', result: JSON.stringify({ exit_code: 101 }), original_task_id: 'k1', retry_count: 1 });
    expect(finishedHoldActive([original, retry], NOW, true)).toBe(false);
    expect(finishedHoldActive([original], NOW, true)).toBe(true);
  });

  it('does not hold for tasks the reconciler never picks up (cyber-hygiene, never assigned)', () => {
    expect(finishedHoldActive([outcome({ category: 'cyber-hygiene' })], NOW, true)).toBe(false);
    expect(finishedHoldActive([outcome({ assigned_at: null })], NOW, true)).toBe(false);
  });
});

describe('finishedPass and EDR-killed runs', () => {
  function writeSettings() {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SETTINGS_DIR, 'integrations.json'), JSON.stringify({
      alerts: {
        thresholds: { enabled: false },
        cooldown_minutes: 15,
        email: {
          smtp_host: 'smtp.example.test', smtp_port: 587, smtp_secure: false, smtp_user: 'user', smtp_pass: 'pass',
          from_address: 'pa@example.test', recipients: [], configured: true, enabled: true,
        },
      },
      pre_execution_notices: {
        enabled: true, recipients: RECIPIENTS, lead_minutes: 5, max_wait_minutes: 60, pickup_window_minutes: 120,
        send_finished: true, last_smtp_check_at: NOW.toISOString(), last_smtp_check_ok: true, last_smtp_check_message: 'ok',
      },
    }));
  }

  /** A sent run notice whose pickup deadline passed a minute ago. */
  function insertSentNotice(id: string) {
    const deadline = NOW.getTime() - MIN;
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, schedule_ids, timezone, announced_agent_ids, created_by,
        created_at, recipients, sent_at, release_at, pickup_deadline, window_end, finished_attempts)
      VALUES (?, 'run', 'sent', 'run_now', '[]', 'UTC', '[]', 'alice', ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id,
      new Date(deadline - 130 * MIN).toISOString(),
      JSON.stringify(RECIPIENTS),
      new Date(deadline - 125 * MIN).toISOString(),
      new Date(deadline - 120 * MIN).toISOString(),
      new Date(deadline).toISOString(),
      new Date(deadline + 5 * MIN).toISOString(),
    );
  }

  function linkTask(id: string, noticeId: string, v: { status: string; result: object; completedAt: string; esIngested?: number }) {
    insertTestTask(testDb, { id, agent_id: 'agent-001', assigned_at: ago(40 * MIN) });
    testDb
      .prepare('UPDATE tasks SET notice_id = ?, status = ?, result = ?, completed_at = ?, es_ingested = ? WHERE id = ?')
      .run(noticeId, v.status, JSON.stringify(v.result), v.completedAt, v.esIngested ?? 0, id);
  }

  const notice = (id: string) =>
    testDb.prepare('SELECT finished_attempts, finished_sent_at FROM run_notices WHERE id = ?').get(id) as {
      finished_attempts: number;
      finished_sent_at: string | null;
    };

  function finishedMails() {
    return mockSendMail.mock.calls
      .map((c) => c[1] as { subject: string; html: string })
      .filter((m) => m.subject.includes('finished'));
  }

  function cell(html: string, label: string): number {
    const m = new RegExp(`>(\\d+)</div><div[^>]*>${label}</div>`).exec(html);
    if (!m) throw new Error(`no ${label} cell`);
    return Number(m[1]);
  }

  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    fs.rmSync(SETTINGS_DIR, { recursive: true, force: true });
    writeSettings();
    mockSendMail.mockReset();
    mockSendMail.mockImplementation(async (_cfg: unknown, mail: { to: string[] }) => ({ accepted: mail.to, rejected: [] }));
    edrOn.value = true;
  });

  afterAll(() => {
    fs.rmSync(path.dirname(SETTINGS_DIR), { recursive: true, force: true });
  });

  it('finishedPass skips a held notice without counting an attempt', async () => {
    insertSentNotice('n1');
    linkTask('k1', 'n1', { status: 'failed', result: { error: OFFLINE, exit_code: -1 }, completedAt: ago(5 * MIN) });
    const r = await processNotices(NOW);
    expect(r.finished).toBe(0);
    expect(finishedMails()).toHaveLength(0);
    expect(notice('n1')).toEqual({ finished_attempts: 0, finished_sent_at: null });
  });

  it('sends as today once the 15 minutes have passed', async () => {
    insertSentNotice('n1');
    linkTask('k1', 'n1', { status: 'failed', result: { error: OFFLINE, exit_code: -1 }, completedAt: ago(16 * MIN) });
    expect((await processNotices(NOW)).finished).toBe(1);
    expect(cell(finishedMails()[0].html, 'Not run')).toBe(1);
  });

  it('does not wait when no EDR is configured', async () => {
    edrOn.value = false;
    insertSentNotice('n1');
    linkTask('k1', 'n1', { status: 'failed', result: { error: OFFLINE, exit_code: -1 }, completedAt: ago(5 * MIN) });
    expect((await processNotices(NOW)).finished).toBe(1);
  });

  it('Finished counts a reconciled kill as protected', async () => {
    insertSentNotice('n1');
    linkTask('k1', 'n1', {
      status: 'failed',
      result: { error: OFFLINE, exit_code: -1, edr_terminated: TERMINATION },
      completedAt: ago(5 * MIN),
      esIngested: 1,
    });
    expect((await processNotices(NOW)).finished).toBe(1);
    const html = finishedMails()[0].html;
    expect(cell(html, 'Protected')).toBe(1);
    expect(cell(html, 'Not run')).toBe(0);
    expect(html).toContain('Stopped by SentinelOne: the EDR terminated the agent and the test. Stages not reported. 1 run counted as Protected.');
  });
});
