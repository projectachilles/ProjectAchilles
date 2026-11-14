import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../__tests__/helpers/db.js';

let testDb: Database.Database;
vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { acceptCliAuth } = await import('../cliAuth.middleware.js');
const { getUserOrgId } = await import('../clerk.middleware.js');
const { revokeCliSessions } = await import('../../services/cliSessions.js');

beforeEach(() => {
  testDb = createTestDatabase();
});

const SECRET = 'test-cli-secret';
const cliToken = (org_id: string | null) =>
  jwt.sign({ sub: 'user_1', org_id, role: 'admin', type: 'cli' }, SECRET, { algorithm: 'HS256', issuer: 'projectachilles' });
const authOf = (req: Request) => (req.auth as unknown as () => Record<string, unknown>)();

function run(req: Partial<Request>): { next: ReturnType<typeof vi.fn>; req: Request } {
  const reqAny = req as Request;
  const next = vi.fn();
  acceptCliAuth()(reqAny, {} as Response, next as unknown as NextFunction);
  return { next, req: reqAny };
}

describe('acceptCliAuth()', () => {
  it('short-circuits (calls next) when Clerk already populated req.auth with a userId', () => {
    const { next, req } = run({
      headers: {},
      // legacy property form — same data shape Clerk synthesises
      auth: { userId: 'user_clerk' },
    } as unknown as Partial<Request>);
    expect(next).toHaveBeenCalledOnce();
    // Must NOT have replaced the existing auth with a synthetic CLI function.
    expect(req.auth).toEqual({ userId: 'user_clerk' });
  });

  it('regression: does NOT propagate when req.auth() throws (Clerk parse error on malformed JWT)', () => {
    // Pre-refactor this 500'd: the unguarded `(req as any).auth()` call
    // surfaced Clerk's `Unexpected end of data` parse error to the client.
    const throwingAuth = () => {
      throw new Error('Unexpected end of data');
    };
    const { next } = run({
      headers: { authorization: 'Bearer abc.def.ghi' },
      auth: throwingAuth,
    } as unknown as Partial<Request>);
    expect(next).toHaveBeenCalledOnce();
    // No error passed to next — downstream Clerk requireAuth() will 401 cleanly.
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('falls through (calls next) with no auth attached when there is no Bearer token', () => {
    const { next, req } = run({ headers: {} } as Partial<Request>);
    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toBeUndefined();
  });

  describe('the organization of a CLI token', () => {
    beforeAll(() => {
      process.env.CLI_AUTH_SECRET = SECRET;
    });

    // The device flow stores 'default' for a user without an organization. That
    // caller must look exactly like the same user's browser session (no org),
    // or #708 scopes it to an organization literally named "default".
    it.each(['default', null])('a token for a user without an organization (org_id %s) carries no org', (orgId) => {
      const { req } = run({ headers: { authorization: `Bearer ${cliToken(orgId)}` } } as Partial<Request>);
      expect(authOf(req).userId).toBe('user_1');
      expect(getUserOrgId(authOf(req))).toBeUndefined();
      expect(getUserOrgId(req.auth)).toBeUndefined();
    });

    it("a token for a user in an organization carries that organization", () => {
      const { req } = run({ headers: { authorization: `Bearer ${cliToken('org_abc')}` } } as Partial<Request>);
      expect(getUserOrgId(authOf(req))).toBe('org_abc');
    });
  });

  describe('a revoked CLI session', () => {
    beforeAll(() => {
      process.env.CLI_AUTH_SECRET = SECRET;
    });
    const tokenIssuedAt = (iat: number) =>
      jwt.sign({ sub: 'user_1', org_id: 'default', role: 'admin', type: 'cli', iat }, SECRET, { algorithm: 'HS256', issuer: 'projectachilles' });
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    it('a token issued before the user\'s sessions were revoked attaches no auth', () => {
      const token = tokenIssuedAt(nowSeconds() - 60);
      revokeCliSessions('user_1');
      const { next, req } = run({ headers: { authorization: `Bearer ${token}` } } as Partial<Request>);
      expect(next).toHaveBeenCalledOnce();
      expect(req.auth).toBeUndefined();
    });

    it('a token issued after the revocation works', () => {
      revokeCliSessions('user_1');
      const { req } = run({ headers: { authorization: `Bearer ${tokenIssuedAt(nowSeconds() + 5)}` } } as Partial<Request>);
      expect(authOf(req).userId).toBe('user_1');
    });

    it('another user\'s revocation does not affect the token', () => {
      revokeCliSessions('user_2');
      const { req } = run({ headers: { authorization: `Bearer ${tokenIssuedAt(nowSeconds() - 60)}` } } as Partial<Request>);
      expect(authOf(req).userId).toBe('user_1');
    });

    it('attaches no auth when the revocation list cannot be read', () => {
      const token = tokenIssuedAt(nowSeconds() - 60);
      testDb.close();
      const { next, req } = run({ headers: { authorization: `Bearer ${token}` } } as Partial<Request>);
      expect(next).toHaveBeenCalledOnce();
      expect(req.auth).toBeUndefined();
    });
  });
});
