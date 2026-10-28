import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import type { OutgoingMail } from '../../alerts/email.service.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

vi.mock('@clerk/express', () => ({ clerkClient: { users: { getUser: vi.fn() } } }));

// Settings are read from a real integrations.json under a temp HOME.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-notices-digest-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { mockSendMail, mockSendSlackText, mockTestEmailConnection } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockSendSlackText: vi.fn(),
  mockTestEmailConnection: vi.fn(),
}));

vi.mock('../../outcomes/edr.js', () => ({
  fetchEdrDocs: async () => ({ status: 'not_configured', docs: new Map() }),
}));

vi.mock('../../alerts/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/email.service.js')>();
  return { ...actual, sendMail: mockSendMail, testEmailConnection: mockTestEmailConnection };
});

vi.mock('../../alerts/slack.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/slack.service.js')>();
  return { ...actual, sendSlackText: mockSendSlackText };
});

const { processAdvanceDigests } = await import('../digest.service.js');
const { processNotices, runWithNotice, retryBackoffMs } = await import('../notices.service.js');
const { resetExpireThrottle } = await import('../../agent/tasks.service.js');

// Wednesday 2026-10-28 09:00 in America/Santo_Domingo (AST, UTC-4).
const NOW = new Date('2026-10-28T13:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const MIN = 60_000;
const TZ = 'America/Santo_Domingo';
const RECIPIENTS = ['a@x.com', 'b@x.com'];

const HOME = os.homedir();
const SETTINGS_DIR = path.join(HOME, '.projectachilles');

type NoticeSection = { enabled?: boolean; advance?: boolean; recipients?: string[]; tz?: string };

function noticeSection(s: NoticeSection = {}) {
  return {
    enabled: s.enabled ?? true,
    recipients: s.recipients ?? RECIPIENTS,
    lead_minutes: 0,
    max_wait_minutes: 60,
    pickup_window_minutes: 120,
    send_finished: false,
    advance_digest_enabled: s.advance ?? true,
    digest_timezone: s.tz ?? TZ,
  };
}

function writeSettings(opts: NoticeSection & { smtp?: boolean; orgs?: Record<string, NoticeSection> } = {}) {
  const { smtp = true, orgs } = opts;
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SETTINGS_DIR, 'integrations.json'),
    JSON.stringify({
      alerts: {
        thresholds: { enabled: false },
        cooldown_minutes: 15,
        ...(smtp
          ? {
              email: {
                smtp_host: 'smtp.example.test',
                smtp_port: 587,
                smtp_secure: false,
                smtp_user: 'user',
                smtp_pass: 'pass',
                from_address: 'pa@example.test',
                recipients: [],
                configured: false,
                enabled: true,
              },
            }
          : {}),
      },
      pre_execution_notices: noticeSection(opts),
      ...(orgs
        ? {
            orgs: Object.fromEntries(
              Object.entries(orgs).map(([id, s]) => [id, { pre_execution_notices: noticeSection(s) }]),
            ),
          }
        : {}),
    }),
  );
}

