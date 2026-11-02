import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

/**
 * Organization scoping of the agent, task and schedule admin routes.
 *
 * Mounts the real requireClerkAuth() -> requireOrgAccess -> router chain, as
 * createAgentRouter() does in api/agent/index.ts. A caller with an
 * organization (a Clerk org session or an org-bound API key) must only see and
 * act on its own organization's agents, tasks and schedules: another org's
 * rows are left out of lists and are "not found" by id, and no task or
 * schedule may target another org's agent. A caller without an organization
 * (single-organization installs) keeps today's behaviour, unless
 * REQUIRE_ORG_ISOLATION=true, which rejects it.
 */

let testDb: Database.Database;
vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (req: any, res: any, next: any) => {
    const authObj = typeof req.auth === 'function' ? req.auth() : req.auth;
    if (authObj?.userId) {
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
}));

const { acceptApiKey } = await import('../../../middleware/apiKeyAuth.middleware.js');
const { requireClerkAuth, requireOrgAccess } = await import('../../../middleware/clerk.middleware.js');
const { adminAgentRouter } = await import('../heartbeat.routes.js');
const { adminTasksRouter } = await import('../tasks.routes.js');
const { adminSchedulesRouter } = await import('../schedules.routes.js');
const { generateApiKey } = await import('../../../services/apiKeys/apiKeys.service.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

const ORG_A = 'org-a';
const ORG_B = 'org-b';

/** A Clerk admin session, in `orgId` or in no organization. */
function appAs(orgId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = {
      userId: 'user-1',
      ...(orgId ? { orgId } : {}),
      sessionClaims: { metadata: { role: 'admin' } },
    };
    next();
  });
  mount(app);
  return app;
}

/** An org-bound API key (the principal that reaches these routes without the UI). */
function appWithKey() {
  const app = express();
  app.use(express.json());
  app.use(acceptApiKey());
  mount(app);
  return app;
}

function mount(app: express.Express) {
  for (const router of [adminAgentRouter, adminTasksRouter, adminSchedulesRouter]) {
    app.use('/admin', requireClerkAuth(), requireOrgAccess, router);
  }
  app.use(errorHandler);
}

function insertSchedule(id: string, orgId: string, agentIds: string[]) {
  testDb.prepare(`
    INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name,
      schedule_type, schedule_config, timezone, next_run_at, status, created_by)
    VALUES (?, ?, ?, ?, 'test-uuid-001', 'Test', 'test.exe', 'daily', ?, 'UTC', ?, 'active', 'user-1')
  `).run(id, id, JSON.stringify(agentIds), orgId, JSON.stringify({ time: '09:00' }), '2099-01-01T09:00:00.000Z');
}

const taskCount = () => (testDb.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
const taskRow = (id: string) => testDb.prepare('SELECT status, notes FROM tasks WHERE id = ?').get(id) as
  { status: string; notes: string | null } | undefined;
const scheduleRow = (id: string) => testDb.prepare('SELECT status, agent_ids FROM schedules WHERE id = ?').get(id) as
  { status: string; agent_ids: string };

beforeEach(() => {
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'a1', org_id: ORG_A, hostname: 'host-a1' });
  insertTestAgent(testDb, { id: 'b1', org_id: ORG_B, hostname: 'host-b1' });
  insertTestTask(testDb, { id: 't-a', agent_id: 'a1', org_id: ORG_A, status: 'completed' });
  insertTestTask(testDb, { id: 't-b', agent_id: 'b1', org_id: ORG_B, status: 'completed' });
  insertSchedule('s-a', ORG_A, ['a1']);
  insertSchedule('s-b', ORG_B, ['b1']);
});

afterEach(() => {
  delete process.env.REQUIRE_ORG_ISOLATION;
});

