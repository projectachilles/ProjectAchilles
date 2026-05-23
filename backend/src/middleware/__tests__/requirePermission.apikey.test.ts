import { describe, it, expect, vi } from 'vitest';

// Clerk's module instantiates clerkMiddleware() at import time — neutralise it.
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock('../../services/agent/database.js', () => ({ getDatabase: () => ({}) }));

const { requirePermission } = await import('../clerk.middleware.js');

function mkRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (s: number) => { res.statusCode = s; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

describe('requirePermission — explicit apiKeyPermissions branch', () => {
  it('grants when the explicit set contains all required permissions', () => {
    const req: any = { auth: { apiKeyPermissions: new Set(['endpoints:agents:write']) } };
    const res = mkRes();
    const next = vi.fn();
    requirePermission('endpoints:agents:write')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('denies (403) when the explicit set is missing a required permission', () => {
    const req: any = { auth: { apiKeyPermissions: new Set(['analytics:dashboards:read']) } };
    const res = mkRes();
    const next = vi.fn();
    requirePermission('endpoints:agents:write')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Insufficient permissions' });
  });

  it('falls back to the role path when no explicit set is present', () => {
    const req: any = { auth: { sessionClaims: { metadata: { role: 'admin' } } } };
    const res = mkRes();
    const next = vi.fn();
    requirePermission('endpoints:agents:write')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('denies when the explicit set is empty', () => {
    const req: any = { auth: { apiKeyPermissions: new Set() } };
    const res = mkRes();
    const next = vi.fn();
    requirePermission('analytics:dashboards:read')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Insufficient permissions' });
  });

  it('denies an unauthenticated request (no req.auth) when required perm exceeds the default', () => {
    // No req.auth at all — must NOT crash, must fall through to role path,
    // which defaults to the explorer (read-only) permission set. A permission
    // outside that set (e.g. endpoints:agents:write) should be denied.
    const req: any = {};
    const res = mkRes();
    const next = vi.fn();
    requirePermission('endpoints:agents:write')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
