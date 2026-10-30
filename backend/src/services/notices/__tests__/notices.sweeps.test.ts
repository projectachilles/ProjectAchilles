import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

// Settings are read from a real integrations.json under a temp HOME.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-notices-sweeps-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { mockSendMail, mockSendSlackText, mockTestEmailConnection, mockFetchEdrDocs } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockSendSlackText: vi.fn(),
  mockTestEmailConnection: vi.fn(),
  mockFetchEdrDocs: vi.fn(async (_ids: string[]): Promise<{ status: 'ok' | 'unavailable' | 'not_configured'; docs: Map<string, Record<string, unknown>> }> =>
    ({ status: 'not_configured', docs: new Map() })),
}));

vi.mock('../../outcomes/edr.js', () => ({ fetchEdrDocs: mockFetchEdrDocs }));

vi.mock('../../alerts/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/email.service.js')>();
  return { ...actual, sendMail: mockSendMail, testEmailConnection: mockTestEmailConnection };
});

vi.mock('../../alerts/slack.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/slack.service.js')>();
  return { ...actual, sendSlackText: mockSendSlackText };
});

const {
  processNotices,
  releaseWithoutNotice,
  getNoticeStatus,
  listNotices,
  retryBackoffMs,
} = await import('../notices.service.js');
const { getNoticeSummaries } = await import('../notices.repo.js');
const { classifyOutcome } = await import('../render.js');
const { getNextTask, getPendingIngestionTasks, resetExpireThrottle } = await import('../../agent/tasks.service.js');
const { IntegrationsSettingsService } = await import('../../integrations/settings.js');

// Friday, inside the 09:00-17:00 weekday window in UTC.
const NOW = new Date('2026-10-23T12:00:00.000Z');
/** Legacy single-org mode: every notice. */
const ALL = { kind: 'all' } as const;
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const RECIPIENTS = ['a@x.com', 'b@x.com'];

const NOT_DELIVERED = 'Not run: notice not delivered';
const OFFLINE = 'Not run: host offline during notice window';

const HOME = os.homedir();
const SETTINGS_DIR = path.join(HOME, '.projectachilles');

function writeSettings(
  opts: { enabled?: boolean; slack?: boolean; sendFinished?: boolean; notices?: Record<string, unknown> } = {},
) {
  const { enabled = true, slack = true, sendFinished = true, notices = {} } = opts;
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SETTINGS_DIR, 'integrations.json'),
    JSON.stringify({
      alerts: {
        thresholds: { enabled: false },
        cooldown_minutes: 15,
        email: {
          smtp_host: 'smtp.example.test',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'user',
          smtp_pass: 'pass',
          from_address: 'pa@example.test',
          recipients: [],
          configured: true,
          enabled: true,
        },
        ...(slack
          ? { slack: { webhook_url: 'https://hooks.slack.test/abc', configured: true, enabled: true } }
          : {}),
      },
      pre_execution_notices: {
        enabled,
        recipients: RECIPIENTS,
        lead_minutes: 5,
        max_wait_minutes: 60,
        pickup_window_minutes: 120,
        send_finished: sendFinished,
        // Fresh SMTP check by default, so the daily check stays out of the way.
        last_smtp_check_at: NOW.toISOString(),
        last_smtp_check_ok: true,
        last_smtp_check_message: 'ok',
        ...notices,
      },
    }),
  );
}

function insertNotice(id: string, extra: Record<string, unknown> = {}) {
  const row = {
    id,
    kind: 'run',
    state: 'pending',
    source_type: 'run_now',
    schedule_ids: '[]',
    schedule_id: null,
    window_date: null,
    timezone: 'UTC',
    announced_agent_ids: '[]',
    day_window_start: null,
    day_window_end: null,
    created_by: 'alice',
    created_at: at(-MIN).toISOString(),
    recipients: JSON.stringify(RECIPIENTS),
    claim_at: null,
    sent_at: null,
    release_at: null,
    pickup_deadline: null,
    window_end: null,
    finished_attempts: 0,
    ...extra,
  };
  testDb.prepare(`
    INSERT INTO run_notices (id, kind, state, source_type, schedule_ids, schedule_id, window_date, timezone,
      announced_agent_ids, day_window_start, day_window_end, created_by, created_at, recipients, claim_at,
      sent_at, release_at, pickup_deadline, window_end, finished_attempts)
    VALUES (@id, @kind, @state, @source_type, @schedule_ids, @schedule_id, @window_date, @timezone,
      @announced_agent_ids, @day_window_start, @day_window_end, @created_by, @created_at, @recipients, @claim_at,
      @sent_at, @release_at, @pickup_deadline, @window_end, @finished_attempts)
  `).run(row);
}

