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

// Settings and builds live under a temp HOME.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-notices-routes-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const deniedPermissions = new Set<string>();
vi.mock('../../middleware/clerk.middleware.js', () => ({
  requireClerkAuth: () => (req: any, _res: any, next: any) => { req.auth = { userId: 'u1' }; next(); },
  requirePermission: (permission: string) => (_req: any, res: any, next: any) =>
    deniedPermissions.has(permission)
      ? res.status(403).json({ success: false, error: 'Insufficient permissions' })
      : next(),
  getUserId: (auth: any) => auth?.userId,
  getUserOrgId: (auth: any) => auth?.orgId,
  hasRequestPermission: (_req: any, ...permissions: string[]) => permissions.every((p) => !deniedPermissions.has(p)),
  validateRequestOrgId: () => undefined,
}));

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock('../../services/alerts/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/alerts/email.service.js')>();
  return { ...actual, sendMail: mockSendMail };
});

// tasks.routes pulls in heavy modules that are irrelevant here.
vi.mock('../integrations.routes.js', () => ({ alertsService: {} }));
vi.mock('../../services/agent/results.service.js', () => ({ ingestResult: vi.fn() }));
vi.mock('../../services/agent/ingestionWorker.service.js', () => ({ retryPendingIngestions: vi.fn() }));

const { default: noticesRoutes } = await import('../notices.routes.js');
const { adminTasksRouter } = await import('../agent/tasks.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');
const { IntegrationsSettingsService } = await import('../../services/integrations/settings.js');

const HOME = os.homedir();
const SETTINGS_DIR = path.join(HOME, '.projectachilles');
const TEST_UUID = 'test-uuid-001';

function writeSettings(opts: { smtp?: boolean; notices?: Record<string, unknown> | null } = {}) {
  const { smtp = true, notices = null } = opts;
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  const body: Record<string, unknown> = {};
  if (smtp) {
    body.alerts = {
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
    };
  }
  if (notices) body.pre_execution_notices = notices;
  fs.writeFileSync(path.join(SETTINGS_DIR, 'integrations.json'), JSON.stringify(body));
}

