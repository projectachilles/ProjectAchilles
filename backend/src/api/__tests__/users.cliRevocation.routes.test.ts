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

const deleteUser = vi.fn();
const updateUserMetadata = vi.fn();
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      deleteUser: (...args: unknown[]) => deleteUser(...args),
      updateUserMetadata: (...args: unknown[]) => updateUserMetadata(...args),
    },
  },
}));
vi.mock('../../middleware/clerk.middleware.js', () => ({
  requireClerkAuth: () => (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = { userId: 'admin_user_1', sessionClaims: { metadata: { role: 'admin' } } };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getUserId: (auth: { userId?: string }) => auth?.userId,
}));

const { isCliTokenRevoked } = await import('../../services/cliSessions.js');

function storeRefreshToken(userId: string, hash: string): void {
  testDb.prepare(`
    INSERT INTO cli_refresh_tokens (token_hash, user_id, org_id, role, expires_at)
    VALUES (?, ?, 'default', 'admin', ?)
  `).run(hash, userId, new Date(Date.now() + 30 * 60 * 1000).toISOString());
}
const tokenCount = (userId: string) =>
  (testDb.prepare('SELECT COUNT(*) AS n FROM cli_refresh_tokens WHERE user_id = ?').get(userId) as { n: number }).n;

/** `iat` of a CLI access token issued a minute ago. */
const issuedAMinuteAgo = () => Math.floor(Date.now() / 1000) - 60;

async function makeApp() {
  const router = (await import('../users.routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/users', router);
  return app;
}

beforeEach(() => {
  testDb = createTestDatabase();
  deleteUser.mockReset().mockResolvedValue({});
  updateUserMetadata.mockReset().mockResolvedValue({});
  storeRefreshToken('user_gone', 'hash-a');
  storeRefreshToken('user_gone', 'hash-b');
  storeRefreshToken('user_other', 'hash-c');
});

describe('user changes end that user\'s CLI sessions', () => {
  it('DELETE /api/users/:id drops the refresh tokens and revokes issued access tokens', async () => {
    const iat = issuedAMinuteAgo();
    expect(isCliTokenRevoked('user_gone', iat)).toBe(false);

    const res = await request(await makeApp()).delete('/api/users/user_gone');
    expect(res.status).toBe(200);
    expect(tokenCount('user_gone')).toBe(0);
    expect(isCliTokenRevoked('user_gone', iat)).toBe(true);
  });

  // A code the user approved in the browser but the CLI has not collected yet
  // would otherwise be exchanged for a fresh token after the revocation.
  it.each([
    ['DELETE /api/users/:id', (app: express.Express) => request(app).delete('/api/users/user_gone')],
    ['PUT /api/users/:id/role', (app: express.Express) => request(app).put('/api/users/user_gone/role').send({ role: 'analyst' })],
    ['DELETE /api/users/:id/role', (app: express.Express) => request(app).delete('/api/users/user_gone/role')],
  ])('%s drops the device codes the user approved but has not collected', async (_name, call) => {
    const insert = testDb.prepare(`
      INSERT INTO cli_auth_codes (device_code_hash, user_code, expires_at, verified_at, user_id, org_id, role)
      VALUES (?, ?, ?, ?, ?, 'default', 'admin')
    `);
    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    insert.run('code-gone', 'AAAA-AAAA', soon, new Date().toISOString(), 'user_gone');
    insert.run('code-other', 'BBBB-BBBB', soon, new Date().toISOString(), 'user_other');

    const res = await call(await makeApp());
    expect(res.status).toBe(200);
    const left = testDb.prepare('SELECT device_code_hash FROM cli_auth_codes').all() as { device_code_hash: string }[];
    expect(left.map((r) => r.device_code_hash)).toEqual(['code-other']);
  });

  it('leaves other users\' CLI sessions alone', async () => {
    await request(await makeApp()).delete('/api/users/user_gone');
    expect(tokenCount('user_other')).toBe(1);
    expect(isCliTokenRevoked('user_other', issuedAMinuteAgo())).toBe(false);
  });

  it('PUT /api/users/:id/role ends the sessions that carry the old role', async () => {
    const iat = issuedAMinuteAgo();
    const res = await request(await makeApp()).put('/api/users/user_gone/role').send({ role: 'analyst' });
    expect(res.status).toBe(200);
    expect(tokenCount('user_gone')).toBe(0);
    expect(isCliTokenRevoked('user_gone', iat)).toBe(true);
  });

  it('DELETE /api/users/:id/role ends the sessions that carry the old role', async () => {
    const iat = issuedAMinuteAgo();
    const res = await request(await makeApp()).delete('/api/users/user_gone/role');
    expect(res.status).toBe(200);
    expect(tokenCount('user_gone')).toBe(0);
    expect(isCliTokenRevoked('user_gone', iat)).toBe(true);
  });

  it('keeps the sessions when the change itself failed', async () => {
    deleteUser.mockRejectedValue(new Error('clerk down'));
    const app = await makeApp();
    app.use((_err: unknown, _req: unknown, res: express.Response, _next: unknown) => { res.status(500).end(); });
    const res = await request(app).delete('/api/users/user_gone');
    expect(res.status).toBe(500);
    expect(tokenCount('user_gone')).toBe(2);
  });

  it('a token issued after the revocation is accepted', async () => {
    await request(await makeApp()).delete('/api/users/user_gone/role');
    expect(isCliTokenRevoked('user_gone', Math.floor(Date.now() / 1000) + 5)).toBe(false);
  });
});
