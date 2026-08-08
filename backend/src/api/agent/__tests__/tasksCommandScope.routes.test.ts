import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

/**
 * Route-level test for the motivating capability of the admin API-key scope
 * (Fix 2, whole-branch review): an admin-scope key must actually clear the
 * `endpoints:tasks:command` permission gate on POST /admin/tasks/command,
 * and the other two scopes must not.
 *
 * Mounts the real acceptApiKey() -> requireClerkAuth() -> requireOrgAccess
 * -> adminTasksRouter chain, matching how createAgentRouter() wires
 * `/admin` in `api/agent/index.ts`. The `@clerk/express` mock is a faithful
 * stand-in (gates on req.auth carrying a userId) rather than a passthrough,
 * so this test would actually fail if the permission wiring regressed.
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
const { adminTasksRouter } = await import('../tasks.routes.js');
const { generateApiKey } = await import('../../../services/apiKeys/apiKeys.service.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(acceptApiKey());
  app.use('/admin', requireClerkAuth(), requireOrgAccess, adminTasksRouter);
  app.use(errorHandler);
  return app;
}

const ORG_ID = 'org-001'; // matches insertTestAgent()'s default org_id

beforeEach(() => {
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'agent-001', org_id: ORG_ID });
});

function keyFor(scope: 'read' | 'read-write' | 'admin'): string {
  return generateApiKey({ name: `k-${scope}`, scope, createdBy: 'u', orgId: ORG_ID }).key;
}

describe('POST /admin/tasks/command — scope gate (motivating capability)', () => {
  it('accepts an admin-scope API key (201, task created) — the capability this branch exists for', async () => {
    const res = await request(makeApp())
      .post('/admin/tasks/command')
      .set('Authorization', `Bearer ${keyFor('admin')}`)
      .send({ org_id: ORG_ID, agent_ids: ['agent-001'], command: 'whoami' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.task_ids).toHaveLength(1);
  });

  it('rejects a read-scope API key with 403', async () => {
    const res = await request(makeApp())
      .post('/admin/tasks/command')
      .set('Authorization', `Bearer ${keyFor('read')}`)
      .send({ org_id: ORG_ID, agent_ids: ['agent-001'], command: 'whoami' });

    expect(res.status).toBe(403);
  });

  it('rejects a read-write-scope API key with 403', async () => {
    const res = await request(makeApp())
      .post('/admin/tasks/command')
      .set('Authorization', `Bearer ${keyFor('read-write')}`)
      .send({ org_id: ORG_ID, agent_ids: ['agent-001'], command: 'whoami' });

    expect(res.status).toBe(403);
  });
});