/** A sent run notice whose pickup deadline is `deadlineOffset` from NOW. */
function insertSentNotice(id: string, deadlineOffset = -MIN, extra: Record<string, unknown> = {}) {
  const deadline = at(deadlineOffset);
  insertNotice(id, {
    state: 'sent',
    created_at: new Date(deadline.getTime() - 130 * MIN).toISOString(),
    sent_at: new Date(deadline.getTime() - 125 * MIN).toISOString(),
    release_at: new Date(deadline.getTime() - 120 * MIN).toISOString(),
    pickup_deadline: deadline.toISOString(),
    window_end: new Date(deadline.getTime() + 300_000).toISOString(),
    ...extra,
  });
}

function linkTask(
  taskId: string,
  noticeId: string,
  v: {
    status?: string;
    agentId?: string;
    exitCode?: number;
    completedAt?: string | null;
    assignedAt?: string | null;
    originalTaskId?: string;
    retryCount?: number;
    createdAt?: string;
  } = {},
) {
  // ttl: the real-clock TTL sweep in getNextTask would expire tasks created at the fixed NOW
  insertTestTask(testDb, { id: taskId, agent_id: v.agentId ?? 'agent-001', ttl: 315360000 });
  const result =
    v.exitCode === undefined
      ? null
      : JSON.stringify({ task_id: taskId, test_uuid: 'test-uuid-001', exit_code: v.exitCode, stdout: '', stderr: '' });
  testDb
    .prepare(`
      UPDATE tasks SET notice_id = ?, status = ?, result = ?, completed_at = ?, assigned_at = ?,
        original_task_id = ?, retry_count = ?
      WHERE id = ?
    `)
    .run(
      noticeId,
      v.status ?? 'pending',
      result,
      v.completedAt ?? null,
      v.assignedAt ?? null,
      v.originalTaskId ?? null,
      v.retryCount ?? 0,
      taskId,
    );
  if (v.createdAt) testDb.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(v.createdAt, taskId);
}

/** SQLite datetime('now') form, as tasks.created_at is stored. */
const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

function notice(id: string): Record<string, unknown> {
  return testDb.prepare('SELECT * FROM run_notices WHERE id = ?').get(id) as Record<string, unknown>;
}

function task(id: string): { status: string; result: string | null; completed_at: string | null } {
  return testDb.prepare('SELECT status, result, completed_at FROM tasks WHERE id = ?').get(id) as {
    status: string;
    result: string | null;
    completed_at: string | null;
  };
}

function slackTexts(fragment: string): string[] {
  return mockSendSlackText.mock.calls.map((c) => c[1] as string).filter((t) => t.includes(fragment));
}

function finishedMails() {
  return mockSendMail.mock.calls
    .map((c) => c[1] as { subject: string; html: string; to: string[]; attachments?: Array<{ filename: string; content: string }> })
    .filter((m) => m.subject.includes('finished'));
}

function cell(html: string, label: string): number {
  const m = new RegExp(`>(\\d+)</div><div[^>]*>${label}</div>`).exec(html);
  if (!m) throw new Error(`no ${label} cell`);
  return Number(m[1]);
}