function insertSchedule(s: {
  id: string;
  name?: string;
  orgId?: string;
  agentIds: string[];
  type?: 'once' | 'daily' | 'weekly' | 'monthly';
  config: Record<string, unknown>;
  timezone?: string;
  agentNextRuns?: Record<string, string> | null;
  status?: string;
}) {
  testDb
    .prepare(`
      INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name, metadata,
        schedule_type, schedule_config, timezone, next_run_at, status, created_by, agent_next_runs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      s.id,
      s.name ?? `Schedule ${s.id}`,
      JSON.stringify(s.agentIds),
      s.orgId ?? 'org-001',
      `uuid-${s.id}`,
      `Test for ${s.id}`,
      'test.exe',
      JSON.stringify({ techniques: ['T1003'], tactics: ['credential-access'] }),
      s.type ?? 'weekly',
      JSON.stringify(s.config),
      s.timezone ?? TZ,
      null,
      s.status ?? 'active',
      'alice',
      s.agentNextRuns ? JSON.stringify(s.agentNextRuns) : null,
    );
}

/** Weekly per-machine schedule on Thursdays (tomorrow relative to NOW). */
function thursdaySchedule(id = 's1', extra: Partial<Parameters<typeof insertSchedule>[0]> = {}) {
  insertSchedule({
    id,
    agentIds: ['a1', 'a2'],
    config: { time: '10:00', days: [4], randomize_mode: 'per_machine' },
    ...extra,
  });
}

function digestRows(): Array<Record<string, unknown>> {
  return testDb.prepare('SELECT * FROM notice_digests ORDER BY org_id').all() as Array<Record<string, unknown>>;
}

function insertDigestRow(r: Record<string, unknown>) {
  const row = {
    id: 'd-existing',
    org_id: 'org-001',
    digest_date: '2026-10-28',
    run_date: '2026-10-29',
    timezone: TZ,
    state: 'sending',
    attempts: 0,
    created_at: at(-20 * MIN).toISOString(),
    claim_at: null,
    last_attempt_at: null,
    ...r,
  };
  testDb
    .prepare(`
      INSERT INTO notice_digests (id, org_id, digest_date, run_date, timezone, state, attempts, created_at, claim_at, last_attempt_at)
      VALUES (@id, @org_id, @digest_date, @run_date, @timezone, @state, @attempts, @created_at, @claim_at, @last_attempt_at)
    `)
    .run(row);
}

function mailAt(i: number): OutgoingMail {
  return mockSendMail.mock.calls[i][1] as OutgoingMail;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('processAdvanceDigests', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    testDb = createTestDatabase();
    resetExpireThrottle();
    const hb = at(-30_000).toISOString();
    insertTestAgent(testDb, { id: 'a1', hostname: 'host-alpha', last_heartbeat: hb });
    insertTestAgent(testDb, { id: 'a2', hostname: 'host-bravo', os: 'windows', last_heartbeat: at(-60 * MIN).toISOString() });
    writeSettings();
    mockSendMail.mockImplementation(async (_s: unknown, m: OutgoingMail) => ({ accepted: [...m.to], rejected: [] }));
    mockSendSlackText.mockResolvedValue(undefined);
    mockTestEmailConnection.mockResolvedValue({ success: true, message: 'ok' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  it('does nothing before 09:00 in the digest timezone', async () => {
    thursdaySchedule();
    const r = await processAdvanceDigests(new Date('2026-10-28T12:59:00.000Z'));
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()).toHaveLength(0);
    expect(r).toEqual({ sent: 0, empty: 0, failed: 0, skipped: 1 });
  });

  it('sends one digest listing the window and both hosts, never the per-machine slot times', async () => {
    thursdaySchedule('s1', {
      name: 'Thursday sweep',
      agentNextRuns: { a1: '2026-10-29T14:43:00.000Z', a2: '2026-10-29T19:17:00.000Z' },
    });
    const r = await processAdvanceDigests(NOW);
    expect(r.sent).toBe(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mailAt(0);
    expect(mail.to).toEqual(RECIPIENTS);
    expect(mail.subject).toBe(
      '[ProjectAchilles] Security testing scheduled tomorrow, Thu 2026-10-29 — 1 test on 2 hosts',
    );
    expect(mail.html).toContain('Thursday sweep');
    expect(mail.html).toContain('2026-10-29 09:00 AST (13:00 UTC)');
    expect(mail.html).toContain('2026-10-29 17:00 AST (21:00 UTC)');
    expect(mail.html).toContain('host-alpha');
    expect(mail.html).toContain('host-bravo');
    for (const leaked of ['14:43', '10:43', '19:17', '15:17']) expect(mail.html).not.toContain(leaked);

    const ics = mail.attachments?.find((a) => a.filename.endsWith('.ics'));
    expect(ics?.contentType).toContain('text/calendar');
    expect(ics?.contentType).toContain('method=PUBLISH');
    expect(String(ics?.content)).toContain('UID:digest-s1-2026-10-29@projectachilles');
    expect(String(ics?.content)).toContain('SUMMARY:Security testing: Thursday sweep');
    expect(mail.attachments?.some((a) => a.filename.endsWith('.csv'))).toBe(false);

    expect(digestRows()[0]).toMatchObject({
      org_id: 'org-001',
      digest_date: '2026-10-28',
      run_date: '2026-10-29',
      timezone: TZ,
      state: 'sent',
      occurrence_count: 1,
      host_count: 2,
      recipients: JSON.stringify(RECIPIENTS),
      sent_at: NOW.toISOString(),
      last_error: null,
    });
  });

  it('a second pass the same day sends nothing more', async () => {
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    const r = await processAdvanceDigests(at(5 * MIN));
    expect(r).toEqual({ sent: 0, empty: 0, failed: 0, skipped: 1 });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(digestRows()).toHaveLength(1);
    expect(digestRows()[0].state).toBe('sent');
  });

  it('reclaims a stale sending row (claimed 11 minutes ago) and sends', async () => {
    thursdaySchedule();
    insertDigestRow({ claim_at: at(-11 * MIN).toISOString() });
    await processAdvanceDigests(NOW);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(digestRows()[0]).toMatchObject({ id: 'd-existing', state: 'sent' });
  });

  it('reclaims a sending row whose claim is in the future (clock stepped back)', async () => {
    thursdaySchedule();
    insertDigestRow({ claim_at: at(60 * MIN).toISOString() });
    await processAdvanceDigests(NOW);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(digestRows()[0]).toMatchObject({ id: 'd-existing', state: 'sent' });
  });

  it('counts distinct hostnames, not agent ids, in host_count', async () => {
    insertTestAgent(testDb, { id: 'a3', hostname: 'host-alpha', last_heartbeat: NOW.toISOString() });
    thursdaySchedule('s1', { agentIds: ['a1', 'a2', 'a3'] });
    await processAdvanceDigests(NOW);
    expect(mailAt(0).subject).toContain('on 2 hosts');
    expect(digestRows()[0].host_count).toBe(2);
  });

  it('skips a fresh sending row (claimed 2 minutes ago)', async () => {
    thursdaySchedule();
    insertDigestRow({ claim_at: at(-2 * MIN).toISOString() });
    const r = await processAdvanceDigests(NOW);
    expect(r.skipped).toBe(1);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()[0]).toMatchObject({ state: 'sending', claim_at: at(-2 * MIN).toISOString() });
  });

  it('records a failed send and retries only after the backoff', async () => {
    thursdaySchedule();
    mockSendMail.mockRejectedValueOnce(new Error('Connection timeout'));
    const r1 = await processAdvanceDigests(NOW);
    expect(r1.failed).toBe(1);
    expect(digestRows()[0]).toMatchObject({
      state: 'failed',
      attempts: 1,
      last_error: 'Connection timeout',
      last_attempt_at: NOW.toISOString(),
    });

    await processAdvanceDigests(at(30_000));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(digestRows()[0].state).toBe('failed');

    const r3 = await processAdvanceDigests(at(retryBackoffMs(1)));
    expect(r3.sent).toBe(1);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(digestRows()[0]).toMatchObject({ state: 'sent', attempts: 1 });
  });

  it('records the rejected recipients but counts a partly accepted digest as sent', async () => {
    thursdaySchedule();
    mockSendMail.mockResolvedValueOnce({ accepted: ['a@x.com'], rejected: ['b@x.com'] });
    await processAdvanceDigests(NOW);
    expect(digestRows()[0]).toMatchObject({ state: 'sent', last_error: 'rejected: b@x.com' });
  });

  it('fails when no recipient is accepted', async () => {
    thursdaySchedule();
    mockSendMail.mockResolvedValueOnce({ accepted: [], rejected: ['a@x.com', 'b@x.com'] });
    await processAdvanceDigests(NOW);
    expect(digestRows()[0]).toMatchObject({ state: 'failed', attempts: 1, last_error: 'rejected: a@x.com, b@x.com' });
  });

  it('fails without sending when SMTP is not usable', async () => {
    writeSettings({ smtp: false });
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()[0]).toMatchObject({ state: 'failed', last_error: 'SMTP email is not configured' });
  });

  it('fails without sending when there are no recipients', async () => {
    writeSettings({ recipients: [] });
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()[0]).toMatchObject({ state: 'failed', last_error: 'No recipients configured' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[Digest]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('org-001'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No recipients configured'));
  });

  it('writes an empty row and sends nothing when nothing is due tomorrow', async () => {
    // Fridays only.
    insertSchedule({ id: 's-fri', agentIds: ['a1'], config: { time: '10:00', days: [5] } });
    const r = await processAdvanceDigests(NOW);
    expect(r.empty).toBe(1);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()[0]).toMatchObject({ state: 'empty', run_date: '2026-10-29' });
  });

  it('writes an empty row when every agent of the only schedule is decommissioned', async () => {
    testDb.prepare(`UPDATE agents SET status = 'decommissioned'`).run();
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()[0].state).toBe('empty');
  });

  it('leaves decommissioned agents out of the hosts list', async () => {
    testDb.prepare(`UPDATE agents SET status = 'decommissioned' WHERE id = 'a2'`).run();
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    expect(mailAt(0).html).toContain('host-alpha');
    expect(mailAt(0).html).not.toContain('host-bravo');
    expect(digestRows()[0].host_count).toBe(1);
  });

  it('ignores paused schedules', async () => {
    thursdaySchedule('s1', { status: 'paused' });
    await processAdvanceDigests(NOW);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()).toHaveLength(0);
  });

  it('does nothing while notices are off, even with the digest switched on', async () => {
    writeSettings({ enabled: false, advance: true });
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()).toHaveLength(0);
  });

  it('does nothing while the digest is off', async () => {
    writeSettings({ advance: false });
    thursdaySchedule();
    await processAdvanceDigests(NOW);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(digestRows()).toHaveLength(0);
  });

  it('sends one digest per org, each with only its own schedules', async () => {
    writeSettings({ orgs: { 'org-a': { recipients: ['sec-a@x.com'] } } });
    insertTestAgent(testDb, { id: 'b1', org_id: 'org-b', hostname: 'host-b1', last_heartbeat: NOW.toISOString() });
    thursdaySchedule('sa', { name: 'Alpha org schedule', orgId: 'org-a', agentIds: ['a1'] });
    thursdaySchedule('sb', { name: 'Bravo org schedule', orgId: 'org-b', agentIds: ['b1'] });

    const r = await processAdvanceDigests(NOW);
    expect(r.sent).toBe(2);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    const mails = [mailAt(0), mailAt(1)];
    const a = mails.find((m) => m.html.includes('Alpha org schedule'))!;
    const b = mails.find((m) => m.html.includes('Bravo org schedule'))!;
    expect(a.html).not.toContain('Bravo org schedule');
    expect(b.html).not.toContain('Alpha org schedule');
    expect(a.to).toEqual(['sec-a@x.com']);
    expect(b.to).toEqual(RECIPIENTS);
    expect(digestRows().map((d) => [d.org_id, d.state])).toEqual([
      ['org-a', 'sent'],
      ['org-b', 'sent'],
    ]);
  });

  it('skips a malformed schedule and still sends the rest of the digest', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertSchedule({ id: 's-bad', name: 'Broken schedule', agentIds: ['a1'], config: { days: [4] } });
    thursdaySchedule('s-good', { name: 'Good schedule' });
    await processAdvanceDigests(NOW);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mailAt(0).html).toContain('Good schedule');
    expect(mailAt(0).html).not.toContain('Broken schedule');
    expect(digestRows()[0].state).toBe('sent');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('s-bad'), expect.anything());
  });

  it("one org's failure does not stop another org's digest", async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    insertTestAgent(testDb, { id: 'b1', org_id: 'org-b', hostname: 'host-b1', last_heartbeat: NOW.toISOString() });
    thursdaySchedule('sa', { orgId: 'org-a', agentIds: ['a1'] });
    thursdaySchedule('sb', { orgId: 'org-b', agentIds: ['b1'] });
    mockSendMail.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const r = await processAdvanceDigests(NOW);
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(digestRows().map((d) => d.state).sort()).toEqual(['failed', 'sent']);
    err.mockRestore();
  });

  it('attaches the full host list as CSV above 50 distinct hosts', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      const id = `bulk-${i}`;
      insertTestAgent(testDb, { id, hostname: `bulk-host-${i}`, last_heartbeat: NOW.toISOString() });
      ids.push(id);
    }
    thursdaySchedule('s-bulk', { agentIds: ids });
    await processAdvanceDigests(NOW);
    const csv = mailAt(0).attachments?.find((a) => a.filename.endsWith('.csv'));
    expect(csv?.contentType).toContain('text/csv');
    expect(String(csv?.content)).toContain('bulk-host-50');
    expect(digestRows()[0].host_count).toBe(51);
  });

  it('shares an in-flight pass instead of starting a second one', async () => {
    thursdaySchedule();
    const p1 = processAdvanceDigests(NOW);
    const p2 = processAdvanceDigests(NOW);
    expect(p2).toBe(p1);
    await p1;
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('a hung digest send never delays the notice gate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    thursdaySchedule();
    let releaseDigest: (v: { accepted: string[]; rejected: string[] }) => void = () => {};
    mockSendMail.mockImplementation((_s: unknown, m: OutgoingMail) => {
      if (m.subject.includes('scheduled tomorrow')) {
        return new Promise((resolve) => {
          releaseDigest = resolve;
        });
      }
      return Promise.resolve({ accepted: [...m.to], rejected: [] });
    });

    const digest = processAdvanceDigests(NOW);
    await flush();
    expect(digestRows()[0].state).toBe('sending');

    const noticeId = runWithNotice({ type: 'run_now', createdBy: 'alice', orgId: null }, (nid) => {
      insertTestTask(testDb, { id: 't1', agent_id: 'a1' });
      testDb.prepare('UPDATE tasks SET notice_id = ? WHERE id = ?').run(nid, 't1');
      return nid!;
    });
    await processNotices(NOW);
    await flush();
    const notice = testDb.prepare('SELECT state FROM run_notices WHERE id = ?').get(noticeId) as { state: string };
    expect(notice.state).toBe('sent');
    expect(digestRows()[0].state).toBe('sending');

    // Let the hung digest finish so the in-flight guard is released.
    releaseDigest({ accepted: [...RECIPIENTS], rejected: [] });
    await digest;
    expect(digestRows()[0].state).toBe('sent');
  });
});
