import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../__tests__/helpers/db.js';

/**
 * Route-level containment tests for the admin API-key scope carve-out
 * (see `permissionsForScope()` / `ADMIN_API_KEY_PERMISSIONS` in
 * apiKeyAuth.middleware.ts).
 *
 * Deliberately does NOT reuse the mocks in api-keys.routes.test.ts —
 * that file replaces `requirePermission` with an always-`next()`
 * passthrough (its focus is response shape, not authorization), which
 * would make an authorization-containment test vacuously pass. This file
 * exercises the real `acceptApiKey()` -> `requireClerkAuth()` ->
 * `requirePermission()` chain exactly as server.ts wires it, so a
 * regression that widens the admin key's grant back to the full
 * `settings:users:manage` permission would actually fail these tests.
 *
 * The `@clerk/express` mock below is a faithful (not passthrough) stand-in:
 * requireAuth() only calls next() when req.auth carries a userId, mirroring
 * the real SDK's short-circuit on an already-populated req.auth (see the
 * "Precedence" note atop apiKeyAuth.middleware.ts).
 */

let testDb: Database.Database;
vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
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
  clerkClient: {
    users: { getUserList: vi.fn(), updateUserMetadata: vi.fn(), deleteUser: vi.fn() },
    invitations: { createInvitation: vi.fn(), getInvitationList: vi.fn(), revokeInvitation: vi.fn() },
  },
}));

const { acceptApiKey } = await import('../../middleware/apiKeyAuth.middleware.js');
const { generateApiKey } = await import('../../services/apiKeys/apiKeys.service.js');
const apiKeysRouter = (await import('../api-keys.routes.js')).default;
const usersRouter = (await import('../users.routes.js')).default;
const { errorHandler } = await import('../../middleware/error.middleware.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(acceptApiKey());
  app.use('/api/api-keys', apiKeysRouter);
  app.use('/api/users', usersRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  testDb = createTestDatabase();
});

function adminKey(): string {
  return generateApiKey({ name: 'admin automation', scope: 'admin', createdBy: 'u', orgId: 'org_x' }).key;
}

describe('admin-scope API key containment (Fix 1)', () => {
  it('POST /api/api-keys is 403 for an admin-scope key (a key cannot mint further keys)', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${adminKey()}`)
      .send({ name: 'new-key', scope: 'read' });
    expect(res.status).toBe(403);
  });

  it('GET /api/users is 403 for an admin-scope key (a key cannot list human admins)', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminKey()}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/users/invite is 403 for an admin-scope key (a key cannot invite human admins)', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminKey()}`)
      .send({ email: 'attacker@example.com', role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('PUT /api/users/:userId/role is 403 for an admin-scope key (a key cannot self-promote a human)', async () => {
    const app = makeApp();
    const res = await request(app)
      .put('/api/users/user_123/role')
      .set('Authorization', `Bearer ${adminKey()}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/users/:userId is 403 for an admin-scope key (a key cannot remove the real admin)', async () => {
    const app = makeApp();
    const res = await request(app)
      .delete('/api/users/user_123')
      .set('Authorization', `Bearer ${adminKey()}`);
    expect(res.status).toBe(403);
  });
});