function writeBuild(testUuid = TEST_UUID) {
  const dir = path.join(SETTINGS_DIR, 'builds', testUuid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'test.exe'), 'binary');
  fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify({ binary_name: 'test.exe' }));
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/notices', noticesRoutes);
  a.use('/api/agent/admin', (req: any, _res: any, next: any) => { req.auth = { userId: 'u1' }; next(); }, adminTasksRouter);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  testDb = createTestDatabase();
  deniedPermissions.clear();
  mockSendMail.mockReset();
  mockSendMail.mockResolvedValue({ accepted: ['a@x.com'], rejected: [] });
  fs.rmSync(SETTINGS_DIR, { recursive: true, force: true });
  writeSettings();
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('PUT /api/notices/settings', () => {
  it('rejects enabling without SMTP, with the exact message', async () => {
    writeSettings({ smtp: false });
    const res = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['a@x.com'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SMTP email must be configured in Alerts before enabling notices');
  });

  it('rejects enabling without recipients', async () => {
    const res = await request(app()).put('/api/notices/settings').send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('At least one recipient is required');
  });

  it('round-trips a valid save with trimmed recipients and smtp_configured', async () => {
    const put = await request(app())
      .put('/api/notices/settings')
      .send({ enabled: true, recipients: ['  a@x.com ', 'b@x.com'], lead_minutes: 3 });
    expect(put.status).toBe(200);
    const get = await request(app()).get('/api/notices/settings');
    expect(get.status).toBe(200);
    expect(get.body.data).toMatchObject({
      enabled: true,
      recipients: ['a@x.com', 'b@x.com'],
      lead_minutes: 3,
      max_wait_minutes: 60,
      smtp_configured: true,
    });
  });

  it('rejects a display-name recipient and an empty recipient', async () => {
    const dn = await request(app()).put('/api/notices/settings').send({ recipients: ['Name <a@x.com>'] });
    expect(dn.status).toBe(400);
    const empty = await request(app()).put('/api/notices/settings').send({ recipients: ['a@x.com', '   '] });
    expect(empty.status).toBe(400);
  });

  it('rejects non-integer numeric fields', async () => {
    const res = await request(app()).put('/api/notices/settings').send({ lead_minutes: 2.5 });
    expect(res.status).toBe(400);
  });

  describe('advance digest fields', () => {
    it('defaults to disabled and UTC', async () => {
      const get = await request(app()).get('/api/notices/settings');
      expect(get.body.data).toMatchObject({ advance_digest_enabled: false, digest_timezone: 'UTC' });
    });

    it('round-trips both values', async () => {
      const put = await request(app()).put('/api/notices/settings')
        .send({ advance_digest_enabled: true, digest_timezone: 'America/Santo_Domingo' });
      expect(put.status).toBe(200);
      expect(put.body.data).toMatchObject({ advance_digest_enabled: true, digest_timezone: 'America/Santo_Domingo' });
      const get = await request(app()).get('/api/notices/settings');
      expect(get.body.data).toMatchObject({ advance_digest_enabled: true, digest_timezone: 'America/Santo_Domingo' });
    });

    it('stores an unknown timezone as UTC', async () => {
      const put = await request(app()).put('/api/notices/settings').send({ digest_timezone: 'Mars/Base' });
      expect(put.status).toBe(200);
      const get = await request(app()).get('/api/notices/settings');
      expect(get.body.data.digest_timezone).toBe('UTC');
    });

    it('rejects a non-boolean advance_digest_enabled', async () => {
      const res = await request(app()).put('/api/notices/settings').send({ advance_digest_enabled: 'yes' });
      expect(res.status).toBe(400);
    });

    it('allows saving the digest while notices are disabled', async () => {
      const res = await request(app()).put('/api/notices/settings').send({ advance_digest_enabled: true });
      expect(res.status).toBe(200);
    });
  });

  it('requires integrations:write', async () => {
    deniedPermissions.add('integrations:write');
    const res = await request(app()).put('/api/notices/settings').send({});
    expect(res.status).toBe(403);
  });
});

describe('alerts saved from the UI (no `configured` flag)', () => {
  // Exactly what AlertsConfig.tsx buildSavePayload() sends: no `configured`.
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'test-encryption-secret-that-is-at-least-32-chars-long';
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_SECRET;
  });

  function saveAlertsLikeTheUi(alertRecipients: string[] = ['ops@example.test']) {
    new IntegrationsSettingsService().saveAlertSettings({
      thresholds: { enabled: false },
      slack: { enabled: false },
      email: {
        enabled: true,
        smtp_host: 'smtp.example.test',
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: 'user',
        smtp_pass: 'pass',
        from_address: 'pa@example.test',
        recipients: alertRecipients,
      },
      agent_alerts: { enabled: false },
    } as any);
  }

  it('can enable notices, reports smtp_configured, and a Run Now notice is sent', async () => {
    writeSettings({ smtp: false });
    // `configured` is derived server-side (#546) and needs alert recipients;
    // notices have their own recipients, so they must work without any.
    saveAlertsLikeTheUi([]);
    expect(new IntegrationsSettingsService().getAlertSettings()?.email?.configured).toBe(false);

    const put = await request(app()).put('/api/notices/settings').send({ enabled: true, recipients: ['a@x.com'] });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ enabled: true, smtp_configured: true });

    writeBuild();
    insertTestAgent(testDb, { id: 'agent-001' });
    const run = await request(app()).post('/api/agent/admin/tasks').send({
      org_id: 'org-001',
      agent_ids: ['agent-001'],
      test_uuid: TEST_UUID,
      test_name: 'T',
      binary_name: 'test.exe',
    });
    expect(run.status).toBe(201);
    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));
    expect(mockSendMail.mock.calls[0][1].to).toEqual(['a@x.com']);
  });

  it('can send a test notice', async () => {
    writeSettings({ smtp: false, notices: { enabled: false, recipients: ['a@x.com'] } });
    saveAlertsLikeTheUi();
    const res = await request(app()).post('/api/notices/settings/test');
    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/notices/settings/test', () => {
  it('sends a sample notice to the saved recipients and reports acceptance', async () => {
    writeSettings({ notices: { enabled: false, recipients: ['a@x.com'] } });
    const res = await request(app()).post('/api/notices/settings/test');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ accepted: ['a@x.com'], rejected: [], fully_accepted: true });
    const mail = mockSendMail.mock.calls[0][1];
    expect(mail.to).toEqual(['a@x.com']);
    expect(mail.html).toContain('PA-RUN-TEST00');
  });

  it('reports partial rejection as not fully accepted', async () => {
    writeSettings({ notices: { enabled: false, recipients: ['a@x.com', 'b@x.com'] } });
    mockSendMail.mockResolvedValue({ accepted: ['a@x.com'], rejected: ['b@x.com'] });
    const res = await request(app()).post('/api/notices/settings/test');
    expect(res.body.data.fully_accepted).toBe(false);
  });
});