describe('lists and metrics are limited to the caller org', () => {
  it('GET /agents without org_id lists only the caller org', async () => {
    const res = await request(appAs(ORG_A)).get('/admin/agents');
    expect(res.status).toBe(200);
    expect(res.body.data.agents.map((a: { id: string }) => a.id)).toEqual(['a1']);
    expect(res.body.data.total).toBe(1);
  });

  it('GET /agents?org_id=<other org> is refused', async () => {
    const res = await request(appAs(ORG_A)).get(`/admin/agents?org_id=${ORG_B}`);
    expect(res.status).toBe(403);
  });

  it('GET /metrics and /metrics/fleet-health count the caller org only', async () => {
    const metrics = await request(appAs(ORG_A)).get('/admin/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.total).toBe(1);

    // Two failures on the other org's agent: its MTBF must not leak into ours.
    testDb.prepare(`INSERT INTO agent_events (agent_id, event_type, created_at) VALUES
      ('b1', 'task_failed', datetime('now', '-2 days')), ('b1', 'task_failed', datetime('now', '-1 days'))`).run();
    const health = await request(appAs(ORG_A)).get('/admin/metrics/fleet-health');
    expect(health.status).toBe(200);
    expect(health.body.data.mtbf_hours).toBeNull();

    const all = await request(appAs()).get('/admin/metrics/fleet-health');
    expect(all.body.data.mtbf_hours).toBe(24);
  });

  it('GET /agents/heartbeats returns the caller org agents only', async () => {
    testDb.prepare(`INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent, memory_mb, disk_free_mb)
      VALUES ('a1', datetime('now'), 1, 1, 1), ('b1', datetime('now'), 1, 1, 1)`).run();
    const res = await request(appAs(ORG_A)).get('/admin/agents/heartbeats?hours=24');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain('a1');
    expect(JSON.stringify(res.body.data)).not.toContain('b1');
  });

  it('GET /tasks and /tasks/grouped list only the caller org tasks', async () => {
    const list = await request(appAs(ORG_A)).get('/admin/tasks');
    expect(list.status).toBe(200);
    expect(list.body.data.tasks.map((t: { id: string }) => t.id)).toEqual(['t-a']);

    const grouped = await request(appAs(ORG_A)).get('/admin/tasks/grouped');
    expect(grouped.status).toBe(200);
    const ids = grouped.body.data.groups.flatMap((g: { tasks: { id: string }[] }) => g.tasks.map((t) => t.id));
    expect(ids).toEqual(['t-a']);
  });

  it('GET /tasks?agent_id=<other org agent> returns nothing', async () => {
    const res = await request(appAs(ORG_A)).get('/admin/tasks?agent_id=b1');
    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toEqual([]);
  });

  it('GET /schedules lists only the caller org schedules', async () => {
    const res = await request(appAs(ORG_A)).get('/admin/schedules');
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual(['s-a']);
  });
});

describe('another org task or schedule is not found by id', () => {
  it('GET /tasks/:id', async () => {
    expect((await request(appAs(ORG_A)).get('/admin/tasks/t-b')).status).toBe(404);
    expect((await request(appAs(ORG_A)).get('/admin/tasks/t-a')).status).toBe(200);
  });

  it('POST /tasks/:id/cancel leaves the task unchanged', async () => {
    insertTestTask(testDb, { id: 't-b-pending', agent_id: 'b1', org_id: ORG_B, status: 'pending' });
    const res = await request(appAs(ORG_A)).post('/admin/tasks/t-b-pending/cancel');
    expect(res.status).toBe(404);
    expect(taskRow('t-b-pending')?.status).toBe('pending');
  });

  it('POST /tasks/:id/retry creates nothing', async () => {
    const before = taskCount();
    const res = await request(appAs(ORG_A)).post('/admin/tasks/t-b/retry');
    expect(res.status).toBe(404);
    expect(taskCount()).toBe(before);
  });

  it('DELETE /tasks/:id keeps the task', async () => {
    const res = await request(appAs(ORG_A)).delete('/admin/tasks/t-b');
    expect(res.status).toBe(404);
    expect(taskRow('t-b')).toBeDefined();
  });

  it('PATCH /tasks/:id/notes writes nothing', async () => {
    const res = await request(appAs(ORG_A)).patch('/admin/tasks/t-b/notes').send({ content: 'x' });
    expect(res.status).toBe(404);
    expect(taskRow('t-b')?.notes ?? null).toBeNull();
  });

  it('GET, PATCH and DELETE /schedules/:id', async () => {
    const app = appAs(ORG_A);
    expect((await request(app).get('/admin/schedules/s-b')).status).toBe(404);
    expect((await request(app).patch('/admin/schedules/s-b').send({ status: 'paused' })).status).toBe(404);
    expect((await request(app).delete('/admin/schedules/s-b')).status).toBe(404);
    expect(scheduleRow('s-b').status).toBe('active');
    expect((await request(app).get('/admin/schedules/s-a')).status).toBe(200);
  });
});

describe('tasks and schedules can never target another org agent', () => {
  it('an org-bound admin API key cannot run a command on another org agent', async () => {
    const key = generateApiKey({ name: 'k', scope: 'admin', createdBy: 'u', orgId: ORG_A }).key;
    const res = await request(appWithKey())
      .post('/admin/tasks/command')
      .set('Authorization', `Bearer ${key}`)
      .send({ org_id: ORG_A, agent_ids: ['b1'], command: 'whoami' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
    expect(taskCount()).toBe(2);
  });

  it('the same key can still run a command on its own org agent', async () => {
    const key = generateApiKey({ name: 'k', scope: 'admin', createdBy: 'u', orgId: ORG_A }).key;
    const res = await request(appWithKey())
      .post('/admin/tasks/command')
      .set('Authorization', `Bearer ${key}`)
      .send({ org_id: ORG_A, agent_ids: ['a1'], command: 'whoami' });
    expect(res.status).toBe(201);
  });

  it('a mixed own + other org agent list is refused as a whole', async () => {
    const res = await request(appAs(ORG_A))
      .post('/admin/tasks/command')
      .send({ org_id: ORG_A, agent_ids: ['a1', 'b1'], command: 'whoami' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
    expect(taskCount()).toBe(2);
  });

  it('POST /tasks and /tasks/batch refuse another org agent before anything else', async () => {
    const one = { agent_ids: ['b1'], test_uuid: 'u', test_name: 'n', binary_name: 'b.exe' };
    const single = await request(appAs(ORG_A)).post('/admin/tasks').send({ org_id: ORG_A, ...one });
    expect(single.status).toBe(404);
    expect(single.body.error).toBe('Agent not found');
    const batch = await request(appAs(ORG_A)).post('/admin/tasks/batch').send({ org_id: ORG_A, requests: [one] });
    expect(batch.status).toBe(404);
    expect(batch.body.error).toBe('Agent not found');
    expect(taskCount()).toBe(2);
  });

  it('POST /tasks/update and /tasks/uninstall refuse another org agent', async () => {
    const app = appAs(ORG_A);
    for (const path of ['/admin/tasks/update', '/admin/tasks/uninstall']) {
      const res = await request(app).post(path).send({ org_id: ORG_A, agent_ids: ['b1'] });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Agent not found');
    }
    expect(taskCount()).toBe(2);
  });

  it('POST /tasks/update refuses an org_id that is not the caller org', async () => {
    const res = await request(appAs(ORG_A)).post('/admin/tasks/update').send({ org_id: ORG_B, agent_ids: ['b1'] });
    expect(res.status).toBe(403);
  });

  it('POST /schedules refuses another org agent', async () => {
    const res = await request(appAs(ORG_A)).post('/admin/schedules').send({
      agent_ids: ['b1'], org_id: ORG_A, test_uuid: 'u', test_name: 'n', binary_name: 'b.exe',
      schedule_type: 'daily', schedule_config: { time: '09:00' },
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
    expect((testDb.prepare('SELECT COUNT(*) AS n FROM schedules').get() as { n: number }).n).toBe(2);
  });

  it('PATCH /schedules/:id cannot retarget an own schedule at another org agent', async () => {
    const res = await request(appAs(ORG_A)).patch('/admin/schedules/s-a').send({ agent_ids: ['a1', 'b1'] });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
    expect(JSON.parse(scheduleRow('s-a').agent_ids)).toEqual(['a1']);
  });
});

describe('review findings', () => {
  it('a query org_id cannot hide a different body org_id', async () => {
    const res = await request(appAs(ORG_A)).post(`/admin/schedules?org_id=${ORG_A}`).send({
      agent_ids: ['a1'], org_id: ORG_B, test_uuid: 'u', test_name: 'n', binary_name: 'b.exe',
      schedule_type: 'daily', schedule_config: { time: '09:00' },
    });
    expect(res.status).toBe(403);
    expect((testDb.prepare('SELECT COUNT(*) AS n FROM schedules').get() as { n: number }).n).toBe(2);
  });

  it('requireOrgAccess checks a body org_id even when the query names the caller org', async () => {
    // PATCH /schedules/:id never reads org_id itself, so only the middleware can refuse this.
    const res = await request(appAs(ORG_A)).patch(`/admin/schedules/s-a?org_id=${ORG_A}`).send({ org_id: ORG_B, status: 'paused' });
    expect(res.status).toBe(403);
    expect(scheduleRow('s-a').status).toBe('active');
  });

  it('a repeated ?org_id= is refused', async () => {
    const res = await request(appAs(ORG_A)).get(`/admin/agents?org_id=${ORG_A}&org_id=${ORG_B}`);
    expect(res.status).toBe(403);
  });

  // Rows recorded under the caller's org but aimed at another org's agent
  // (possible before this fix) must not be re-armed by the caller.
  it('retrying an own-org task that ran on another org agent is refused', async () => {
    insertTestTask(testDb, { id: 't-mixed', agent_id: 'b1', org_id: ORG_A, status: 'completed' });
    const before = taskCount();
    const res = await request(appAs(ORG_A)).post('/admin/tasks/t-mixed/retry');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
    expect(taskCount()).toBe(before);
  });

  it('pausing or resuming an own-org schedule that targets another org agent is refused', async () => {
    insertSchedule('s-mixed', ORG_A, ['a1', 'b1']);
    const res = await request(appAs(ORG_A)).patch('/admin/schedules/s-mixed').send({ status: 'paused' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Agent not found');
    expect(scheduleRow('s-mixed').status).toBe('active');
  });

  it('another org agent by id answers like an unknown one', async () => {
    const other = await request(appAs(ORG_A)).get('/admin/agents/b1');
    const unknown = await request(appAs(ORG_A)).get('/admin/agents/no-such-agent');
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(other.body.error).toBe(unknown.body.error);
  });
});

describe('callers without an organization', () => {
  it('keep seeing every org (single-organization installs)', async () => {
    const agents = await request(appAs()).get('/admin/agents');
    expect(agents.body.data.agents.map((a: { id: string }) => a.id).sort()).toEqual(['a1', 'b1']);
    const filtered = await request(appAs()).get(`/admin/agents?org_id=${ORG_B}`);
    expect(filtered.body.data.agents.map((a: { id: string }) => a.id)).toEqual(['b1']);
    expect((await request(appAs()).get('/admin/tasks/t-b')).status).toBe(200);
    expect((await request(appAs()).get('/admin/schedules')).body.data).toHaveLength(2);
  });

  it('can still dispatch to any agent, as the UI does with org_id "default"', async () => {
    const res = await request(appAs())
      .post('/admin/tasks/command')
      .send({ org_id: 'default', agent_ids: ['a1', 'b1'], command: 'whoami' });
    expect(res.status).toBe(201);
  });

  it('are refused everywhere when REQUIRE_ORG_ISOLATION=true', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    const app = appAs();
    expect((await request(app).get('/admin/agents')).status).toBe(403);
    expect((await request(app).get('/admin/metrics')).status).toBe(403);
    expect((await request(app).get('/admin/tasks')).status).toBe(403);
    expect((await request(app).get('/admin/tasks/t-a')).status).toBe(403);
    expect((await request(app).get('/admin/schedules')).status).toBe(403);
    expect((await request(app).get('/admin/schedules/s-a')).status).toBe(403);
  });
});
