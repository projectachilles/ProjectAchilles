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

const { mockGetTestMetadata, mockGetUser } = vi.hoisted(() => ({
  mockGetTestMetadata: vi.fn((_uuid: string): unknown => null),
  mockGetUser: vi.fn(),
}));

vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: mockGetTestMetadata,
}));

vi.mock('@clerk/express', () => ({ clerkClient: { users: { getUser: mockGetUser } } }));

// Settings are read from a real integrations.json under a temp HOME.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-notices-send-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { mockSendMail, mockSendSlackText } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockSendSlackText: vi.fn(),
}));

vi.mock('../../alerts/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/email.service.js')>();
  return { ...actual, sendMail: mockSendMail };
});

vi.mock('../../alerts/slack.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/slack.service.js')>();
  return { ...actual, sendSlackText: mockSendSlackText };
});

const {
  isNoticeGateEnabled,
  runWithNotice,
  sendNotice,
  createSchedulerTick,
} = await import('../notices.service.js');
const { getNextTask, resetExpireThrottle } = await import('../../agent/tasks.service.js');

// Friday, inside the 09:00-17:00 weekday window in UTC.
const NOW = new Date('2026-10-23T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const MIN = 60_000;
const RECIPIENTS = ['a@x.com', 'b@x.com'];

const HOME = os.homedir();
const SETTINGS_DIR = path.join(HOME, '.projectachilles');

function writeSettings(
  opts: {
    enabled?: boolean;
    emailConfigured?: boolean;
    smtp?: boolean;
    slack?: boolean;
    slackConfigured?: boolean;
    recipients?: string[];
  } = {},
) {
  const {
    enabled = true,
    emailConfigured = true,
    smtp = true,
    slack = false,
    slackConfigured = true,
    recipients = RECIPIENTS,
  } = opts;
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
                configured: emailConfigured,
                enabled: true,
              },
            }
          : {}),
        ...(slack
          ? { slack: { webhook_url: 'https://hooks.slack.test/abc', configured: slackConfigured, enabled: true } }
          : {}),
      },
      pre_execution_notices: {
        enabled,
        recipients,
        lead_minutes: 5,
        max_wait_minutes: 60,
        pickup_window_minutes: 120,
        send_finished: true,
      },
    }),
  );
}

function insertPendingNotice(id: string, extra: Record<string, unknown> = {}) {
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
    ...extra,
  };
  testDb.prepare(`
    INSERT INTO run_notices (id, kind, state, source_type, schedule_ids, schedule_id, window_date, timezone,
      announced_agent_ids, day_window_start, day_window_end, created_by, created_at, recipients, claim_at)
    VALUES (@id, @kind, @state, @source_type, @schedule_ids, @schedule_id, @window_date, @timezone,
      @announced_agent_ids, @day_window_start, @day_window_end, @created_by, @created_at, @recipients, @claim_at)
  `).run(row);
}

function linkTask(taskId: string, noticeId: string, agentId = 'agent-001', payloadExtra: Record<string, unknown> = {}) {
  const payload = JSON.stringify({
    test_uuid: 'test-uuid-001',
    test_name: 'Credential Dumping <script>',
    binary_name: 'test.exe',
    binary_sha256: 'abc',
    binary_size: 1,
    execution_timeout: 300,
    arguments: [],
    metadata: {
      category: 'intel-driven', subcategory: '', severity: 'high',
      techniques: ['T1003'], tactics: ['credential-access'],
      threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [],
    },
    ...payloadExtra,
  });
  // ttl: the real-clock TTL sweep in getNextTask would expire tasks created at the fixed NOW
  insertTestTask(testDb, { id: taskId, agent_id: agentId, payload, ttl: 315360000 });
  testDb.prepare('UPDATE tasks SET notice_id = ? WHERE id = ?').run(noticeId, taskId);
}

function notice(id: string): Record<string, unknown> {
  return testDb.prepare('SELECT * FROM run_notices WHERE id = ?').get(id) as Record<string, unknown>;
}

