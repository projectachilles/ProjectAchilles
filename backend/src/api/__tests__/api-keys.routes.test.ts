import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTestDatabase } from '../../__tests__/helpers/db.js';
import type Database from 'better-sqlite3';

let testDb: Database.Database;
vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Neutralise Clerk; act as an authenticated admin with full permissions.
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock('../../middleware/clerk.middleware.js', () => ({
  clerkAuth: (_req: any, _res: any, next: any) => next(),
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = {
      userId: 'admin_user_1',
      orgId: 'org_test',
      sessionClaims: { metadata: { role: 'admin' } },
    };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  getUserId: (auth: any) => auth?.userId,
  getUserOrgId: (auth: any) => auth?.orgId,
}));

async function makeApp() {
  const router = (await import('../api-keys.routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/api-keys', router);
  return app;
}

beforeEach(() => {
  testDb = createTestDatabase();
});

describe('/api/api-keys', () => {
  it('POST /  creates a key and returns the full plaintext once', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/api-keys')
      .send({ name: 'splunk', scope: 'read' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toMatch(/^pa_[a-f0-9]{64}$/);
    expect(res.body.data.key_prefix).toBe(res.body.data.key.slice(0, 12));
  });

  it('POST /  rejects invalid scope with 400', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/api-keys')
      .send({ name: 'bad', scope: 'admin' });
    expect(res.status).toBe(400);
  });

  it('GET /  lists keys without exposing token_hash or full key', async () => {
    const app = await makeApp();
    await request(app).post('/api/api-keys').send({ name: 'a', scope: 'read' });
    await request(app).post('/api/api-keys').send({ name: 'b', scope: 'read-write' });
    const res = await request(app).get('/api/api-keys');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const k of res.body.data) {
      expect(k.token_hash).toBeUndefined();
      expect(k.key).toBeUndefined();
      // Prefix is the first 12 chars of the key: `pa_` + 9 hex chars (matches
      // the slice(0, 12) in apiKeys.service.ts and the POST assertion above).
      expect(k.key_prefix).toMatch(/^pa_[a-f0-9]{9}$/);
    }
  });

  it('DELETE /:id  revokes a key and is idempotent (second call returns 404)', async () => {
    const app = await makeApp();
    const created = await request(app).post('/api/api-keys').send({ name: 'x', scope: 'read' });
    const id = created.body.data.id;
    const first = await request(app).delete(`/api/api-keys/${id}`);
    expect(first.status).toBe(200);
    const second = await request(app).delete(`/api/api-keys/${id}`);
    expect(second.status).toBe(404);
  });
});