describe('pre-execution notice sweeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDatabase();
    resetExpireThrottle();
    insertTestAgent(testDb, { id: 'agent-001', hostname: 'host-1', last_heartbeat: at(-30_000).toISOString() });
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2', last_heartbeat: at(-30_000).toISOString() });
    writeSettings();
    mockSendMail.mockResolvedValue({ accepted: [...RECIPIENTS], rejected: [] });
    mockSendSlackText.mockResolvedValue(undefined);
    mockTestEmailConnection.mockResolvedValue({ success: true, message: 'SMTP connection verified successfully' });
    // Freeze the real clock at NOW so send times are deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  describe('send pass', () => {
    it('sends every pending notice and counts the accepted ones', async () => {
      insertNotice('n-send');
      linkTask('t1', 'n-send');
      const r = await processNotices(NOW);
      expect(r.sent).toBe(1);
      expect(notice('n-send').state).toBe('sent');
    });

    it('backoff schedule is 1, 2, 4, 8, then 15 minutes', () => {
      expect([1, 2, 3, 4, 5, 6, 20].map((n) => retryBackoffMs(n) / MIN)).toEqual([1, 2, 4, 8, 15, 15, 15]);
      expect(retryBackoffMs(0)).toBe(0);
    });

    it('waits out the backoff between failed attempts instead of resending every pass (I1)', async () => {
      mockSendMail.mockResolvedValue({ accepted: ['a@x.com'], rejected: ['b@x.com'] });
      insertNotice('n-flood');
      linkTask('t1', 'n-flood');

      await processNotices(NOW); // attempt 1
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      await processNotices(at(30_000)); // within 1 min of attempt 1: skipped
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      await processNotices(at(2 * MIN)); // attempt 2
      expect(mockSendMail).toHaveBeenCalledTimes(2);
      await processNotices(at(3 * MIN)); // within 2 min of attempt 2: skipped
      expect(mockSendMail).toHaveBeenCalledTimes(2);
      await processNotices(at(4 * MIN)); // attempt 3
      expect(mockSendMail).toHaveBeenCalledTimes(3);
      expect(notice('n-flood')).toMatchObject({ state: 'pending', attempts: 3, last_attempt_at: at(4 * MIN).toISOString() });
    });
  });

  describe('bounded wait', () => {
    beforeEach(() => {
      mockSendMail.mockRejectedValue(new Error('connect ECONNREFUSED'));
    });

    it('marks a notice pending past max_wait not_delivered and expires its pending tasks', async () => {
      insertNotice('n-old', { created_at: at(-61 * MIN).toISOString() });
      linkTask('t1', 'n-old');

      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(1);
      expect(r.expiredTasks).toBe(1);
      expect(notice('n-old').state).toBe('not_delivered');

      const t = task('t1');
      expect(t.status).toBe('expired');
      expect(t.completed_at).toBe(NOW.toISOString());
      expect(JSON.parse(t.result!)).toEqual({
        error: NOT_DELIVERED,
        exit_code: -1,
        stdout: '',
        stderr: '',
        execution_duration_ms: 0,
      });
      // Expired is never ingested into ES.
      expect(getPendingIngestionTasks().map((x) => x.id)).not.toContain('t1');

      // Slack once across two passes.
      await processNotices(at(MIN));
      expect(slackTexts('not delivered')).toHaveLength(1);
      expect(notice('n-old').slack_not_delivered_alerted).toBe(1);
    });

    it('leaves a notice pending for 59 minutes untouched', async () => {
      insertNotice('n-young', { created_at: at(-59 * MIN).toISOString() });
      linkTask('t1', 'n-young');
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(0);
      expect(notice('n-young').state).toBe('pending');
      expect(task('t1').status).toBe('pending');
      expect(slackTexts('not delivered')).toHaveLength(0);
    });

    it('expires a task linked to an already not_delivered notice on the next pass (R5)', async () => {
      insertNotice('n-day', {
        kind: 'day',
        source_type: 'schedule',
        schedule_id: 'sched-1',
        window_date: '2026-10-23',
        created_at: at(-61 * MIN).toISOString(),
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T17:00:00.000Z',
      });
      linkTask('t1', 'n-day', { createdAt: sqlTime(at(-61 * MIN)) });
      await processNotices(NOW);
      expect(notice('n-day').state).toBe('not_delivered');

      // A later per-machine agent joins today's (undelivered) day notice.
      linkTask('t2', 'n-day', { agentId: 'agent-002' });
      const r = await processNotices(at(MIN));
      expect(r.notDelivered).toBe(0);
      expect(r.expiredTasks).toBe(1);
      expect(task('t2').status).toBe('expired');
      expect(JSON.parse(task('t2').result!).error).toBe(NOT_DELIVERED);
    });

    it('does not take a notice that a live sender has claimed', async () => {
      insertNotice('n-claimed', { created_at: at(-61 * MIN).toISOString(), claim_at: at(-MIN).toISOString() });
      linkTask('t1', 'n-claimed');
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(0);
      expect(notice('n-claimed').state).toBe('pending');
      expect(task('t1').status).toBe('pending');
    });

    const dayNotice = (id: string, extra: Record<string, unknown> = {}) =>
      insertNotice(id, {
        kind: 'day',
        source_type: 'schedule',
        schedule_id: 'sched-1',
        window_date: '2026-10-23',
        created_at: at(-61 * MIN).toISOString(),
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T17:00:00.000Z',
        ...extra,
      });

    it('a day notice with no linked tasks past max_wait stays pending, with no banner or Slack (I4)', async () => {
      dayNotice('n-empty');
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(0);
      expect(notice('n-empty').state).toBe('pending');
      expect(getNoticeStatus(ALL, NOW)).toMatchObject({ pendingOverdue: 0, notDeliveredLast7d: 0 });
      expect(slackTexts('not delivered')).toHaveLength(0);
    });

    it('a day notice whose only task was cancelled stays pending; a later agent task is sent and pickable (R18a)', async () => {
      dayNotice('n-cancelled');
      linkTask('t1', 'n-cancelled', { status: 'expired' });
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(0);
      expect(notice('n-cancelled').state).toBe('pending');
      expect(getNoticeStatus(ALL, NOW)).toMatchObject({ pendingOverdue: 0, notDeliveredLast7d: 0 });
      expect(slackTexts('not delivered')).toHaveLength(0);

      // A later per-machine agent links a held task; SMTP works again.
      mockSendMail.mockResolvedValue({ accepted: [...RECIPIENTS], rejected: [] });
      linkTask('t2', 'n-cancelled', { agentId: 'agent-002' });
      await processNotices(at(MIN));
      expect(notice('n-cancelled').state).toBe('sent');
      expect(task('t2').status).toBe('pending');
      expect(JSON.parse(notice('n-cancelled').recipients as string)).toEqual(RECIPIENTS);
      // Released at acceptance + lead time, so pickable after that.
      const t = at(MIN + 6 * MIN);
      vi.setSystemTime(t);
      resetExpireThrottle();
      expect(getNextTask('agent-002')?.id).toBe('t2');
    });

    it('a day notice holding a pending task past max_wait is still not_delivered and expires it (R18b)', async () => {
      dayNotice('n-held');
      linkTask('t1', 'n-held', { createdAt: sqlTime(at(-61 * MIN)) });
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(1);
      expect(notice('n-held').state).toBe('not_delivered');
      expect(task('t1').status).toBe('expired');
      expect(getNoticeStatus(ALL, NOW).notDeliveredLast7d).toBe(1);
    });

    it('day notice: max_wait counts from the oldest held task, not the notice (R19)', async () => {
      // Notice created ~09:10, holds nothing until a task links at 14:00.
      dayNotice('n-late', { created_at: at(-170 * MIN).toISOString() });
      const linked = at(2 * HOUR);
      linkTask('t1', 'n-late', { createdAt: sqlTime(linked) });

      const r1 = await processNotices(linked);
      expect(r1.notDelivered).toBe(0);
      expect(notice('n-late').state).toBe('pending');
      expect(task('t1').status).toBe('pending');
      expect(getNoticeStatus(ALL, linked).pendingOverdue).toBe(0);

      // Still inside max_wait (60 min) of the task.
      await processNotices(at(2 * HOUR + 59 * MIN));
      expect(notice('n-late').state).toBe('pending');
      expect(task('t1').status).toBe('pending');

      // Banner clock: task older than 5 min counts as overdue.
      expect(getNoticeStatus(ALL, at(2 * HOUR + 6 * MIN)).pendingOverdue).toBe(1);

      const r2 = await processNotices(at(2 * HOUR + 61 * MIN));
      expect(r2.notDelivered).toBe(1);
      expect(notice('n-late').state).toBe('not_delivered');
      expect(task('t1').status).toBe('expired');
    });

    it('a run notice whose linked tasks were all cancelled is skipped at max_wait (R18c)', async () => {
      insertNotice('n-run-cancelled', { created_at: at(-61 * MIN).toISOString() });
      linkTask('t1', 'n-run-cancelled', { status: 'expired' });
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(0);
      expect(notice('n-run-cancelled')).toMatchObject({
        state: 'skipped',
        skip_reason: 'all linked tasks were cancelled or completed',
      });
      expect(getNoticeStatus(ALL, NOW).notDeliveredLast7d).toBe(0);
      expect(slackTexts('not delivered')).toHaveLength(0);
    });

    it('a previous-day held-nothing day notice stays pending, inert and out of the status counts (R18d)', async () => {
      dayNotice('n-yesterday', { window_date: '2026-10-22', created_at: at(-27 * HOUR).toISOString(),
        day_window_start: '2026-10-22T09:00:00.000Z', day_window_end: '2026-10-22T17:00:00.000Z' });
      linkTask('t1', 'n-yesterday', { status: 'expired' });
      for (const offset of [0, MIN, HOUR]) {
        const r = await processNotices(at(offset));
        expect(r).toMatchObject({ notDelivered: 0, expiredTasks: 0 });
      }
      expect(notice('n-yesterday').state).toBe('pending');
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(getNoticeStatus(ALL, NOW)).toMatchObject({ pendingOverdue: 0, notDeliveredLast7d: 0 });
    });

    it('still sweeps existing notices when the gate is disabled', async () => {
      writeSettings({ enabled: false });
      insertNotice('n-old', { created_at: at(-61 * MIN).toISOString() });
      linkTask('t1', 'n-old');
      const r = await processNotices(NOW);
      expect(r.notDelivered).toBe(1);
      expect(task('t1').status).toBe('expired');
    });
  });

  describe('pickup deadline', () => {
    it('expires pending tasks of a sent notice past its deadline and leaves executing ones', async () => {
      insertSentNotice('n-sent', -MIN);
      linkTask('t-pending', 'n-sent');
      linkTask('t-exec', 'n-sent', { status: 'executing', agentId: 'agent-002' });

      const r = await processNotices(NOW);
      expect(r.expiredTasks).toBe(1);
      const t = task('t-pending');
      expect(t.status).toBe('expired');
      expect(t.completed_at).toBe(NOW.toISOString());
      expect(JSON.parse(t.result!)).toEqual({
        error: OFFLINE,
        exit_code: -1,
        stdout: '',
        stderr: '',
        execution_duration_ms: 0,
      });
      expect(task('t-exec').status).toBe('executing');
      expect(notice('n-sent').state).toBe('sent');
    });

    it('leaves pending tasks alone before the deadline', async () => {
      insertSentNotice('n-sent', 10 * MIN);
      linkTask('t1', 'n-sent');
      const r = await processNotices(NOW);
      expect(r.expiredTasks).toBe(0);
      expect(task('t1').status).toBe('pending');
    });

    it('applies to overridden notices too', async () => {
      insertSentNotice('n-ovr', -MIN, { state: 'overridden', sent_at: null });
      linkTask('t1', 'n-ovr');
      await processNotices(NOW);
      expect(JSON.parse(task('t1').result!).error).toBe(OFFLINE);
    });

    it('expires an automatic retry created after the deadline on the next pass', async () => {
      insertSentNotice('n-sent', -MIN);
      linkTask('t1', 'n-sent', { status: 'executing' });
      await processNotices(NOW);
      expect(task('t1').status).toBe('executing');

      // expireStaleTasks fails the parent and creates a retry inheriting notice_id.
      testDb.prepare(`UPDATE tasks SET status = 'failed', completed_at = datetime('now') WHERE id = 't1'`).run();
      linkTask('t1-retry', 'n-sent', { originalTaskId: 't1', retryCount: 1 });

      const r = await processNotices(at(MIN));
      expect(r.expiredTasks).toBe(1);
      expect(task('t1-retry').status).toBe('expired');
      expect(JSON.parse(task('t1-retry').result!).error).toBe(OFFLINE);
    });
  });

  describe('Finished email', () => {
    function terminalRun(noticeId: string) {
      linkTask('t-unprot', noticeId, { status: 'completed', exitCode: 101, completedAt: at(-90 * MIN).toISOString(), assignedAt: '2026-10-23 10:05:00' });
      // SQLite space-separated UTC form: the latest finish.
      linkTask('t-prot', noticeId, { status: 'completed', exitCode: 126, completedAt: '2026-10-23 11:59:00', assignedAt: '2026-10-23 10:01:00', agentId: 'agent-002' });
      linkTask('t-err', noticeId, { status: 'completed', exitCode: 1, completedAt: at(-80 * MIN).toISOString() });
      linkTask('t-notrun', noticeId, { status: 'expired', completedAt: at(-30 * MIN).toISOString() });
      // A failed parent and its completed retry count once, as the retry's outcome.
      linkTask('t-parent', noticeId, { status: 'failed', completedAt: at(-100 * MIN).toISOString() });
      linkTask('t-child', noticeId, { status: 'completed', exitCode: 105, completedAt: at(-70 * MIN).toISOString(), originalTaskId: 't-parent', retryCount: 1 });
    }

    it('sends one Finished email with counts matching classifyOutcome, then nothing more', async () => {
      insertSentNotice('n-fin', -MIN);
      terminalRun('n-fin');

      const r = await processNotices(NOW);
      expect(r.finished).toBe(1);
      const mails = finishedMails();
      expect(mails).toHaveLength(1);
      const mail = mails[0];
      expect(mail.to).toEqual(RECIPIENTS);
      expect(mail.subject).toBe('[ProjectAchilles] Security testing finished — PA-RUN-' + 'n-fin'.replace(/-/g, '').slice(0, 6));

      // Expected counts from classifyOutcome over the latest attempt per target.
      const expected = { protected: 0, unprotected: 0, error: 0, notRun: 0 };
      const rows = testDb
        .prepare(`SELECT id, status, result FROM tasks WHERE notice_id = 'n-fin' AND id != 't-parent'`)
        .all() as Array<{ id: string; status: string; result: string | null }>;
      for (const row of rows) {
        const k = classifyOutcome({ status: row.status as never, result: row.result ? JSON.parse(row.result) : null });
        expected[k]++;
      }
      expect(expected).toEqual({ protected: 2, unprotected: 1, error: 1, notRun: 1 });
      expect(cell(mail.html, 'Protected')).toBe(expected.protected);
      expect(cell(mail.html, 'Unprotected')).toBe(expected.unprotected);
      expect(cell(mail.html, 'Error')).toBe(expected.error);
      expect(cell(mail.html, 'Not run')).toBe(expected.notRun);
      expect(cell(mail.html, 'Prevented')).toBe(0);
      expect(cell(mail.html, 'Detected')).toBe(0);

      // Updated calendar event: same UID, SEQUENCE 1, ends at the actual finish.
      const ics = mail.attachments!.find((a) => a.filename.endsWith('.ics'))!.content;
      expect(ics).toContain('UID:n-fin@projectachilles');
      expect(ics).toContain('SEQUENCE:1');
      expect(ics).toContain('DTEND:20261023T115900Z');

      expect(notice('n-fin').finished_sent_at).toBe(NOW.toISOString());
      // It never changes task state.
      expect(task('t-parent').status).toBe('failed');

      const r2 = await processNotices(at(MIN));
      expect(r2.finished).toBe(0);
      expect(finishedMails()).toHaveLength(1);
    });

    it('counts with the same verdict as Analytics: EDR prevention and detection on the result docs', async () => {
      insertSentNotice('n-fin', -MIN);
      terminalRun('n-fin');
      mockFetchEdrDocs.mockImplementationOnce(async () => ({
        status: 'ok',
        docs: new Map<string, Record<string, unknown>>([
          // The 101 single-binary result: Defender killed the process.
          ['t-unprot', { event: { ERROR: 101 }, f0rtika: { defender_prevented: true, defender_prevention_action: 'process_killed' } }],
          // The exit-1 result: Defender raised an alert.
          ['t-err', { event: { ERROR: 1 }, f0rtika: { defender_detected: true, defender_stage_detected: true } }],
        ]),
      }));
      await processNotices(NOW);
      const mail = finishedMails()[0];
      // Expired and failed tasks are never looked up; the superseded parent isn't either.
      expect(mockFetchEdrDocs).toHaveBeenCalledWith(expect.arrayContaining(['t-unprot', 't-prot', 't-err', 't-child']));
      expect(mockFetchEdrDocs.mock.calls.at(-1)![0]).not.toContain('t-notrun');
      expect(mockFetchEdrDocs.mock.calls.at(-1)![0]).not.toContain('t-parent');
      expect(cell(mail.html, 'Protected')).toBe(2);
      expect(cell(mail.html, 'Prevented')).toBe(1);
      expect(cell(mail.html, 'Detected')).toBe(1);
      expect(cell(mail.html, 'Unprotected')).toBe(0);
      expect(cell(mail.html, 'Error')).toBe(0);
      expect(cell(mail.html, 'Not run')).toBe(1);
      expect(mail.html).not.toContain('EDR results were unavailable');
      const ics = mail.attachments!.find((a: { filename: string }) => a.filename.endsWith('.ics'))!.content;
      // Unfold RFC 5545 continuation lines before matching.
      expect(ics.replace(/\r\n /g, '')).toContain('Protected 2\\, prevented 1\\, detected 1\\, unprotected 0');
    });

    it('says so when EDR results were unavailable', async () => {
      insertSentNotice('n-fin', -MIN);
      terminalRun('n-fin');
      mockFetchEdrDocs.mockImplementationOnce(async () => ({ status: 'unavailable', docs: new Map() }));
      await processNotices(NOW);
      const mail = finishedMails()[0];
      expect(cell(mail.html, 'Unprotected')).toBe(1);
      expect(mail.html).toContain('EDR results were unavailable, so these counts use test exit codes only.');
    });

    it('waits while any linked task is still running', async () => {
      insertSentNotice('n-fin', -MIN);
      terminalRun('n-fin');
      linkTask('t-running', 'n-fin', { status: 'executing' });
      const r = await processNotices(NOW);
      expect(r.finished).toBe(0);
      expect(finishedMails()).toHaveLength(0);
      expect(notice('n-fin').finished_sent_at).toBeNull();
    });

    it('waits until the pickup deadline has passed', async () => {
      insertSentNotice('n-fin', 10 * MIN);
      terminalRun('n-fin');
      await processNotices(NOW);
      expect(finishedMails()).toHaveLength(0);
    });

    it('waits for a day notice whose window is still open, even with every task terminal', async () => {
      insertSentNotice('n-day', 2 * HOUR, {
        kind: 'day',
        source_type: 'schedule',
        schedule_id: 'sched-1',
        window_date: '2026-10-23',
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T14:00:00.000Z',
      });
      terminalRun('n-day');
      await processNotices(NOW);
      expect(finishedMails()).toHaveLength(0);
    });

    it('is not sent when send_finished is off', async () => {
      writeSettings({ sendFinished: false });
      insertSentNotice('n-fin', -MIN);
      terminalRun('n-fin');
      const r = await processNotices(NOW);
      expect(r.finished).toBe(0);
      expect(finishedMails()).toHaveLength(0);
    });

    it('is not sent for a run whose deadline passed more than 7 days ago', async () => {
      // e.g. send_finished was off then and has just been turned back on.
      insertSentNotice('n-ancient', -8 * 24 * HOUR);
      terminalRun('n-ancient');
      const r = await processNotices(NOW);
      expect(r.finished).toBe(0);
      expect(finishedMails()).toHaveLength(0);
    });

    it('is not sent for a notice with no linked tasks', async () => {
      insertSentNotice('n-empty', -MIN);
      await processNotices(NOW);
      expect(finishedMails()).toHaveLength(0);
    });

    it('stops trying after 3 failures', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP down'));
      insertSentNotice('n-fin', -MIN);
      terminalRun('n-fin');
      for (let i = 0; i < 5; i++) await processNotices(at(i * MIN));
      expect(finishedMails()).toHaveLength(3);
      const n = notice('n-fin');
      expect(n.finished_attempts).toBe(3);
      expect(n.finished_sent_at).toBeNull();
    });
  });

  describe('releaseWithoutNotice', () => {
    it('rejects an empty reason with 400', () => {
      insertNotice('n-p');
      linkTask('t1', 'n-p');
      expect(() => releaseWithoutNotice('n-p', 'admin', '   ', ALL, NOW)).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(notice('n-p').state).toBe('pending');
    });

    it('releases a pending notice immediately so its task is pickable', () => {
      insertNotice('n-p');
      linkTask('t1', 'n-p');
      expect(getNextTask('agent-001', NOW)).toBeNull();

      const row = releaseWithoutNotice('n-p', 'admin', '  SMTP outage, SOC informed by phone  ', ALL, NOW);
      expect(row).toMatchObject({
        state: 'overridden',
        override_by: 'admin',
        override_reason: 'SMTP outage, SOC informed by phone',
        override_at: NOW.toISOString(),
        release_at: NOW.toISOString(),
        pickup_deadline: at(120 * MIN).toISOString(),
        window_end: at(120 * MIN + 300_000).toISOString(),
      });
      expect(getNextTask('agent-001', NOW)?.id).toBe('t1');
    });

    it('rejects a notice that is not pending with 400', () => {
      insertSentNotice('n-sent', 10 * MIN);
      expect(() => releaseWithoutNotice('n-sent', 'admin', 'because', ALL, NOW)).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(notice('n-sent').state).toBe('sent');
    });

    it('returns 404 for an unknown notice', () => {
      expect(() => releaseWithoutNotice('nope', 'admin', 'because', ALL, NOW)).toThrow(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('status, list and summaries', () => {
    it('getNoticeStatus counts overdue pending and recent not_delivered notices', () => {
      insertNotice('p-overdue', { created_at: at(-6 * MIN).toISOString() });
      insertNotice('p-fresh', { created_at: at(-4 * MIN).toISOString() });
      insertNotice('nd-recent', { state: 'not_delivered', created_at: at(-2 * 24 * HOUR).toISOString() });
      insertNotice('nd-old', { state: 'not_delivered', created_at: at(-8 * 24 * HOUR).toISOString() });
      insertSentNotice('s-1', 10 * MIN);

      expect(getNoticeStatus(ALL, NOW)).toEqual({
        pendingOverdue: 1,
        notDeliveredLast7d: 1,
        smtpCheck: { ok: true, at: NOW.toISOString(), message: 'ok' },
        digests: [],
      });
    });

    it('getNoticeStatus hides the SMTP check while notices are disabled but keeps the counts (I5)', () => {
      writeSettings({
        enabled: false,
        notices: { last_smtp_check_at: NOW.toISOString(), last_smtp_check_ok: false, last_smtp_check_message: 'bad' },
      });
      insertNotice('p-overdue', { created_at: at(-6 * MIN).toISOString() });
      insertNotice('nd-recent', { state: 'not_delivered', created_at: at(-2 * HOUR).toISOString() });
      expect(getNoticeStatus(ALL, NOW)).toEqual({
        pendingOverdue: 1,
        notDeliveredLast7d: 1,
        smtpCheck: { ok: null, at: null, message: null },
        digests: [],
      });
    });

    it('getNoticeStatus reports a never-run SMTP check as null', () => {
      writeSettings({ notices: { last_smtp_check_at: undefined, last_smtp_check_ok: undefined, last_smtp_check_message: undefined } });
      expect(getNoticeStatus(ALL, NOW).smtpCheck).toEqual({ ok: null, at: null, message: null });
    });

    it('listNotices returns newest first with paging', () => {
      insertNotice('n-a', { created_at: at(-3 * MIN).toISOString() });
      insertNotice('n-b', { created_at: at(-2 * MIN).toISOString() });
      insertNotice('n-c', { created_at: at(-1 * MIN).toISOString() });
      expect(listNotices(2, 0, ALL).map((n) => n.id)).toEqual(['n-c', 'n-b']);
      expect(listNotices(2, 2, ALL).map((n) => n.id)).toEqual(['n-a']);
    });

    it('getNoticeSummaries maps ids to summaries', () => {
      insertNotice('7f3c9a12-0000-4000-8000-000000000000');
      insertSentNotice('n-sent', 10 * MIN);
      const s = getNoticeSummaries(['7f3c9a12-0000-4000-8000-000000000000', 'n-sent', 'missing'], ALL);
      expect(Object.keys(s).sort()).toEqual(['7f3c9a12-0000-4000-8000-000000000000', 'n-sent']);
      expect(s['7f3c9a12-0000-4000-8000-000000000000']).toEqual({
        id: '7f3c9a12-0000-4000-8000-000000000000',
        run_tag: 'PA-RUN-7f3c9a',
        state: 'pending',
        last_error: null,
        release_at: null,
        pickup_deadline: null,
      });
      expect(s['n-sent'].state).toBe('sent');
      expect(s['n-sent'].pickup_deadline).toBe(at(10 * MIN).toISOString());
      expect(getNoticeSummaries([], ALL)).toEqual({});
    });
  });

  describe('daily SMTP check', () => {
    function stored() {
      return new IntegrationsSettingsService().getPreExecutionNoticeSettings();
    }

    it('runs at most once per 24h and records the result', async () => {
      writeSettings({ notices: { last_smtp_check_at: at(-25 * HOUR).toISOString() } });
      await processNotices(NOW);
      expect(mockTestEmailConnection).toHaveBeenCalledTimes(1);
      expect(stored()).toMatchObject({
        last_smtp_check_at: NOW.toISOString(),
        last_smtp_check_ok: true,
        last_smtp_check_message: 'SMTP connection verified successfully',
      });

      await processNotices(at(23 * HOUR));
      expect(mockTestEmailConnection).toHaveBeenCalledTimes(1);

      await processNotices(at(24 * HOUR + MIN));
      expect(mockTestEmailConnection).toHaveBeenCalledTimes(2);
    });

    it('runs when no check has ever been recorded', async () => {
      writeSettings({ notices: { last_smtp_check_at: undefined } });
      await processNotices(NOW);
      expect(mockTestEmailConnection).toHaveBeenCalledTimes(1);
    });

    it('alerts Slack once per failing check', async () => {
      mockTestEmailConnection.mockResolvedValue({ success: false, message: 'SMTP connection failed: auth' });
      writeSettings({ notices: { last_smtp_check_at: at(-25 * HOUR).toISOString() } });
      await processNotices(NOW);
      await processNotices(at(MIN));
      expect(slackTexts('SMTP check')).toHaveLength(1);
      expect(stored()).toMatchObject({ last_smtp_check_ok: false, last_smtp_check_message: 'SMTP connection failed: auth' });

      await processNotices(at(25 * HOUR));
      expect(slackTexts('SMTP check')).toHaveLength(2);
    });

    it('is skipped when notices are disabled', async () => {
      writeSettings({ enabled: false, notices: { last_smtp_check_at: at(-25 * HOUR).toISOString() } });
      await processNotices(NOW);
      expect(mockTestEmailConnection).not.toHaveBeenCalled();
    });
  });
});