function countNotices(): number {
  return (testDb.prepare('SELECT COUNT(*) AS c FROM run_notices').get() as { c: number }).c;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('pre-execution notice creation and send pass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDatabase();
    resetExpireThrottle();
    insertTestAgent(testDb, { id: 'agent-001', hostname: 'host-1', last_heartbeat: at(-30_000).toISOString() });
    writeSettings();
    mockSendMail.mockResolvedValue({ accepted: [...RECIPIENTS], rejected: [] });
    mockSendSlackText.mockResolvedValue(undefined);
    // The real clock is frozen at NOW, so "after acceptance" times are deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CORS_ORIGIN;
  });

  afterAll(() => {
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  describe('runWithNotice', () => {
    it('gate disabled: calls fn(null) and creates no notice', () => {
      writeSettings({ enabled: false });
      expect(isNoticeGateEnabled(null)).toBe(false);
      const fn = vi.fn((nid: string | null) => nid);
      expect(runWithNotice({ type: 'run_now', createdBy: 'alice', orgId: null }, fn)).toBeNull();
      expect(fn).toHaveBeenCalledWith(null);
      expect(countNotices()).toBe(0);
    });

    it('the gate depends on `enabled` alone: the alerts `configured` flag is ignored', () => {
      writeSettings({ enabled: true, emailConfigured: false });
      expect(isNoticeGateEnabled(null)).toBe(true);
    });

    it('enabled with SMTP removed: Run Now still creates a held notice and the send fails loudly', async () => {
      writeSettings({ enabled: true, smtp: false });
      expect(isNoticeGateEnabled(null)).toBe(true);
      const id = runWithNotice({ type: 'run_now', createdBy: 'alice', orgId: null }, (nid) => {
        linkTask('t1', nid!);
        return nid!;
      });
      expect(id).toEqual(expect.any(String));
      await flush();
      await flush();
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(notice(id)).toMatchObject({ state: 'pending', attempts: 1, last_error: 'SMTP email is not configured' });
      expect(getNextTask('agent-001', at(60 * MIN))).toBeNull();
    });

    it('sends when SMTP was saved without the `configured` flag (UI save shape)', async () => {
      writeSettings({ emailConfigured: false });
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      expect(await sendNotice('n1', NOW)).toBe('sent');
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('alerts Slack when the webhook is enabled but the `configured` flag is false', async () => {
      writeSettings({ slack: true, slackConfigured: false });
      mockSendMail.mockRejectedValue(new Error('Invalid login'));
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      expect(await sendNotice('n1', NOW)).toBe('failed');
      expect(mockSendSlackText).toHaveBeenCalledTimes(1);
    });

    it('gate enabled: the notice row exists in the same transaction as the tasks fn inserted', async () => {
      expect(isNoticeGateEnabled(null)).toBe(true);
      const result = runWithNotice({ type: 'run_now', createdBy: 'alice', orgId: null }, (nid) => {
        expect(nid).toEqual(expect.any(String));
        // Visible inside the transaction.
        expect(notice(nid!)).toMatchObject({ state: 'pending', kind: 'run', source_type: 'run_now', created_by: 'alice' });
        linkTask('t1', nid!);
        return nid;
      });
      const n = notice(result!);
      expect(JSON.parse(n.recipients as string)).toEqual(RECIPIENTS);
      expect(n.created_at).toMatch(/\.\d{3}Z$/);
      const task = testDb.prepare('SELECT notice_id FROM tasks WHERE id = ?').get('t1') as { notice_id: string };
      expect(task.notice_id).toBe(result);
      await flush();
    });

    it('an exception in fn rolls back the notice row and propagates', async () => {
      expect(() =>
        runWithNotice({ type: 'run_now', createdBy: 'alice', orgId: null }, (nid) => {
          linkTask('t1', nid!);
          throw new Error('No binary was built for OS windows');
        }),
      ).toThrow('No binary was built');
      expect(countNotices()).toBe(0);
      expect(testDb.prepare('SELECT COUNT(*) AS c FROM tasks').get()).toEqual({ c: 0 });
      await flush();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('fires the send after commit and never throws a send error to the caller', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSendMail.mockRejectedValue(new Error('Invalid login'));
      const id = runWithNotice({ type: 'run_now', createdBy: 'alice', orgId: null }, (nid) => {
        linkTask('t1', nid!);
        return nid!;
      });
      await flush();
      await flush();
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(notice(id)).toMatchObject({ state: 'pending', attempts: 1, last_error: 'Invalid login' });
      errSpy.mockRestore();
    });
  });

  describe('sendNotice', () => {
    it('accepted: marks sent, release_at = sent_at + 5m, and the task becomes pickable at release', async () => {
      insertPendingNotice('n1');
      linkTask('t1', 'n1');

      expect(await sendNotice('n1', NOW)).toBe('sent');

      const n = notice('n1');
      expect(n.state).toBe('sent');
      expect(n.sent_at).toBe(NOW.toISOString());
      expect(n.release_at).toBe(at(5 * MIN).toISOString());
      expect(n.pickup_deadline).toBe(at(125 * MIN).toISOString());
      expect(n.window_end).toBe(at(125 * MIN + 300_000).toISOString());
      expect(n.claim_at).toBeNull();
      expect(JSON.parse(n.accepted as string)).toEqual(RECIPIENTS);

      const mail = mockSendMail.mock.calls[0][1];
      expect(mail.to).toEqual(RECIPIENTS);
      expect(mail.html).toContain('Credential Dumping &lt;script&gt;');
      expect(mail.html).toContain('Run Now by alice');
      expect(mail.html).toContain('host-1');
      expect(mail.attachments.map((a: { filename: string }) => a.filename)).toEqual([
        expect.stringMatching(/\.ics$/),
      ]);
      expect(mail.attachments[0].content).toContain('UID:n1@projectachilles');

      expect(getNextTask('agent-001', at(5 * MIN - 1000))).toBeNull();
      expect(getNextTask('agent-001', at(5 * MIN))?.id).toBe('t1');
    });

    it('links to the tasks page from the first CORS_ORIGIN entry', async () => {
      process.env.CORS_ORIGIN = 'https://pa.example.test,https://other.example.test';
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      expect(mockSendMail.mock.calls[0][1].html).toContain('https://pa.example.test/endpoints/tasks');
    });

    it('falls back to localhost:5173 when CORS_ORIGIN is unset', async () => {
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      expect(mockSendMail.mock.calls[0][1].html).toContain('http://localhost:5173/endpoints/tasks');
    });

    it('two concurrent sends call sendMail once (Review Focus 2)', async () => {
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      const results = await Promise.all([sendNotice('n1', NOW), sendNotice('n1', NOW)]);
      expect(results.sort()).toEqual(['not_claimed', 'sent']);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('a claim 6 minutes old is reclaimable; 4 minutes old is not', async () => {
      insertPendingNotice('stale', { claim_at: at(-6 * MIN).toISOString() });
      linkTask('t1', 'stale');
      insertPendingNotice('fresh', { claim_at: at(-4 * MIN).toISOString() });
      linkTask('t2', 'fresh');

      expect(await sendNotice('fresh', NOW)).toBe('not_claimed');
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(await sendNotice('stale', NOW)).toBe('sent');
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('a sender whose claim was taken over cannot clear the new claim, record, or alert', async () => {
      writeSettings({ slack: true });
      insertPendingNotice('n1');
      linkTask('t1', 'n1');

      let failA!: (e: Error) => void;
      let acceptB!: (v: { accepted: string[]; rejected: string[] }) => void;
      mockSendMail
        .mockImplementationOnce(() => new Promise((_res, rej) => { failA = rej; }))
        .mockImplementationOnce(() => new Promise((res) => { acceptB = res; }));

      // A claims at NOW and hangs; B takes over once A's claim is stale.
      const a = sendNotice('n1', NOW);
      const takeover = at(6 * MIN);
      const b = sendNotice('n1', takeover);
      // Both claims are taken synchronously; the sends follow the user lookup.
      expect(notice('n1').claim_at).toBe(takeover.toISOString());
      await flush();
      expect(mockSendMail).toHaveBeenCalledTimes(2);
      expect(notice('n1').claim_at).toBe(takeover.toISOString());

      // A fails late: it no longer owns the claim, so nothing is written or alerted.
      failA(new Error('socket timeout'));
      expect(await a).toBe('not_claimed');
      expect(notice('n1')).toMatchObject({
        state: 'pending',
        attempts: 0,
        last_error: null,
        claim_at: takeover.toISOString(),
        slack_failure_alerted: 0,
      });
      expect(mockSendSlackText).not.toHaveBeenCalled();

      // A third sender cannot claim while B holds a fresh claim.
      expect(await sendNotice('n1', at(7 * MIN))).toBe('not_claimed');
      expect(mockSendMail).toHaveBeenCalledTimes(2);

      acceptB({ accepted: [...RECIPIENTS], rejected: [] });
      expect(await b).toBe('sent');
      expect(notice('n1')).toMatchObject({ state: 'sent', sent_at: takeover.toISOString(), claim_at: null });
    });

    it('a late success after takeover does not overwrite the new owner', async () => {
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      let acceptA!: (v: { accepted: string[]; rejected: string[] }) => void;
      mockSendMail
        .mockImplementationOnce(() => new Promise((res) => { acceptA = res; }))
        .mockImplementationOnce(() => new Promise(() => {}));
      const a = sendNotice('n1', NOW);
      const takeover = at(6 * MIN);
      void sendNotice('n1', takeover);
      await flush();
      acceptA({ accepted: [...RECIPIENTS], rejected: [] });
      expect(await a).toBe('not_claimed');
      expect(notice('n1')).toMatchObject({ state: 'pending', sent_at: null, claim_at: takeover.toISOString() });
    });

    it('partial rejection keeps the notice pending and the task held (Review Focus 3)', async () => {
      mockSendMail.mockResolvedValue({ accepted: ['a@x.com'], rejected: ['b@x.com'] });
      insertPendingNotice('n1');
      linkTask('t1', 'n1');

      expect(await sendNotice('n1', NOW)).toBe('failed');

      const n = notice('n1');
      expect(n.state).toBe('pending');
      expect(n.attempts).toBe(1);
      expect(n.last_error).toContain('b@x.com');
      expect(n.claim_at).toBeNull();
      expect(n.release_at).toBeNull();
      expect(getNextTask('agent-001', at(60 * MIN))).toBeNull();
    });

    it('a send error records attempts and alerts Slack once per notice', async () => {
      writeSettings({ slack: true });
      mockSendMail.mockRejectedValue(new Error('Invalid login'));
      insertPendingNotice('7f3c9a00-0000-0000-0000-000000000000');
      linkTask('t1', '7f3c9a00-0000-0000-0000-000000000000');
      const id = '7f3c9a00-0000-0000-0000-000000000000';

      expect(await sendNotice(id, NOW)).toBe('failed');
      expect(notice(id)).toMatchObject({ state: 'pending', attempts: 1, last_error: 'Invalid login', slack_failure_alerted: 1 });
      expect(mockSendSlackText).toHaveBeenCalledTimes(1);
      expect(mockSendSlackText).toHaveBeenCalledWith(
        'https://hooks.slack.test/abc',
        'Notice PA-RUN-7f3c9a could not be sent: Invalid login. Tests are waiting.',
      );

      expect(await sendNotice(id, at(MIN))).toBe('failed');
      expect(notice(id)).toMatchObject({ attempts: 2 });
      expect(mockSendSlackText).toHaveBeenCalledTimes(1);
    });

    it('a failed Slack alert is unflagged so the next failure retries it', async () => {
      writeSettings({ slack: true });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSendMail.mockRejectedValue(new Error('Invalid login'));
      mockSendSlackText.mockRejectedValueOnce(new Error('slack down'));
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      expect(notice('n1').slack_failure_alerted).toBe(0);
      await sendNotice('n1', at(MIN));
      expect(mockSendSlackText).toHaveBeenCalledTimes(2);
      expect(notice('n1').slack_failure_alerted).toBe(1);
      errSpy.mockRestore();
    });

    it('does not alert Slack when Slack is not configured', async () => {
      mockSendMail.mockRejectedValue(new Error('Invalid login'));
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      expect(mockSendSlackText).not.toHaveBeenCalled();
      expect(notice('n1').slack_failure_alerted).toBe(0);
    });

    it('a run notice with no linked tasks is skipped and never emailed (Review Focus 4)', async () => {
      insertPendingNotice('orphan', { source_type: 'schedule', schedule_ids: '["s1"]' });
      expect(await sendNotice('orphan', NOW)).toBe('skipped');
      expect(notice('orphan')).toMatchObject({ state: 'skipped', skip_reason: 'no tasks were created', claim_at: null });
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('a notice that is not pending is not claimed', async () => {
      insertPendingNotice('n1', { state: 'sent' });
      linkTask('t1', 'n1');
      expect(await sendNotice('n1', NOW)).toBe('not_claimed');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('an invalid timezone falls back to UTC instead of failing the send', async () => {
      insertPendingNotice('n1', { timezone: 'Not/AZone' });
      linkTask('t1', 'n1');
      expect(await sendNotice('n1', NOW)).toBe('sent');
      expect(mockSendMail.mock.calls[0][1].subject).toContain('UTC');
    });

    it('schedule trigger names every schedule on a batched tick notice', async () => {
      testDb.prepare(`
        INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name, schedule_type, schedule_config, created_by)
        VALUES ('s1', 'Nightly', '[]', 'org-001', 'u', 'n', 'b', 'daily', '{}', 'bob'),
               ('s2', NULL, '[]', 'org-001', 'u', 'n', 'b', 'daily', '{}', 'bob')
      `).run();
      insertPendingNotice('n1', { source_type: 'schedule', schedule_ids: '["s1","s2"]', created_by: 'bob' });
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      const html = mockSendMail.mock.calls[0][1].html as string;
      expect(html).toContain('Schedule &quot;Nightly&quot;, Schedule &quot;s2&quot;');
    });

    it('Run Now trigger shows the Clerk user name and email, not the raw id', async () => {
      mockGetUser.mockResolvedValueOnce({
        firstName: 'Jane', lastName: 'Doe', primaryEmailAddressId: 'e1',
        emailAddresses: [{ id: 'e1', emailAddress: 'jane@x.io' }],
      });
      insertPendingNotice('n1', { created_by: 'user_39ywWnG' });
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      const mail = mockSendMail.mock.calls[0][1];
      expect(mail.html).toContain('Run Now by Jane Doe (jane@x.io)');
      expect(mail.html).not.toContain('user_39ywWnG');
      expect(mockGetUser).toHaveBeenCalledWith('user_39ywWnG');
    });

    describe('tests table', () => {
      afterEach(() => mockGetTestMetadata.mockImplementation(() => null));

      it('shows each test UUID and its stage count from the test library', async () => {
        mockGetTestMetadata.mockImplementation((u: string) =>
          u === 'test-uuid-001' ? { category: 'intel-driven', stages: [{}, {}, {}] } : null,
        );
        insertPendingNotice('n1');
        linkTask('t1', 'n1');
        await sendNotice('n1', NOW);
        const html = mockSendMail.mock.calls[0][1].html as string;
        expect(html).toContain('test-uuid-001');
        expect(html).toMatch(/text-align:center;white-space:nowrap;">3</);
        expect(html).not.toContain('high /');
      });

      it('a single-binary test counts as 1 stage; a test missing from the library shows a dash', async () => {
        mockGetTestMetadata.mockImplementation((u: string) =>
          u === 'test-uuid-001' ? { category: 'mitre-top10', stages: [] } : null,
        );
        insertPendingNotice('n1');
        linkTask('t1', 'n1');
        linkTask('t2', 'n1', 'agent-001', { test_uuid: 'gone-uuid', test_name: 'Removed test' });
        await sendNotice('n1', NOW);
        const html = mockSendMail.mock.calls[0][1].html as string;
        expect(html).toMatch(/white-space:nowrap;">1</);
        expect(html).toMatch(/white-space:nowrap;">—</);
      });

      it('a bundle shows the control count of its last completed run, or "bundle" before it has run', async () => {
        mockGetTestMetadata.mockImplementation((u: string) =>
          u === 'test-uuid-001' ? { category: 'cyber-hygiene', stages: [] } : null,
        );
        insertPendingNotice('n1');
        linkTask('t1', 'n1');
        await sendNotice('n1', NOW);
        expect(mockSendMail.mock.calls[0][1].html).toMatch(/white-space:nowrap;">bundle</);

        // Two earlier completed runs: the newer one (52 controls) wins.
        const done = (id: string, n: number, completedAt: string) => {
          insertTestTask(testDb, { id, agent_id: 'agent-001', status: 'completed', payload: JSON.stringify({ test_uuid: 'test-uuid-001' }) });
          testDb.prepare('UPDATE tasks SET result = ?, completed_at = ? WHERE id = ?').run(
            JSON.stringify({ exit_code: 126, bundle_results: { controls: Array.from({ length: n }, (_, i) => ({ control_id: `C-${i}` })) } }),
            completedAt, id,
          );
        };
        done('old', 48, '2026-10-01 10:00:00');
        done('new', 52, '2026-10-20 10:00:00');
        mockSendMail.mockClear();
        insertPendingNotice('n2');
        linkTask('t2', 'n2');
        await sendNotice('n2', NOW);
        expect(mockSendMail.mock.calls[0][1].html).toMatch(/white-space:nowrap;">52 controls</);
      });
    });

    it('manual retry trigger text', async () => {
      insertPendingNotice('n1', { source_type: 'manual_retry', created_by: 'carol' });
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      expect(mockSendMail.mock.calls[0][1].html).toContain('Manual retry by carol');
    });

    it('uses the longest linked execution_timeout for window_end', async () => {
      insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      linkTask('t2', 'n1', 'agent-002', { execution_timeout: 900 });
      await sendNotice('n1', NOW);
      expect(notice('n1').window_end).toBe(at(125 * MIN + 900_000).toISOString());
    });

    it('attaches the full host list as CSV when over 50 hosts', async () => {
      insertPendingNotice('n1');
      for (let i = 0; i < 51; i++) {
        const agentId = `bulk-${i}`;
        insertTestAgent(testDb, { id: agentId, hostname: `bulk-host-${i}` });
        linkTask(`bt-${i}`, 'n1', agentId);
      }
      await sendNotice('n1', NOW);
      const mail = mockSendMail.mock.calls[0][1];
      const csv = mail.attachments.find((a: { filename: string }) => a.filename.endsWith('.csv'));
      expect(csv).toBeDefined();
      expect(csv.content).toContain('bulk-host-50');
    });

    it('day notice: release via computeDayRelease (pickup deadline = day window end)', async () => {
      insertTestAgent(testDb, { id: 'agent-002', hostname: 'announced-host', last_heartbeat: at(-10 * MIN).toISOString() });
      insertPendingNotice('d1', {
        kind: 'day',
        source_type: 'schedule',
        schedule_ids: '["s1"]',
        schedule_id: 's1',
        window_date: '2026-10-23',
        announced_agent_ids: '["agent-001","agent-002"]',
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T17:00:00.000Z',
      });
      linkTask('t1', 'd1');
      expect(await sendNotice('d1', NOW)).toBe('sent');
      const n = notice('d1');
      expect(n.release_at).toBe(at(5 * MIN).toISOString());
      expect(n.pickup_deadline).toBe('2026-10-23T17:00:00.000Z');
      expect(n.window_end).toBe(new Date(Date.parse('2026-10-23T17:00:00.000Z') + 300_000).toISOString());
      const html = mockSendMail.mock.calls[0][1].html as string;
      expect(html).toContain('announced-host');
      expect(html).toContain('Hosts (2)');
    });
    it('day notice accepted 3 minutes before its window end still releases its task', async () => {
      const late = new Date('2026-10-23T16:57:00.000Z');
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(late.toISOString(), 'agent-001');
      insertPendingNotice('d1', {
        kind: 'day',
        source_type: 'schedule',
        schedule_ids: '["s1"]',
        schedule_id: 's1',
        window_date: '2026-10-23',
        announced_agent_ids: '["agent-001"]',
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T17:00:00.000Z',
        created_at: late.toISOString(),
      });
      linkTask('t1', 'd1');
      expect(await sendNotice('d1', late)).toBe('sent');
      const n = notice('d1');
      expect(n.release_at).toBe('2026-10-23T17:02:00.000Z');
      expect(n.pickup_deadline).toBe('2026-10-23T19:02:00.000Z');
      expect(n.window_end).toBe('2026-10-23T19:07:00.000Z');
      // The email announces the same deadline, never one before the release.
      expect(mockSendMail.mock.calls[0][1].html).toContain('2026-10-23 19:02');
      expect(getNextTask('agent-001', new Date('2026-10-23T17:02:00.000Z'))?.id).toBe('t1');
    });
  });

  describe('retries (I1)', () => {
    it('a run notice whose linked tasks are no longer pending is skipped and never emailed', async () => {
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      testDb.prepare(`UPDATE tasks SET status = 'expired' WHERE id = 't1'`).run();
      expect(await sendNotice('n1', NOW)).toBe('skipped');
      expect(notice('n1')).toMatchObject({
        state: 'skipped',
        skip_reason: 'all linked tasks were cancelled or completed',
        claim_at: null,
      });
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('a day notice whose linked tasks were all cancelled sends nothing and stays pending for later agents', async () => {
      insertPendingNotice('d1', {
        kind: 'day',
        source_type: 'schedule',
        schedule_ids: '["s1"]',
        schedule_id: 's1',
        window_date: '2026-10-23',
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T17:00:00.000Z',
      });
      linkTask('t1', 'd1');
      testDb.prepare(`UPDATE tasks SET status = 'expired' WHERE id = 't1'`).run();
      expect(await sendNotice('d1', NOW)).toBe('not_claimed');
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(notice('d1')).toMatchObject({ state: 'pending', claim_at: null });
    });

    it('each attempt uses the current recipients and records them on the notice', async () => {
      mockSendMail.mockResolvedValueOnce({ accepted: ['a@x.com'], rejected: ['b@x.com'] });
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      expect(await sendNotice('n1', NOW)).toBe('failed');
      expect(JSON.parse(notice('n1').recipients as string)).toEqual(RECIPIENTS);

      // The typo is fixed in settings between attempts.
      writeSettings({ recipients: ['a@x.com', 'c@x.com'] });
      mockSendMail.mockResolvedValueOnce({ accepted: ['a@x.com', 'c@x.com'], rejected: [] });
      vi.setSystemTime(at(2 * MIN));
      expect(await sendNotice('n1', at(2 * MIN))).toBe('sent');
      expect(mockSendMail.mock.calls[1][1].to).toEqual(['a@x.com', 'c@x.com']);
      const n = notice('n1');
      expect(JSON.parse(n.recipients as string)).toEqual(['a@x.com', 'c@x.com']);
      expect(JSON.parse(n.accepted as string)).toEqual(['a@x.com', 'c@x.com']);
      expect(JSON.parse(n.rejected as string)).toEqual([]);
    });

    it('falls back to the notice\'s own recipients when settings have none', async () => {
      writeSettings({ recipients: [] });
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      expect(await sendNotice('n1', NOW)).toBe('sent');
      expect(mockSendMail.mock.calls[0][1].to).toEqual(RECIPIENTS);
    });

    it('records last_attempt_at on failure and on success', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('Invalid login'));
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      await sendNotice('n1', NOW);
      expect(notice('n1').last_attempt_at).toBe(NOW.toISOString());
      vi.setSystemTime(at(3 * MIN));
      await sendNotice('n1', at(3 * MIN));
      expect(notice('n1').last_attempt_at).toBe(at(3 * MIN).toISOString());
    });
  });

  describe('acceptance time (I3)', () => {
    it('counts the lead time from when the mail server accepted, not from the pass start', async () => {
      insertPendingNotice('n1');
      linkTask('t1', 'n1');
      mockSendMail.mockImplementationOnce(async () => {
        // SMTP takes 90 seconds to accept.
        vi.setSystemTime(at(90_000));
        return { accepted: [...RECIPIENTS], rejected: [] };
      });
      expect(await sendNotice('n1', NOW)).toBe('sent');
      const n = notice('n1');
      expect(n.sent_at).toBe(at(90_000).toISOString());
      expect(n.release_at).toBe(at(90_000 + 5 * MIN).toISOString());
      expect(n.pickup_deadline).toBe(at(90_000 + 125 * MIN).toISOString());
      expect(n.window_end).toBe(at(90_000 + 125 * MIN + 300_000).toISOString());
      // The email promised "not before NOW+5m"; the stored release is never earlier.
      expect(mockSendMail.mock.calls[0][1].html).toContain('2026-10-23 12:05');
      expect(getNextTask('agent-001', at(5 * MIN))).toBeNull();
      expect(getNextTask('agent-001', at(90_000 + 5 * MIN))?.id).toBe('t1');
    });
  });

  describe('scheduler tick', () => {
    it('two runNoticeFor calls in one tick share one notice listing both schedules', () => {
      const tick = createSchedulerTick(NOW);
      const a = tick.runNoticeFor('s1', 'UTC', 'bob', null);
      expect(JSON.parse(notice(a!).schedule_ids as string)).toEqual([]);
      tick.confirmRunSchedule('s1', null);
      const b = tick.runNoticeFor('s2', 'America/New_York', 'bob', null);
      tick.confirmRunSchedule('s2', null);
      expect(a).toEqual(expect.any(String));
      expect(b).toBe(a);
      const n = notice(a!);
      expect(JSON.parse(n.schedule_ids as string)).toEqual(['s1', 's2']);
      expect(n).toMatchObject({ kind: 'run', state: 'pending', source_type: 'schedule', timezone: 'UTC', created_at: NOW.toISOString() });

      const other = createSchedulerTick(at(MIN)).runNoticeFor('s1', 'UTC', 'bob', null);
      expect(other).not.toBe(a);
    });

    it('runNoticeFor and dayNoticeFor return null when the gate is disabled', () => {
      writeSettings({ enabled: false });
      const tick = createSchedulerTick(NOW);
      expect(tick.runNoticeFor('s1', 'UTC', 'bob', null)).toBeNull();
      expect(
        tick.dayNoticeFor({ id: 's1', org_id: null, timezone: 'UTC', created_by: 'bob', agent_next_runs: {}, execution_timeout: 300 }),
      ).toBeNull();
      expect(countNotices()).toBe(0);
    });

    it('hasPendingRunNotice reflects pending run notices containing the schedule', () => {
      const tick = createSchedulerTick(NOW);
      expect(tick.hasPendingRunNotice('s1', null)).toBe(false);
      const id = tick.runNoticeFor('s1', 'UTC', 'bob', null)!;
      // Not listed until confirmed.
      expect(tick.hasPendingRunNotice('s1', null)).toBe(false);
      tick.confirmRunSchedule('s1', null);
      tick.runNoticeFor('s2', 'UTC', 'bob', null);
      tick.confirmRunSchedule('s2', null);
      expect(tick.hasPendingRunNotice('s1', null)).toBe(true);
      expect(tick.hasPendingRunNotice('s2', null)).toBe(true);
      expect(tick.hasPendingRunNotice('s3', null)).toBe(false);
      testDb.prepare(`UPDATE run_notices SET state = 'sent' WHERE id = ?`).run(id);
      expect(tick.hasPendingRunNotice('s1', null)).toBe(false);
    });

    it('recordSkippedOccurrence inserts a skipped run notice', () => {
      const tick = createSchedulerTick(NOW);
      tick.recordSkippedOccurrence('s1', 'bob', 'UTC', null);
      const rows = testDb.prepare('SELECT * FROM run_notices').all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'run',
        state: 'skipped',
        skip_reason: 'previous run still waiting for notice delivery',
        schedule_ids: '["s1"]',
        created_by: 'bob',
        created_at: NOW.toISOString(),
      });
      expect(tick.hasPendingRunNotice('s1', null)).toBe(false);
    });

    it('dayNoticeFor: same schedule and day -> same id; different day -> different id', () => {
      const schedule = {
        id: 's1',
        org_id: null,
        timezone: 'UTC',
        created_by: 'bob',
        agent_next_runs: {
          'agent-in-1': '2026-10-23T11:59:00.000Z',
          'agent-in-2': '2026-10-23T16:30:00.000Z',
          'agent-tomorrow': '2026-10-24T10:00:00.000Z',
          'agent-early': '2026-10-23T08:00:00.000Z',
        },
        execution_timeout: 300,
      };
      const first = createSchedulerTick(NOW).dayNoticeFor(schedule);
      const again = createSchedulerTick(at(30 * MIN)).dayNoticeFor(schedule);
      expect(first).toEqual(expect.any(String));
      expect(again).toBe(first);

      const n = notice(first!);
      expect(n).toMatchObject({
        kind: 'day',
        state: 'pending',
        schedule_id: 's1',
        window_date: '2026-10-23',
        day_window_start: '2026-10-23T09:00:00.000Z',
        day_window_end: '2026-10-23T17:00:00.000Z',
        created_at: NOW.toISOString(),
      });
      expect(JSON.parse(n.announced_agent_ids as string).sort()).toEqual(['agent-in-1', 'agent-in-2']);

      const nextDay = createSchedulerTick(at(24 * 60 * MIN)).dayNoticeFor(schedule);
      expect(nextDay).not.toBe(first);
      expect(notice(nextDay!).window_date).toBe('2026-10-24');
    });

    it('dayNoticeFor with an invalid timezone falls back to UTC', () => {
      const id = createSchedulerTick(NOW).dayNoticeFor({
        id: 's1', org_id: null, timezone: 'Not/AZone', created_by: 'bob', agent_next_runs: {}, execution_timeout: 300,
      });
      expect(notice(id!)).toMatchObject({ timezone: 'UTC', window_date: '2026-10-23' });
    });
  });
});
