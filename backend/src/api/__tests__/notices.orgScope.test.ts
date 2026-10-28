/**
 * Ruling R20: pre-execution notices are per organization, with the legacy
 * top level of integrations.json as the fallback (same model as Alerts).
 * A notice belongs to the org of the tasks it gates; every route that takes a
 * notice id or returns notice data is scoped to the caller's Clerk org.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../../services/agent/test-catalog.service.js', () => ({ getTestMetadata: () => null }));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-notices-orgscope-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

// The caller's Clerk auth for the next request. getUserOrgId and
// validateRequestOrgId keep their real semantics.
let currentAuth: Record<string, unknown> = { userId: 'u1' };
vi.mock('../../middleware/clerk.middleware.js', async () => {
  const { AppError } = await import('../../middleware/error.middleware.js');
  const getUserOrgId = (auth: any) => auth?.orgId ?? auth?.sessionClaims?.org_id ?? undefined;
  return {
    requireClerkAuth: () => (req: any, _res: any, next: any) => { req.auth = currentAuth; next(); },
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
    hasRequestPermission: () => true,
    getUserId: (auth: any) => auth?.userId,
    getUserOrgId,
    validateRequestOrgId: (reqOrgId: string, auth: any) => {
      const userOrg = getUserOrgId(auth);
      if (userOrg && reqOrgId !== userOrg) throw new AppError('org_id does not match your organization', 403);
    },
  };
});

const { mockSendMail, mockTestEmailConnection, mockSendSlackText } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockTestEmailConnection: vi.fn(),
  mockSendSlackText: vi.fn(),
}));
vi.mock('../../services/alerts/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/alerts/email.service.js')>();
  return { ...actual, sendMail: mockSendMail, testEmailConnection: mockTestEmailConnection };
});
vi.mock('../../services/alerts/slack.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/alerts/slack.service.js')>();
  return { ...actual, sendSlackText: mockSendSlackText };
});

vi.mock('../integrations.routes.js', () => ({ alertsService: {} }));
vi.mock('../../services/agent/results.service.js', () => ({ ingestResult: vi.fn() }));
vi.mock('../../services/agent/ingestionWorker.service.js', () => ({ retryPendingIngestions: vi.fn() }));

const { default: noticesRoutes } = await import('../notices.routes.js');
const { adminTasksRouter } = await import('../agent/tasks.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');
const { IntegrationsSettingsService } = await import('../../services/integrations/settings.js');
const { processNotices } = await import('../../services/notices/notices.service.js');
const { processSchedules } = await import('../../services/agent/schedules.service.js');

const HOME = os.homedir();
const SETTINGS_DIR = path.join(HOME, '.projectachilles');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'integrations.json');
const TEST_UUID = 'test-uuid-001';
const MIN = 60_000;

const ORG_A = 'org_A';
const ORG_B = 'org_B';
const asOrg = (orgId: string) => { currentAuth = { userId: `user-${orgId}`, orgId }; };
const asNoOrg = () => { currentAuth = { userId: 'u-legacy' }; };

function email(host: string, from: string) {
  return {
    smtp_host: host,
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'user',
    smtp_pass: 'pass',
    from_address: from,
    recipients: [],
    configured: true,
    enabled: true,
  };
}

function alerts(host: string, from: string) {
  return { thresholds: { enabled: false }, cooldown_minutes: 15, email: email(host, from) };
}

function writeFile(body: Record<string, unknown>) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(body));
}

const readFile = () => JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));

/** Legacy SMTP + two orgs, each with its own SMTP; notice settings as given. */
function writeOrgSettings(notices: { legacy?: object; a?: object; b?: object } = {}) {
  const orgs: Record<string, Record<string, unknown>> = {
    [ORG_A]: { alerts: alerts('smtp.a.test', 'pa@a.test') },
    [ORG_B]: { alerts: alerts('smtp.b.test', 'pa@b.test') },
  };
  if (notices.a) orgs[ORG_A].pre_execution_notices = notices.a;
  if (notices.b) orgs[ORG_B].pre_execution_notices = notices.b;
  writeFile({
    alerts: alerts('smtp.legacy.test', 'pa@legacy.test'),
    ...(notices.legacy ? { pre_execution_notices: notices.legacy } : {}),
    orgs,
  });
}