describe('GET /api/notices/status and list', () => {
  it('returns the status shape', async () => {
    const res = await request(app()).get('/api/notices/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      pendingOverdue: 0,
      notDeliveredLast7d: 0,
      smtpCheck: { ok: null, at: null, message: null },
    });
  });

  function seed(n: number) {
    for (let i = 0; i < n; i++) {
      testDb.prepare(`
        INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients)
        VALUES (?, 'run', 'pending', 'run_now', 'UTC', 'u1', ?, '[]')
      `).run(`n-${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString());
    }
  }

  it('clamps limit to 1..100 and offset to >= 0', async () => {
    seed(120);
    const big = await request(app()).get('/api/notices?limit=1000');
    expect(big.body.data).toHaveLength(100);
    const neg = await request(app()).get('/api/notices?limit=-1&offset=-5');
    expect(neg.body.data).toHaveLength(1);
    const dflt = await request(app()).get('/api/notices');
    expect(dflt.body.data).toHaveLength(25);
    const paged = await request(app()).get('/api/notices?limit=10&offset=115');
    expect(paged.body.data).toHaveLength(5);
  });

  it('?state=pending lists only pending notices, with run_tag and the number of held tasks', async () => {
    insertTestAgent(testDb, { id: 'agent-h' });
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients)
      VALUES ('4f40a524-aaaa', 'run', 'pending', 'run_now', 'UTC', 'u1', '2026-10-23T10:00:00.000Z', '[]'),
             ('sent-1', 'run', 'sent', 'run_now', 'UTC', 'u1', '2026-10-23T11:00:00.000Z', '[]')
    `).run();
    insertTestTask(testDb, { id: 'h1', agent_id: 'agent-h', status: 'pending' });
    insertTestTask(testDb, { id: 'h2', agent_id: 'agent-h', status: 'pending' });
    insertTestTask(testDb, { id: 'h3', agent_id: 'agent-h', status: 'expired' });
    testDb.prepare(`UPDATE tasks SET notice_id = '4f40a524-aaaa' WHERE id IN ('h1','h2','h3')`).run();

    const res = await request(app()).get('/api/notices?state=pending');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: '4f40a524-aaaa', state: 'pending', run_tag: 'PA-RUN-4f40a5', held_tasks: 2 });

    const all = await request(app()).get('/api/notices');
    expect(all.body.data).toHaveLength(2);
    expect((await request(app()).get('/api/notices?state=bogus')).status).toBe(400);
  });
});

