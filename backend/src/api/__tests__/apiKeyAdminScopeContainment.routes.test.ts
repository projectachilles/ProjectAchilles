import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../__tests__/helpers/db.js';

/**
 * Route-level containment tests for bearer credentials on human-session-only
 * routes, including the admin API-key scope carve-out (see
 * `permissionsForScope()` / `ADMIN_API_KEY_PERMISSIONS` in
 * apiKeyAuth.middleware.ts) and admin CLI tokens.
 *
 * Deliberately does NOT reuse the mocks in api-keys.routes.test.ts —
 * that file replaces `requirePermission` with an always-`next()`
 * passthrough (its focus is response shape, not authorization), which
 * would make an authorization-containment test vacuously pass. This file
 * exercises the real bearer middleware -> `requireClerkAuth()` ->
 * `requireUserSession()` -> `requirePermission()` chain exactly as server.ts
 * wires it. A regression that lets either bearer credential cross the human
 * session boundary would therefore fail these tests.
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

const { acceptCliAuth } = await import('../../middleware/cliAuth.middleware.js');
const { acceptApiKey } = await import('../../middleware/apiKeyAuth.middleware.js');
const { generateApiKey } = await import('../../services/apiKeys/apiKeys.service.js');
const apiKeysRouter = (await import('../api-keys.routes.js')).default;
const usersRouter = (await import('../users.routes.js')).default;
const cliAuthRouter = (await import('../cli-auth.routes.js')).default;
const { errorHandler } = await import('../../middleware/error.middleware.js');

function makeApp(auth?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  if (auth) {
    app.use((req, _res, next) => {
      (req as unknown as { auth: Record<string, unknown> }).auth = auth;
      next();
    });
  }
  app.use(acceptCliAuth());
  app.use(acceptApiKey());
  app.use('/api/api-keys', apiKeysRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/cli/auth', cliAuthRouter);
  app.use(errorHandler);
  return app;
}

const CLI_SECRET = 'test-cli-secret';

beforeEach(() => {
  testDb = createTestDatabase();
  process.env.CLI_AUTH_SECRET = CLI_SECRET;
});

function adminKey(): string {
  return generateApiKey({ name: 'admin automation', scope: 'admin', createdBy: 'u', orgId: 'org_x' }).key;
}

function adminCliToken(): string {
  return jwt.sign(
    { sub: 'user_admin', org_id: 'org_x', role: 'admin', type: 'cli' },
    CLI_SECRET,
    { algorithm: 'HS256', issuer: 'projectachilles' },
  );
}

function storePendingCode(userCode: string): void {
  testDb.prepare(`
    INSERT INTO cli_auth_codes (device_code_hash, user_code, expires_at)
    VALUES (?, ?, ?)
  `).run('pending-device-hash', userCode, new Date(Date.now() + 5 * 60 * 1000).toISOString());
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

describe('admin CLI token containment', () => {
  it('cannot mint a durable API key', async () => {
    const res = await request(makeApp())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${adminCliToken()}`)
      .send({ name: 'persistent-key', scope: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This action requires a signed-in user session');
    const count = testDb.prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('cannot invite a durable human administrator', async () => {
    const res = await request(makeApp())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminCliToken()}`)
      .send({ email: 'attacker@example.com', role: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This action requires a signed-in user session');
  });

  it('cannot promote a human account', async () => {
    const res = await request(makeApp())
      .put('/api/users/user_attacker/role')
      .set('Authorization', `Bearer ${adminCliToken()}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This action requires a signed-in user session');
  });

  it('cannot verify another CLI device code', async () => {
    storePendingCode('CLI1-CODE');
    const res = await request(makeApp())
      .post('/api/cli/auth/verify')
      .set('Authorization', `Bearer ${adminCliToken()}`)
      .send({ user_code: 'CLI1-CODE' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This action requires a signed-in user session');
    const code = testDb.prepare('SELECT verified_at, user_id FROM cli_auth_codes WHERE user_code = ?')
      .get('CLI1-CODE') as { verified_at: string | null; user_id: string | null };
    expect(code).toEqual({ verified_at: null, user_id: null });
  });
});

describe('browser session behavior', () => {
  it('still verifies a CLI device code', async () => {
    storePendingCode('USER-CODE');
    const session = {
      tokenType: 'session_token',
      userId: 'user_admin',
      orgId: 'org_x',
      sessionClaims: { metadata: { role: 'admin' } },
    };
    const res = await request(makeApp(session))
      .post('/api/cli/auth/verify')
      .send({ user_code: 'USER-CODE' });

    expect(res.status).toBe(200);
    const code = testDb.prepare('SELECT verified_at, user_id FROM cli_auth_codes WHERE user_code = ?')
      .get('USER-CODE') as { verified_at: string | null; user_id: string | null };
    expect(code.verified_at).not.toBeNull();
    expect(code.user_id).toBe('user_admin');
  });
});