function writeBuild(testUuid = TEST_UUID) {
  const dir = path.join(SETTINGS_DIR, 'builds', testUuid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'test.exe'), 'binary');
  fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify({ binary_name: 'test.exe' }));
}

function insertNotice(id: string, orgId: string | null, opts: { state?: string; createdAt?: string; kind?: string } = {}) {
  testDb.prepare(`
    INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients, org_id)
    VALUES (?, ?, ?, 'run_now', 'UTC', 'u1', ?, '["x@x.test"]', ?)
  `).run(id, opts.kind ?? 'run', opts.state ?? 'pending', opts.createdAt ?? new Date().toISOString(), orgId);
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/notices', noticesRoutes);
  a.use('/api/agent/admin', (req: any, _res: any, next: any) => { req.auth = currentAuth; next(); }, adminTasksRouter);
  a.use(errorHandler);
  return a;
}

const runNow = (orgId: string, agentId: string) =>
  request(app()).post('/api/agent/admin/tasks').send({
    org_id: orgId,
    agent_ids: [agentId],
    test_uuid: TEST_UUID,
    test_name: 'T',
    binary_name: 'test.exe',
  });

const noticeRows = () =>
  testDb.prepare('SELECT id, org_id, state, recipients FROM run_notices ORDER BY created_at, id').all() as Array<{
    id: string; org_id: string | null; state: string; recipients: string;
  }>;

/** The mail settings + mail of every sendMail call. */
const mailCalls = () =>
  mockSendMail.mock.calls.map(([settings, mail]) => ({ host: settings.smtp_host as string, pass: settings.smtp_pass as string, to: mail.to as string[] }));

beforeEach(() => {
  testDb = createTestDatabase();
  asNoOrg();
  delete process.env.REQUIRE_ORG_ISOLATION;
  mockSendMail.mockReset();
  mockSendMail.mockImplementation(async (_s: unknown, mail: { to: string[] }) => ({ accepted: [...mail.to], rejected: [] }));
  mockTestEmailConnection.mockReset();
  mockTestEmailConnection.mockResolvedValue({ success: true, message: 'ok' });
  mockSendSlackText.mockReset();
  fs.rmSync(SETTINGS_DIR, { recursive: true, force: true });
  writeOrgSettings();
});

afterEach(() => {
  delete process.env.REQUIRE_ORG_ISOLATION;
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('schema', () => {
  it('run_notices has a nullable org_id and an (org_id, state) index', () => {
    const cols = testDb.prepare('PRAGMA table_info(run_notices)').all() as Array<{ name: string; notnull: number }>;
    expect(cols.find((c) => c.name === 'org_id')).toMatchObject({ notnull: 0 });
    const idx = testDb.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_run_notices_org_state'`).get() as { sql: string } | undefined;
    expect(idx?.sql).toMatch(/run_notices\s*\(\s*org_id\s*,\s*state\s*\)/);
  });
});

describe('1. POST /api/notices/:id/release is org-scoped', () => {
  beforeEach(() => {
    insertNotice('n-a', ORG_A);
    insertNotice('n-b', ORG_B);
    insertNotice('n-null', null);
  });
  const release = (id: string) => request(app()).post(`/api/notices/${id}/release`).send({ reason: 'phone call' });
  const stateOf = (id: string) => (testDb.prepare('SELECT state FROM run_notices WHERE id = ?').get(id) as { state: string }).state;

  it("org A cannot release org B's notice: 404 Notice not found, notice untouched", async () => {
    asOrg(ORG_A);
    const res = await release('n-b');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Notice not found');
    expect(stateOf('n-b')).toBe('pending');
  });

  it('org A cannot release a notice that has no org (legacy row)', async () => {
    asOrg(ORG_A);
    const res = await release('n-null');
    expect(res.status).toBe(404);
    expect(stateOf('n-null')).toBe('pending');
  });

  it('org A releases its own notice', async () => {
    asOrg(ORG_A);
    const res = await release('n-a');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'n-a', state: 'overridden' });
  });

  it('a no-org caller (legacy single-org mode) may release any notice', async () => {
    asNoOrg();
    const res = await release('n-b');
    expect(res.status).toBe(200);
    expect(stateOf('n-b')).toBe('overridden');
  });

  it('a no-org caller is rejected with 403 under REQUIRE_ORG_ISOLATION=true', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    asNoOrg();
    const res = await release('n-b');
    expect(res.status).toBe(403);
    expect(stateOf('n-b')).toBe('pending');
  });
});

