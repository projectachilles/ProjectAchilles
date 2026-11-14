import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createTestDatabase } from '../../__tests__/helpers/db.js';
import type Database from 'better-sqlite3';

let testDb: Database.Database;
vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const getUser = vi.fn();
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: (...args: unknown[]) => getUser(...args) } },
}));

const SECRET = 'test-cli-secret';
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

function storeRefreshToken(opts: { token?: string; userId?: string; role?: string | null; expiresAt?: string } = {}): string {
  const token = opts.token ?? crypto.randomBytes(32).toString('hex');
  testDb.prepare(`
    INSERT INTO cli_refresh_tokens (token_hash, user_id, org_id, role, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    sha256(token),
    opts.userId ?? 'user_1',
    'default',
    opts.role === undefined ? 'admin' : opts.role,
    opts.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  );
  return token;
}

const tokenCount = (userId = 'user_1') =>
  (testDb.prepare('SELECT COUNT(*) AS n FROM cli_refresh_tokens WHERE user_id = ?').get(userId) as { n: number }).n;

async function makeApp() {
  const router = (await import('../cli-auth.routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/cli/auth', router);
  return app;
}

const refresh = async (refresh_token: string) =>
  request(await makeApp()).post('/api/cli/auth/refresh').send({ refresh_token });

beforeEach(() => {
  testDb = createTestDatabase();
  process.env.CLI_AUTH_SECRET = SECRET;
  getUser.mockReset();
  getUser.mockResolvedValue({ id: 'user_1', banned: false, locked: false, publicMetadata: { role: 'admin' } });
});

describe('POST /api/cli/auth/refresh', () => {
  it('issues a new token pair for an active user', async () => {
    const res = await refresh(storeRefreshToken());
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.data.access_token, SECRET) as { sub: string; role: string };
    expect(payload.sub).toBe('user_1');
    expect(payload.role).toBe('admin');
    expect(getUser).toHaveBeenCalledWith('user_1');
  });

  it('refuses a user who no longer exists, and drops their refresh tokens', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const res = await refresh(storeRefreshToken());
    expect(res.status).toBe(401);
    expect(tokenCount()).toBe(0);
  });

  it('refuses a banned user, and drops their refresh tokens', async () => {
    getUser.mockResolvedValue({ id: 'user_1', banned: true, locked: false, publicMetadata: { role: 'admin' } });
    const res = await refresh(storeRefreshToken());
    expect(res.status).toBe(401);
    expect(tokenCount()).toBe(0);
  });

  it('refuses a locked user but keeps the session for when the lock ends', async () => {
    getUser.mockResolvedValue({ id: 'user_1', banned: false, locked: true, publicMetadata: { role: 'admin' } });
    const res = await refresh(storeRefreshToken());
    expect(res.status).toBe(401);
    expect(tokenCount()).toBe(1);
  });

  it('issues the role the user has now, not the one stored at sign-in', async () => {
    getUser.mockResolvedValue({ id: 'user_1', banned: false, locked: false, publicMetadata: { role: 'analyst' } });
    const res = await refresh(storeRefreshToken({ role: 'admin' }));
    expect(res.status).toBe(200);
    expect((jwt.verify(res.body.data.access_token, SECRET) as { role: string }).role).toBe('analyst');
    // The rotated refresh token carries the current role too.
    const row = testDb.prepare('SELECT role FROM cli_refresh_tokens WHERE user_id = ?').get('user_1') as { role: string };
    expect(row.role).toBe('analyst');
  });

  it('issues no role when the user has none (or an unknown one)', async () => {
    getUser.mockResolvedValue({ id: 'user_1', banned: false, locked: false, publicMetadata: { role: 'superuser' } });
    const res = await refresh(storeRefreshToken({ role: 'admin' }));
    expect(res.status).toBe(200);
    expect((jwt.verify(res.body.data.access_token, SECRET) as { role: string | null }).role).toBeNull();
  });

  it('fails closed with 503 when the user cannot be checked, keeping the session', async () => {
    getUser.mockRejectedValue(Object.assign(new Error('upstream'), { status: 500 }));
    const token = storeRefreshToken();
    const res = await refresh(token);
    expect(res.status).toBe(503);
    expect(res.body.data).toBeUndefined();
    expect(tokenCount()).toBe(1);

    // Once the check works again the same refresh token is still good.
    getUser.mockResolvedValue({ id: 'user_1', banned: false, locked: false, publicMetadata: { role: 'admin' } });
    expect((await refresh(token)).status).toBe(200);
  });

  it('refuses a refresh token that expired a minute ago', async () => {
    const res = await refresh(storeRefreshToken({ expiresAt: new Date(Date.now() - 60 * 1000).toISOString() }));
    expect(res.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });
});
