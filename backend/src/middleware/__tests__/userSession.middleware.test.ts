import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireUserSession } from '../userSession.middleware.js';

function run(auth: unknown, callable: boolean) {
  const req = { auth: callable ? () => auth : auth } as unknown as Request;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) } as unknown as Response;
  const next = vi.fn();
  requireUserSession()(req, res, next);
  return { res, json, next };
}

describe.each([true, false])('requireUserSession (callable auth: %s)', (callable) => {
  it('passes a Clerk browser session', () => {
    const { next, res } = run({ tokenType: 'session_token', userId: 'user_1' }, callable);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ['CLI shape (no tokenType)', { userId: 'user_1' }],
    ['API-key shape', { userId: 'apikey:k1', apiKeyPermissions: new Set<string>() }],
    ['non-session token type', { tokenType: 'api_key', userId: 'user_1' }],
    ['no auth', undefined],
  ])('403 for %s', (_name, auth) => {
    const { next, res, json } = run(auth, callable);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'This action requires a signed-in user session' });
  });
});