describe('2b. GET /api/notices/status reports advance digests', () => {
  const day = (offset: number) => new Date(Date.now() - offset * 24 * 3600_000).toISOString().slice(0, 10);
  function insertDigest(orgId: string, digestDate: string, over: Record<string, unknown> = {}) {
    testDb.prepare(`INSERT INTO notice_digests
      (id, org_id, digest_date, run_date, timezone, state, attempts, last_error, occurrence_count, host_count, recipients, created_at, sent_at)
      VALUES (?, ?, ?, ?, 'UTC', ?, 1, ?, ?, ?, ?, ?, ?)`).run(
      `${orgId}-${digestDate}`, orgId, digestDate, digestDate,
      over.state ?? 'sent', over.lastError ?? null, over.occ ?? 3, over.hosts ?? 2,
      'recipients' in over ? over.recipients : JSON.stringify(['x@a.test', 'y@a.test']), new Date().toISOString(), 'sentAt' in over ? over.sentAt : new Date().toISOString(),
    );
  }
  beforeEach(() => {
    insertDigest(ORG_A, day(0));
    insertDigest(ORG_B, day(1), { state: 'failed', lastError: 'smtp down', recipients: null, sentAt: null });
  });

  it('an org caller gets only its own digest', async () => {
    asOrg(ORG_A);
    const res = await request(app()).get('/api/notices/status');
    expect(res.body.data.digests).toEqual([
      expect.objectContaining({ orgId: ORG_A, digestDate: day(0), state: 'sent', occurrenceCount: 3, hostCount: 2, recipientCount: 2, lastError: null }),
    ]);
  });

  it('a no-org caller gets every org, with failed rows and 0 recipients', async () => {
    asNoOrg();
    const res = await request(app()).get('/api/notices/status');
    expect(res.body.data.digests.map((d: { orgId: string }) => d.orgId)).toEqual([ORG_A, ORG_B]);
    expect(res.body.data.digests[1]).toMatchObject({ state: 'failed', lastError: 'smtp down', recipientCount: 0, sentAt: null });
  });

  it('a no-org caller still gets 403 under REQUIRE_ORG_ISOLATION=true', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    asNoOrg();
    expect((await request(app()).get('/api/notices/status')).status).toBe(403);
  });

  it('digests older than 7 days are not returned; the array is still present', async () => {
    insertDigest('org_old', day(8));
    asOrg('org_old');
    const res = await request(app()).get('/api/notices/status');
    expect(res.status).toBe(200);
    expect(res.body.data.digests).toEqual([]);
  });
});