describe('delivery details need integrations:read', () => {
  function seedFailures() {
    writeSettings({
      notices: {
        enabled: true, recipients: ['soc@corp.test'],
        last_smtp_check_ok: false, last_smtp_check_message: '535 auth failed for relay@corp.test',
      },
    });
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients, last_error)
      VALUES ('n-1', 'run', 'pending', 'run_now', 'UTC', 'u1', '2026-10-23T10:00:00.000Z',
              '["a@corp.test","b@corp.test"]', 'not accepted: b@corp.test')
    `).run();
    const today = new Date().toISOString().slice(0, 10);
    testDb.prepare(`
      INSERT INTO notice_digests (id, org_id, digest_date, run_date, timezone, state, last_error, recipients, created_at)
      VALUES ('d-1', 'org-1', ?, ?, 'UTC', 'sent', 'rejected: a@corp.test, b@corp.test', '["a@corp.test","b@corp.test","c@corp.test"]', ?)
    `).run(today, today, new Date().toISOString());
  }

  it('shows recipients and raw errors to a caller with integrations:read', async () => {
    seedFailures();
    const status = (await request(app()).get('/api/notices/status')).body.data;
    expect(status.smtpCheck.message).toBe('535 auth failed for relay@corp.test');
    expect(status.digests[0]).toMatchObject({ lastError: 'rejected: a@corp.test, b@corp.test', recipientCount: 3 });
    const list = (await request(app()).get('/api/notices')).body.data;
    expect(list[0].recipients).toBe('["a@corp.test","b@corp.test"]');
    expect(list[0].last_error).toBe('not accepted: b@corp.test');
  });

  it('hides addresses and SMTP text from a caller without integrations:read', async () => {
    seedFailures();
    deniedPermissions.add('integrations:read');
    const statusRes = await request(app()).get('/api/notices/status');
    const listRes = await request(app()).get('/api/notices');
    for (const body of [statusRes.text, listRes.text]) expect(body).not.toContain('@corp.test');

    const status = statusRes.body.data;
    expect(status.smtpCheck).toMatchObject({ ok: false, message: 'SMTP check failed' });
    expect(status.digests[0]).toMatchObject({ lastError: '2 recipients rejected', recipientCount: 3 });
    const list = listRes.body.data;
    expect(list[0]).not.toHaveProperty('recipients');
    expect(list[0]).toMatchObject({ id: 'n-1', run_tag: 'PA-RUN-n1', last_error: '1 recipient not accepted' });
  });
});

describe('POST /api/notices/:id/release', () => {
  it('rejects a whitespace-only reason with 400', async () => {
    const res = await request(app()).post('/api/notices/x/release').send({ reason: '  ' });
    expect(res.status).toBe(400);
  });

  it('requires endpoints:tasks:create', async () => {
    deniedPermissions.add('endpoints:tasks:create');
    const res = await request(app()).post('/api/notices/x/release').send({ reason: 'ok' });
    expect(res.status).toBe(403);
  });

  it('releases a pending notice', async () => {
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients)
      VALUES ('n-1', 'run', 'pending', 'run_now', 'UTC', 'u1', ?, '[]')
    `).run(new Date().toISOString());
    const res = await request(app()).post('/api/notices/n-1/release').send({ reason: '  vendor confirmed ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'n-1', state: 'overridden', override_reason: 'vendor confirmed' });
  });
});

