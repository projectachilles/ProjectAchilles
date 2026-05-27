import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDatabase } from '../../__tests__/helpers/db.js';
import type Database from 'better-sqlite3';

let testDb: Database.Database;
vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

beforeEach(() => {
  testDb = createTestDatabase();
});

describe('acceptApiKey()', () => {
  it('attaches synthetic auth with READ_ONLY permissions for a valid read-scope key', async () => {
    const { generateApiKey } = await import('../../services/apiKeys/apiKeys.service.js');
    const { acceptApiKey } = await import('../apiKeyAuth.middleware.js');
    const { READ_ONLY_PERMISSIONS } = await import('../../types/roles.js');

    const created = generateApiKey({
      name: 'k', scope: 'read', createdBy: 'u', orgId: 'org_x',
    });

    const req: any = { headers: { authorization: `Bearer ${created.key}` } };
    const next = vi.fn();
    acceptApiKey()(req, {} as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth.userId).toBe(`apikey:${created.id}`);
    expect(req.auth.orgId).toBe('org_x');
    const perms = req.auth.apiKeyPermissions as Set<string>;
    for (const p of READ_ONLY_PERMISSIONS) expect(perms.has(p)).toBe(true);
  });

  it('attaches operator permissions for a read-write-scope key', async () => {
    const { generateApiKey } = await import('../../services/apiKeys/apiKeys.service.js');
    const { acceptApiKey } = await import('../apiKeyAuth.middleware.js');
    const { ROLE_PERMISSIONS } = await import('../../types/roles.js');

    const created = generateApiKey({
      name: 'k', scope: 'read-write', createdBy: 'u', orgId: null,
    });

    const req: any = { headers: { authorization: `Bearer ${created.key}` } };
    acceptApiKey()(req, {} as any, vi.fn());
    const perms = req.auth.apiKeyPermissions as Set<string>;
    for (const p of ROLE_PERMISSIONS.operator) expect(perms.has(p)).toBe(true);
    expect(perms.has('settings:users:manage')).toBe(false);
    expect(perms.has('endpoints:agents:delete')).toBe(false);
  });

  it('does NOT attach auth for an unknown / malformed / revoked key (falls through silently)', async () => {
    const { acceptApiKey } = await import('../apiKeyAuth.middleware.js');
    const next = vi.fn();

    const req1: any = { headers: { authorization: 'Bearer pa_unknown' } };
    acceptApiKey()(req1, {} as any, next);
    expect(req1.auth).toBeUndefined();

    const req2: any = { headers: { authorization: 'Bearer not_a_pa_key' } };
    acceptApiKey()(req2, {} as any, next);
    expect(req2.auth).toBeUndefined();

    const req3: any = { headers: {} };
    acceptApiKey()(req3, {} as any, next);
    expect(req3.auth).toBeUndefined();

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('does NOT override existing auth (Clerk/CLI precedence preserved)', async () => {
    const { generateApiKey } = await import('../../services/apiKeys/apiKeys.service.js');
    const { acceptApiKey } = await import('../apiKeyAuth.middleware.js');

    const created = generateApiKey({ name: 'k', scope: 'read', createdBy: 'u', orgId: null });
    const existing = { userId: 'clerk_user', sessionClaims: {} };
    const req: any = {
      headers: { authorization: `Bearer ${created.key}` },
      auth: existing,
    };
    acceptApiKey()(req, {} as any, vi.fn());
    expect(req.auth).toBe(existing);
  });

  it('regression: does NOT propagate when req.auth() throws (Clerk parse error on malformed JWT)', async () => {
    // Pre-refactor this 500'd: the unguarded `(req as any).auth()` call
    // surfaced Clerk's `Unexpected end of data` parse error to the client.
    const { acceptApiKey } = await import('../apiKeyAuth.middleware.js');
    const next = vi.fn();
    const req: any = {
      headers: { authorization: 'Bearer abc.def.ghi' },
      auth: () => { throw new Error('Unexpected end of data'); },
    };
    expect(() => acceptApiKey()(req, {} as any, next)).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
  });
});