describe('2. GET /api/notices and /status are org-scoped', () => {
  const old = new Date(Date.now() - 30 * MIN).toISOString();
  beforeEach(() => {
    insertNotice('a-pending', ORG_A, { createdAt: old });
    insertNotice('a-nd', ORG_A, { state: 'not_delivered', createdAt: old });
    insertNotice('b-pending-1', ORG_B, { createdAt: old });
    insertNotice('b-pending-2', ORG_B, { createdAt: old });
    insertNotice('b-nd', ORG_B, { state: 'not_delivered', createdAt: old });
    insertNotice('null-pending', null, { createdAt: old });
  });

  it("org A lists only org A's notices", async () => {
    asOrg(ORG_A);
    const res = await request(app()).get('/api/notices?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.data.map((n: { id: string }) => n.id).sort()).toEqual(['a-nd', 'a-pending']);
  });

  it("org A's status counts only org A's notices", async () => {
    asOrg(ORG_A);
    const res = await request(app()).get('/api/notices/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ pendingOverdue: 1, notDeliveredLast7d: 1 });
    asOrg(ORG_B);
    const b = await request(app()).get('/api/notices/status');
    expect(b.body.data).toMatchObject({ pendingOverdue: 2, notDeliveredLast7d: 1 });
  });

  it('a no-org caller (legacy single-org mode) sees every notice', async () => {
    asNoOrg();
    const list = await request(app()).get('/api/notices?limit=100');
    expect(list.body.data).toHaveLength(6);
    const status = await request(app()).get('/api/notices/status');
    expect(status.body.data).toMatchObject({ pendingOverdue: 4, notDeliveredLast7d: 2 });
  });

  it('a no-org caller gets 403 from both under REQUIRE_ORG_ISOLATION=true', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    asNoOrg();
    expect((await request(app()).get('/api/notices')).status).toBe(403);
    expect((await request(app()).get('/api/notices/status')).status).toBe(403);
  });

  it("the status SMTP check comes from the caller's org settings", async () => {
    writeOrgSettings({
      legacy: { enabled: true, recipients: ['l@legacy.test'], last_smtp_check_at: new Date().toISOString(), last_smtp_check_ok: true, last_smtp_check_message: 'legacy ok' },
      a: { enabled: true, recipients: ['a@a.test'], last_smtp_check_at: new Date().toISOString(), last_smtp_check_ok: false, last_smtp_check_message: 'org A down' },
    });
    asOrg(ORG_A);
    const a = await request(app()).get('/api/notices/status');
    expect(a.body.data.smtpCheck).toMatchObject({ ok: false, message: 'org A down' });
    asOrg(ORG_B); // no own section: legacy fallback
    const b = await request(app()).get('/api/notices/status');
    expect(b.body.data.smtpCheck).toMatchObject({ ok: true, message: 'legacy ok' });
  });
});

describe('3. notice settings are per org', () => {
  it("org A's PUT is stored under orgs[A]; org B and the legacy level are unaffected", async () => {
    asOrg(ORG_A);
    const put = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['a@a.test'] });
    expect(put.status).toBe(200);
    const file = readFile();
    expect(file.orgs[ORG_A].pre_execution_notices).toMatchObject({ enabled: true, recipients: ['a@a.test'] });
    expect(file.pre_execution_notices).toBeUndefined();
    expect(file.orgs[ORG_B].pre_execution_notices).toBeUndefined();

    asOrg(ORG_B);
    const getB = await request(app()).get('/api/notices/settings');
    expect(getB.body.data).toMatchObject({ enabled: false, recipients: [] });
    asOrg(ORG_A);
    const getA = await request(app()).get('/api/notices/settings');
    expect(getA.body.data).toMatchObject({ enabled: true, recipients: ['a@a.test'], smtp_configured: true });
  });

  it("org B's Run Now creates no notice while only org A's gate is enabled", async () => {
    writeOrgSettings({ a: { enabled: true, recipients: ['a@a.test'] } });
    writeBuild();
    insertTestAgent(testDb, { id: 'agent-a', org_id: ORG_A });
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });

    asOrg(ORG_B);
    expect((await runNow(ORG_B, 'agent-b')).status).toBe(201);
    expect(noticeRows()).toHaveLength(0);
    const bTask = testDb.prepare("SELECT notice_id FROM tasks WHERE agent_id = 'agent-b'").get() as { notice_id: string | null };
    expect(bTask.notice_id).toBeNull();

    asOrg(ORG_A);
    expect((await runNow(ORG_A, 'agent-a')).status).toBe(201);
    const rows = noticeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe(ORG_A);
  });

  it("settings/test uses the caller org's SMTP and recipients", async () => {
    writeOrgSettings({ a: { enabled: false, recipients: ['a@a.test'] }, legacy: { enabled: false, recipients: ['l@legacy.test'] } });
    asOrg(ORG_A);
    const res = await request(app()).post('/api/notices/settings/test');
    expect(res.status).toBe(200);
    expect(mailCalls()).toEqual([{ host: 'smtp.a.test', pass: 'pass', to: ['a@a.test'] }]);
  });

  it("smtp_configured reflects the caller org's SMTP, else the legacy SMTP", async () => {
    writeFile({
      alerts: alerts('smtp.legacy.test', 'pa@legacy.test'),
      orgs: { [ORG_A]: { alerts: { thresholds: { enabled: false }, cooldown_minutes: 15 } } },
    });
    asOrg(ORG_A); // own alerts section without email: no SMTP for org A
    expect((await request(app()).get('/api/notices/settings')).body.data.smtp_configured).toBe(false);
    const put = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['a@a.test'] });
    expect(put.status).toBe(400);
    asOrg(ORG_B); // no section: legacy SMTP
    expect((await request(app()).get('/api/notices/settings')).body.data.smtp_configured).toBe(true);
  });
});