describe('dispatch routes with the gate', () => {
  const ENABLED = { enabled: true, recipients: ['a@x.com'] };

  it('Run Now with the gate enabled links every task to a notice', async () => {
    writeSettings({ notices: ENABLED });
    writeBuild();
    insertTestAgent(testDb, { id: 'agent-001' });
    const res = await request(app()).post('/api/agent/admin/tasks').send({
      org_id: 'org-001',
      agent_ids: ['agent-001'],
      test_uuid: TEST_UUID,
      test_name: 'T',
      binary_name: 'test.exe',
    });
    expect(res.status).toBe(201);
    const rows = testDb.prepare('SELECT notice_id FROM tasks').all() as Array<{ notice_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].notice_id).toBeTruthy();
    const n = testDb.prepare('SELECT source_type, kind FROM run_notices WHERE id = ?').get(rows[0].notice_id) as any;
    expect(n).toEqual({ source_type: 'run_now', kind: 'run' });
    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalled());
  });

  it('Run Now with the gate disabled leaves notice_id NULL', async () => {
    writeSettings({ notices: { ...ENABLED, enabled: false } });
    writeBuild();
    insertTestAgent(testDb, { id: 'agent-001' });
    const res = await request(app()).post('/api/agent/admin/tasks').send({
      org_id: 'org-001',
      agent_ids: ['agent-001'],
      test_uuid: TEST_UUID,
      test_name: 'T',
      binary_name: 'test.exe',
    });
    expect(res.status).toBe(201);
    const row = testDb.prepare('SELECT notice_id FROM tasks').get() as { notice_id: string | null };
    expect(row.notice_id).toBeNull();
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM run_notices').get()).toEqual({ c: 0 });
  });

  it('manual retry with the gate enabled creates a manual_retry notice linked to the clone', async () => {
    writeSettings({ notices: ENABLED });
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestTask(testDb, { id: 'task-old', status: 'completed' });
    const res = await request(app()).post('/api/agent/admin/tasks/task-old/retry');
    expect(res.status).toBe(201);
    const clone = testDb.prepare("SELECT notice_id FROM tasks WHERE id != 'task-old'").get() as { notice_id: string };
    expect(clone.notice_id).toBeTruthy();
    const n = testDb.prepare('SELECT source_type FROM run_notices WHERE id = ?').get(clone.notice_id) as any;
    expect(n.source_type).toBe('manual_retry');
    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalled());
  });

  it('retrying a command task is rejected and leaves no notice behind', async () => {
    writeSettings({ notices: ENABLED });
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestTask(testDb, { id: 'cmd-old', type: 'execute_command', status: 'completed' });
    const res = await request(app()).post('/api/agent/admin/tasks/cmd-old/retry');
    expect(res.status).toBe(400);
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM run_notices').get()).toEqual({ c: 0 });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('grouped list attaches notice summaries', async () => {
    writeSettings({ notices: ENABLED });
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestTask(testDb, { id: 'task-1', batch_id: 'b1' });
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients)
      VALUES ('abcdef12-0000-0000-0000-000000000000', 'run', 'pending', 'run_now', 'UTC', 'u1', ?, '[]')
    `).run(new Date().toISOString());
    testDb.prepare("UPDATE tasks SET notice_id = 'abcdef12-0000-0000-0000-000000000000' WHERE id = 'task-1'").run();
    const res = await request(app()).get('/api/agent/admin/tasks/grouped');
    expect(res.status).toBe(200);
    const group = res.body.data.groups[0];
    expect(group.notices['abcdef12-0000-0000-0000-000000000000']).toMatchObject({
      run_tag: 'PA-RUN-abcdef',
      state: 'pending',
    });
  });

  describe('grouped list notice errors need integrations:read', () => {
    function seedFailedNotice() {
      writeSettings({ notices: ENABLED });
      insertTestAgent(testDb, { id: 'agent-001' });
      insertTestTask(testDb, { id: 'task-1', batch_id: 'b1' });
      testDb.prepare(`
        INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, recipients, last_error)
        VALUES ('abcdef12-0000-0000-0000-000000000000', 'run', 'pending', 'run_now', 'UTC', 'u1', ?,
                '["a@corp.test","b@corp.test"]', 'not accepted: a@corp.test, b@corp.test')
      `).run(new Date().toISOString());
      testDb.prepare("UPDATE tasks SET notice_id = 'abcdef12-0000-0000-0000-000000000000' WHERE id = 'task-1'").run();
    }
    const notice = (res: request.Response) => res.body.data.groups[0].notices['abcdef12-0000-0000-0000-000000000000'];

    it('keeps the raw error for a caller with integrations:read', async () => {
      seedFailedNotice();
      const res = await request(app()).get('/api/agent/admin/tasks/grouped');
      expect(notice(res).last_error).toBe('not accepted: a@corp.test, b@corp.test');
    });

    it('reduces the error to a count for a caller without integrations:read', async () => {
      seedFailedNotice();
      deniedPermissions.add('integrations:read');
      const res = await request(app()).get('/api/agent/admin/tasks/grouped');
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('@corp.test');
      expect(notice(res)).toMatchObject({ run_tag: 'PA-RUN-abcdef', state: 'pending', last_error: '2 recipients not accepted' });
    });
  });
});

describe('POST /api/agent/admin/tasks/batch', () => {
  const ENABLED = { enabled: true, recipients: ['a@x.com'] };
  const req = (testUuid: string, agentIds = ['agent-001']) => ({
    agent_ids: agentIds,
    test_uuid: testUuid,
    test_name: `Test ${testUuid}`,
    binary_name: 'test.exe',
  });
  const counts = () => ({
    notices: (testDb.prepare('SELECT COUNT(*) AS c FROM run_notices').get() as { c: number }).c,
    tasks: (testDb.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c,
  });

  beforeEach(() => {
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002' });
    writeBuild('uuid-a');
    writeBuild('uuid-b');
  });

  it('runs every request under one notice and returns task ids in request order', async () => {
    writeSettings({ notices: ENABLED });
    const res = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: [req('uuid-a', ['agent-001', 'agent-002']), req('uuid-b')] });
    expect(res.status).toBe(201);
    const ids: string[][] = res.body.data.task_ids;
    expect(ids.map((x) => x.length)).toEqual([2, 1]);

    const ns = testDb.prepare('SELECT id, source_type FROM run_notices').all() as Array<{ id: string; source_type: string }>;
    expect(ns).toEqual([{ id: expect.any(String), source_type: 'run_now' }]);
    const rows = testDb.prepare('SELECT id, notice_id, payload FROM tasks').all() as Array<{ id: string; notice_id: string; payload: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.notice_id === ns[0].id)).toBe(true);
    const uuidOf = (id: string) => JSON.parse(rows.find((r) => r.id === id)!.payload).test_uuid;
    expect(ids[0].map(uuidOf)).toEqual(['uuid-a', 'uuid-a']);
    expect(ids[1].map(uuidOf)).toEqual(['uuid-b']);

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));
    const html = mockSendMail.mock.calls[0][1].html as string;
    expect(html).toContain('Test uuid-a');
    expect(html).toContain('Test uuid-b');
  });

  it('one failing request rolls back the whole batch: no notice, no tasks', async () => {
    writeSettings({ notices: ENABLED });
    const res = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: [req('uuid-a'), req('uuid-missing')] });
    expect(res.status).toBe(404);
    expect(counts()).toEqual({ notices: 0, tasks: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('with the gate disabled, a failing request still rolls back the batch', async () => {
    writeSettings({ notices: { ...ENABLED, enabled: false } });
    const res = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: [req('uuid-a'), req('uuid-missing')] });
    expect(res.status).toBe(404);
    expect(counts()).toEqual({ notices: 0, tasks: 0 });
  });

  it('with the gate disabled, creates tasks without a notice', async () => {
    writeSettings({ notices: { ...ENABLED, enabled: false } });
    const res = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: [req('uuid-a'), req('uuid-b')] });
    expect(res.status).toBe(201);
    expect(counts()).toEqual({ notices: 0, tasks: 2 });
  });

  it('validates 1..50 requests', async () => {
    const empty = await request(app()).post('/api/agent/admin/tasks/batch').send({ org_id: 'org-001', requests: [] });
    expect(empty.status).toBe(400);
    const tooMany = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: Array.from({ length: 51 }, () => req('uuid-a')) });
    expect(tooMany.status).toBe(400);
    const bad = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: [{ agent_ids: [], test_uuid: 'uuid-a' }] });
    expect(bad.status).toBe(400);
    expect(counts()).toEqual({ notices: 0, tasks: 0 });
  });

  it('requires endpoints:tasks:create', async () => {
    deniedPermissions.add('endpoints:tasks:create');
    const res = await request(app())
      .post('/api/agent/admin/tasks/batch')
      .send({ org_id: 'org-001', requests: [req('uuid-a')] });
    expect(res.status).toBe(403);
  });
});
