import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { DbHelper } from '../../../services/agent/database.js';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

/**
 * Organization scoping of the agent, task and schedule admin routes
 * (mirrors backend/src/api/agent/__tests__/orgScope.routes.test.ts).
 * Mounts the real requireClerkAuth() -> requireOrgAccess -> router chain.
 */

let testDb: DbHelper;
vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return { ...actual, getDb: async () => testDb };
});

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (req: any, res: any, next: any) => {
    if (req.auth?.userId) {
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
}));

const { requireClerkAuth, requireOrgAccess } = await import('../../../middleware/clerk.middleware.js');
const { adminAgentRouter } = await import('../heartbeat.routes.js');
const { adminTasksRouter } = await import('../tasks.routes.js');
const { adminSchedulesRouter } = await import('../schedules.routes.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

const ORG_A = 'org-a';
const ORG_B = 'org-b';

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
  for (const router of [adminAgentRouter, adminTasksRouter, adminSchedulesRouter]) {
    app.use('/admin', requireClerkAuth(), requireOrgAccess, router);
  }
  app.use(errorHandler);
  return app;
}

async function insertSchedule(id: string, orgId: string, agentIds: string[]) {
  await testDb.run(`
    INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name,
      schedule_type, schedule_config, timezone, next_run_at, status, created_by)
    VALUES (?, ?, ?, ?, 'test-uuid-001', 'Test', 'test.exe', 'daily', ?, 'UTC', ?, 'active', 'user-1')
  `, [id, id, JSON.stringify(agentIds), orgId, JSON.stringify({ time: '09:00' }), '2099-01-01T09:00:00.000Z']);
}

const taskCount = async () => Number((await testDb.get('SELECT COUNT(*) AS n FROM tasks'))?.n);

beforeEach(async () => {
  testDb = await createTestDatabase();
  await insertTestAgent(testDb, { id: 'a1', org_id: ORG_A });
  await insertTestAgent(testDb, { id: 'b1', org_id: ORG_B });
  await insertTestTask(testDb, { id: 't-a', agent_id: 'a1', org_id: ORG_A, status: 'pending' });
  await insertTestTask(testDb, { id: 't-b', agent_id: 'b1', org_id: ORG_B, status: 'pending' });
  await insertSchedule('s-a', ORG_A, ['a1']);
  await insertSchedule('s-b', ORG_B, ['b1']);
});

afterEach(() => {
  delete process.env.REQUIRE_ORG_ISOLATION;
});

describe('an org caller', () => {
  it('lists only its own agents, tasks and schedules', async () => {
    const app = appAs(ORG_A);
    const agents = await request(app).get('/admin/agents');
    expect(agents.body.data.agents.map((a: { id: string }) => a.id)).toEqual(['a1']);
    expect((await request(app).get('/admin/metrics')).body.data.total).toBe(1);
    const tasks = await request(app).get('/admin/tasks');
    expect(tasks.body.data.tasks.map((t: { id: string }) => t.id)).toEqual(['t-a']);
    const grouped = await request(app).get('/admin/tasks/grouped');
    expect(grouped.body.data.groups.flatMap((g: { tasks: { id: string }[] }) => g.tasks.map((t) => t.id))).toEqual(['t-a']);
    const schedules = await request(app).get('/admin/schedules');
    expect(schedules.body.data.map((s: { id: string }) => s.id)).toEqual(['s-a']);
  });

  it('gets 404 for another org task or schedule, and nothing changes', async () => {
    const app = appAs(ORG_A);
    expect((await request(app).get('/admin/tasks/t-b')).status).toBe(404);
    expect((await request(app).post('/admin/tasks/t-b/cancel')).status).toBe(404);
    expect((await request(app).delete('/admin/tasks/t-b')).status).toBe(404);
    expect((await request(app).patch('/admin/tasks/t-b/notes').send({ content: 'x' })).status).toBe(404);
    expect((await testDb.get("SELECT status FROM tasks WHERE id = 't-b'"))?.status).toBe('pending');
    expect((await request(app).get('/admin/schedules/s-b')).status).toBe(404);
    expect((await request(app).delete('/admin/schedules/s-b')).status).toBe(404);
    expect((await testDb.get("SELECT status FROM schedules WHERE id = 's-b'"))?.status).toBe('active');
  });

  it('cannot target another org agent with a command, update, uninstall or schedule', async () => {
    const app = appAs(ORG_A);
    const cmd = await request(app).post('/admin/tasks/command').send({ org_id: ORG_A, agent_ids: ['a1', 'b1'], command: 'whoami' });
    expect(cmd.status).toBe(404);
    expect(cmd.body.error).toBe('Agent not found');
    for (const path of ['/admin/tasks/update', '/admin/tasks/uninstall']) {
      const res = await request(app).post(path).send({ org_id: ORG_A, agent_ids: ['b1'] });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Agent not found');
    }
    expect(await taskCount()).toBe(2);
    const patch = await request(app).patch('/admin/schedules/s-a').send({ agent_ids: ['b1'] });
    expect(patch.status).toBe(404);
    expect(patch.body.error).toBe('Agent not found');
  });

  it('can still run a command on its own agent', async () => {
    const res = await request(appAs(ORG_A)).post('/admin/tasks/command').send({ org_id: ORG_A, agent_ids: ['a1'], command: 'whoami' });
    expect(res.status).toBe(201);
  });
});

describe('review findings', () => {
  it('requireOrgAccess checks a body org_id even when the query names the caller org', async () => {
    const res = await request(appAs(ORG_A)).patch(`/admin/schedules/s-a?org_id=${ORG_A}`).send({ org_id: ORG_B, status: 'paused' });
    expect(res.status).toBe(403);
  });

  it('refuses re-arming own-org rows that target another org agent', async () => {
    await insertTestTask(testDb, { id: 't-mixed', agent_id: 'b1', org_id: ORG_A, status: 'completed' });
    const retry = await request(appAs(ORG_A)).post('/admin/tasks/t-mixed/retry');
    expect(retry.status).toBe(404);
    expect(retry.body.error).toBe('Agent not found');
    await insertSchedule('s-mixed', ORG_A, ['a1', 'b1']);
    const pause = await request(appAs(ORG_A)).patch('/admin/schedules/s-mixed').send({ status: 'paused' });
    expect(pause.status).toBe(404);
    expect((await testDb.get("SELECT status FROM schedules WHERE id = 's-mixed'"))?.status).toBe('active');
  });

  it('another org agent by id answers like an unknown one', async () => {
    const other = await request(appAs(ORG_A)).get('/admin/agents/b1');
    expect(other.status).toBe(404);
    expect(other.body.error).toBe('Agent not found');
  });
});

describe('a caller without an organization', () => {
  it('keeps seeing and dispatching to every org', async () => {
    const app = appAs();
    expect((await request(app).get('/admin/agents')).body.data.agents).toHaveLength(2);
    expect((await request(app).get('/admin/tasks/t-b')).status).toBe(200);
    const cmd = await request(app).post('/admin/tasks/command').send({ org_id: 'default', agent_ids: ['a1', 'b1'], command: 'whoami' });
    expect(cmd.status).toBe(201);
  });

  it('is refused when REQUIRE_ORG_ISOLATION=true', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    const app = appAs();
    expect((await request(app).get('/admin/agents')).status).toBe(403);
    expect((await request(app).get('/admin/tasks')).status).toBe(403);
    expect((await request(app).get('/admin/tasks/t-a')).status).toBe(403);
    expect((await request(app).get('/admin/schedules')).status).toBe(403);
  });
});