describe('4. functional: an org user configures SMTP in Alerts, then enables notices', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  it('enables, gates Run Now under org A and mails via org A SMTP + recipients', async () => {
    writeFile({}); // nothing configured anywhere
    // Exactly what AlertsConfig saves through the org-scoped settings service (no `configured`).
    new IntegrationsSettingsService(ORG_A).saveAlertSettings({
      thresholds: { enabled: false },
      slack: { enabled: false },
      email: {
        enabled: true,
        smtp_host: 'smtp.org-a.test',
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: 'user-a',
        smtp_pass: 'secret-a',
        from_address: 'pa@org-a.test',
        recipients: ['ops@org-a.test'],
      },
      agent_alerts: { enabled: false },
    } as any);

    asOrg(ORG_A);
    const put = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['soc@org-a.test'] });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ enabled: true, smtp_configured: true });

    writeBuild();
    insertTestAgent(testDb, { id: 'agent-a', org_id: ORG_A });
    expect((await runNow(ORG_A, 'agent-a')).status).toBe(201);
    const rows = noticeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe(ORG_A);
    expect(JSON.parse(rows[0].recipients)).toEqual(['soc@org-a.test']);

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));
    // Decrypted credentials of org A's SMTP, not the stored ciphertext.
    expect(mailCalls()).toEqual([{ host: 'smtp.org-a.test', pass: 'secret-a', to: ['soc@org-a.test'] }]);
    expect(mockSendMail.mock.calls[0][0].smtp_user).toBe('user-a');
  });
});

describe("5. legacy: tasks with org_id 'default' and settings only at the top level", () => {
  it('gates and mails via the legacy settings', async () => {
    writeFile({ alerts: alerts('smtp.legacy.test', 'pa@legacy.test'), pre_execution_notices: { enabled: true, recipients: ['l@legacy.test'] } });
    writeBuild();
    insertTestAgent(testDb, { id: 'agent-d', org_id: 'default' });
    asNoOrg();
    expect((await runNow('default', 'agent-d')).status).toBe(201);
    const rows = noticeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe('default');
    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));
    expect(mailCalls()).toEqual([{ host: 'smtp.legacy.test', pass: 'pass', to: ['l@legacy.test'] }]);
  });

  it('a manual retry takes the original task org', async () => {
    writeOrgSettings({ a: { enabled: true, recipients: ['a@a.test'] } });
    insertTestAgent(testDb, { id: 'agent-a', org_id: ORG_A });
    insertTestTask(testDb, { id: 'task-old', agent_id: 'agent-a', org_id: ORG_A, status: 'completed' });
    asOrg(ORG_A);
    const res = await request(app()).post('/api/agent/admin/tasks/task-old/retry');
    expect(res.status).toBe(201);
    const rows = noticeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe(ORG_A);
    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));
    expect(mailCalls()[0]).toMatchObject({ host: 'smtp.a.test', to: ['a@a.test'] });
  });

  it("the batch route stamps the request's org", async () => {
    writeOrgSettings({ b: { enabled: true, recipients: ['b@b.test'] } });
    writeBuild();
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });
    asOrg(ORG_B);
    const res = await request(app()).post('/api/agent/admin/tasks/batch').send({
      org_id: ORG_B,
      requests: [{ agent_ids: ['agent-b'], test_uuid: TEST_UUID, test_name: 'T', binary_name: 'test.exe' }],
    });
    expect(res.status).toBe(201);
    expect(noticeRows().map((r) => r.org_id)).toEqual([ORG_B]);
  });
});

describe('R21. grouped task list: the notices map is scoped to the caller org', () => {
  const NA = 'aaaaaa11-0000-0000-0000-000000000000';
  const NB = 'bbbbbb22-0000-0000-0000-000000000000';
  beforeEach(() => {
    insertTestAgent(testDb, { id: 'agent-a', org_id: ORG_A });
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });
    insertNotice(NA, ORG_A);
    insertNotice(NB, ORG_B);
    insertTestTask(testDb, { id: 'task-a', agent_id: 'agent-a', org_id: ORG_A, batch_id: 'batch-a' });
    insertTestTask(testDb, { id: 'task-b', agent_id: 'agent-b', org_id: ORG_B, batch_id: 'batch-b' });
    testDb.prepare('UPDATE tasks SET notice_id = ? WHERE id = ?').run(NA, 'task-a');
    testDb.prepare('UPDATE tasks SET notice_id = ? WHERE id = ?').run(NB, 'task-b');
  });
  const groups = async () => {
    const res = await request(app()).get('/api/agent/admin/tasks/grouped');
    expect(res.status).toBe(200);
    return new Map<string, { notices?: Record<string, unknown> }>(
      res.body.data.groups.map((g: { batch_id: string }) => [g.batch_id, g]),
    );
  };

  it("an org A caller still gets org B's group, but not org B's notice; org A's notice is there", async () => {
    asOrg(ORG_A);
    const g = await groups();
    expect([...g.keys()].sort()).toEqual(['batch-a', 'batch-b']);
    expect(Object.keys(g.get('batch-a')!.notices ?? {})).toEqual([NA]);
    expect(g.get('batch-b')!.notices).toBeUndefined();
  });

  it('a no-org caller sees both notices', async () => {
    asNoOrg();
    const g = await groups();
    expect(Object.keys(g.get('batch-a')!.notices ?? {})).toEqual([NA]);
    expect(Object.keys(g.get('batch-b')!.notices ?? {})).toEqual([NB]);
  });
});

describe('R22. notice settings routes honour REQUIRE_ORG_ISOLATION', () => {
  it('a no-org caller gets 403 from PUT /settings and nothing is written', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    asNoOrg();
    const before = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const put = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['x@x.test'] });
    expect(put.status).toBe(403);
    expect(fs.readFileSync(SETTINGS_FILE, 'utf8')).toBe(before);
    expect((await request(app()).get('/api/notices/settings')).status).toBe(403);
    expect((await request(app()).post('/api/notices/settings/test')).status).toBe(403);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('an org caller is unaffected by REQUIRE_ORG_ISOLATION', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    asOrg(ORG_A);
    const put = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['a@a.test'] });
    expect(put.status).toBe(200);
  });
});

describe('6-8. scheduler and sweeps use the owning org', () => {
  const NOW = new Date('2026-10-23T12:00:00.000Z');
  const METADATA = {
    category: 'test', subcategory: '', severity: 'medium', techniques: [], tactics: [],
    threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [],
  };
  function insertSchedule(id: string, orgId: string, agentIds: string[]) {
    testDb.prepare(`
      INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name, metadata, schedule_type,
        schedule_config, timezone, next_run_at, status, created_by)
      VALUES (?, ?, ?, ?, ?, 'T', 'test.exe', ?, 'daily', '{"time":"12:00"}', 'UTC', ?, 'active', 'creator')
    `).run(id, `Sched ${id}`, JSON.stringify(agentIds), orgId, `uuid-${id}`, JSON.stringify(METADATA),
      new Date(NOW.getTime() - MIN).toISOString());
    writeBuild(`uuid-${id}`);
  }

  it('6. two due fleet schedules in different orgs in one tick get one run notice each', () => {
    writeOrgSettings({ a: { enabled: true, recipients: ['a@a.test'] }, b: { enabled: true, recipients: ['b@b.test'] } });
    insertTestAgent(testDb, { id: 'agent-a', org_id: ORG_A });
    insertTestAgent(testDb, { id: 'agent-a2', org_id: ORG_A });
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });
    insertSchedule('sa1', ORG_A, ['agent-a']);
    insertSchedule('sa2', ORG_A, ['agent-a2']);
    insertSchedule('sb1', ORG_B, ['agent-b']);

    const result = processSchedules(NOW);
    expect(result.errors).toEqual([]);

    const rows = testDb.prepare('SELECT id, org_id, recipients, schedule_ids FROM run_notices').all() as Array<{
      id: string; org_id: string; recipients: string; schedule_ids: string;
    }>;
    expect(rows).toHaveLength(2);
    const byOrg = new Map(rows.map((r) => [r.org_id, r]));
    expect(JSON.parse(byOrg.get(ORG_A)!.schedule_ids).sort()).toEqual(['sa1', 'sa2']);
    expect(JSON.parse(byOrg.get(ORG_A)!.recipients)).toEqual(['a@a.test']);
    expect(JSON.parse(byOrg.get(ORG_B)!.schedule_ids)).toEqual(['sb1']);
    expect(JSON.parse(byOrg.get(ORG_B)!.recipients)).toEqual(['b@b.test']);

    const tasks = testDb.prepare('SELECT org_id, notice_id FROM tasks').all() as Array<{ org_id: string; notice_id: string }>;
    expect(tasks).toHaveLength(3);
    for (const t of tasks) expect(t.notice_id).toBe(byOrg.get(t.org_id)!.id);
  });

  it("6b. a schedule's gate is its own org's: org B (disabled) creates no notice", () => {
    writeOrgSettings({ a: { enabled: true, recipients: ['a@a.test'] } });
    insertTestAgent(testDb, { id: 'agent-a', org_id: ORG_A });
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });
    insertSchedule('sa1', ORG_A, ['agent-a']);
    insertSchedule('sb1', ORG_B, ['agent-b']);
    processSchedules(NOW);
    expect(noticeRows().map((r) => r.org_id)).toEqual([ORG_A]);
    const b = testDb.prepare("SELECT notice_id FROM tasks WHERE org_id = ?").get(ORG_B) as { notice_id: string | null };
    expect(b.notice_id).toBeNull();
  });

  it("6c. a per-machine day notice takes the schedule's org", () => {
    writeOrgSettings({ b: { enabled: true, recipients: ['b@b.test'] } });
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });
    testDb.prepare(`
      INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name, metadata, schedule_type,
        schedule_config, timezone, next_run_at, status, created_by, agent_next_runs)
      VALUES ('pm', 'PM', '["agent-b"]', ?, 'uuid-pm', 'T', 'test.exe', ?, 'daily',
        '{"time":"12:00","randomize_time":true,"randomize_mode":"per_machine"}', 'UTC', ?, 'active', 'creator', ?)
    `).run(ORG_B, JSON.stringify(METADATA), new Date(NOW.getTime() - MIN).toISOString(),
      JSON.stringify({ 'agent-b': new Date(NOW.getTime() - MIN).toISOString() }));
    writeBuild('uuid-pm');
    processSchedules(NOW);
    const rows = testDb.prepare('SELECT kind, org_id, recipients FROM run_notices').all() as Array<{ kind: string; org_id: string; recipients: string }>;
    expect(rows).toEqual([{ kind: 'day', org_id: ORG_B, recipients: '["b@b.test"]' }]);
  });

  /** A pending run notice in `orgId` holding one pending task. */
  function heldNotice(id: string, orgId: string, agentId: string, createdAt = NOW.toISOString()) {
    insertNotice(id, orgId, { createdAt });
    insertTestAgent(testDb, { id: agentId, org_id: orgId });
    insertTestTask(testDb, { id: `task-${id}`, agent_id: agentId, org_id: orgId });
    testDb.prepare('UPDATE tasks SET notice_id = ? WHERE id = ?').run(id, `task-${id}`);
  }

  it("7. each pending notice is mailed via its own org's SMTP and recipients", async () => {
    writeOrgSettings({
      legacy: { enabled: true, recipients: ['l@legacy.test'] },
      a: { enabled: true, recipients: ['a@a.test'] },
      b: { enabled: true, recipients: ['b@b.test', 'b2@b.test'] },
    });
    heldNotice('n-a', ORG_A, 'agent-a');
    heldNotice('n-b', ORG_B, 'agent-b');
    const r = await processNotices(NOW);
    expect(r.sent).toBe(2);
    expect(mailCalls().sort((x, y) => x.host.localeCompare(y.host))).toEqual([
      { host: 'smtp.a.test', pass: 'pass', to: ['a@a.test'] },
      { host: 'smtp.b.test', pass: 'pass', to: ['b@b.test', 'b2@b.test'] },
    ]);
  });

  it("7b. the bounded wait uses each notice's org max_wait_minutes", async () => {
    writeOrgSettings({
      a: { enabled: true, recipients: ['a@a.test'], max_wait_minutes: 15 },
      b: { enabled: true, recipients: ['b@b.test'], max_wait_minutes: 60 },
    });
    mockSendMail.mockRejectedValue(new Error('smtp down'));
    const created = new Date(NOW.getTime() - 20 * MIN).toISOString();
    heldNotice('n-a', ORG_A, 'agent-a', created);
    heldNotice('n-b', ORG_B, 'agent-b', created);
    await processNotices(NOW);
    const states = Object.fromEntries(noticeRows().map((n) => [n.id, n.state]));
    expect(states).toEqual({ 'n-a': 'not_delivered', 'n-b': 'pending' });
  });

  it('7c. the Finished email goes through the owning org SMTP', async () => {
    writeOrgSettings({ b: { enabled: true, recipients: ['b@b.test'] } });
    insertTestAgent(testDb, { id: 'agent-b', org_id: ORG_B });
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients, org_id,
        sent_at, release_at, pickup_deadline, window_end)
      VALUES ('n-f', 'run', 'sent', 'run_now', 'UTC', 'u', ?, '["b@b.test"]', ?, ?, ?, ?, ?)
    `).run(new Date(NOW.getTime() - 3 * 60 * MIN).toISOString(), ORG_B,
      new Date(NOW.getTime() - 3 * 60 * MIN).toISOString(), new Date(NOW.getTime() - 175 * MIN).toISOString(),
      new Date(NOW.getTime() - 10 * MIN).toISOString(), new Date(NOW.getTime() - 5 * MIN).toISOString());
    insertTestTask(testDb, { id: 'task-f', agent_id: 'agent-b', org_id: ORG_B, status: 'completed' });
    testDb.prepare("UPDATE tasks SET notice_id = 'n-f' WHERE id = 'task-f'").run();
    const r = await processNotices(NOW);
    expect(r.finished).toBe(1);
    expect(mailCalls()).toEqual([{ host: 'smtp.b.test', pass: 'pass', to: ['b@b.test'] }]);
  });

  it('8. the daily SMTP check covers each org section with notices enabled', async () => {
    writeOrgSettings({ a: { enabled: true, recipients: ['a@a.test'] }, b: { enabled: false, recipients: ['b@b.test'] } });
    mockTestEmailConnection.mockImplementation(async (s: { smtp_host: string }) => ({ success: false, message: `fail ${s.smtp_host}` }));
    await processNotices(NOW);
    expect(mockTestEmailConnection.mock.calls.map(([s]) => s.smtp_host)).toEqual(['smtp.a.test']);
    const file = readFile();
    expect(file.orgs[ORG_A].pre_execution_notices).toMatchObject({
      last_smtp_check_at: NOW.toISOString(),
      last_smtp_check_ok: false,
      last_smtp_check_message: 'fail smtp.a.test',
    });
    expect(file.orgs[ORG_B].pre_execution_notices.last_smtp_check_at).toBeUndefined();
    expect(file.pre_execution_notices).toBeUndefined();
  });

  it('8b. the legacy section is still checked when it is enabled', async () => {
    writeOrgSettings({ legacy: { enabled: true, recipients: ['l@legacy.test'] }, a: { enabled: true, recipients: ['a@a.test'] } });
    await processNotices(NOW);
    expect(mockTestEmailConnection.mock.calls.map(([s]) => s.smtp_host).sort()).toEqual(['smtp.a.test', 'smtp.legacy.test']);
    expect(readFile().pre_execution_notices.last_smtp_check_ok).toBe(true);
  });
});
