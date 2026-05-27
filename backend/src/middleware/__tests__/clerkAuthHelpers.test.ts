import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { safeClerkAuth } from '../clerkAuthHelpers.js';

function makeReq(auth: unknown, hasAuth = true): Request {
  const req: Record<string, unknown> = { headers: {} };
  if (hasAuth) req.auth = auth;
  return req as unknown as Request;
}

describe('safeClerkAuth()', () => {
  it('returns undefined when req.auth is missing', () => {
    expect(safeClerkAuth(makeReq(undefined, false))).toBeUndefined();
  });

  it('returns the value when req.auth is a plain object (legacy SDK / synthetic)', () => {
    const auth = { userId: 'user_legacy', orgId: 'org_x' };
    expect(safeClerkAuth(makeReq(auth))).toBe(auth);
  });

  it('invokes req.auth() when it is a function (Clerk v5+)', () => {
    let calls = 0;
    const auth = () => {
      calls++;
      return { userId: 'user_v5' };
    };
    expect(safeClerkAuth(makeReq(auth))).toEqual({ userId: 'user_v5' });
    expect(calls).toBe(1);
  });

  it('preserves `this` binding when calling req.auth() as a method', () => {
    const received: Array<unknown> = [];
    const req = {
      headers: {},
      auth(this: unknown): { userId: string } {
        received.push(this);
        return { userId: 'user_bound' };
      },
    } as unknown as Request;
    safeClerkAuth(req);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(req);
  });

  it('returns undefined when req.auth() throws (Clerk parse error on malformed JWT)', () => {
    // Live regression: @clerk/express threw `Error: Unexpected end of data`
    // from base64 decode when a stale/empty Bearer reached the server.
    const auth = () => {
      throw new Error('Unexpected end of data');
    };
    expect(() => safeClerkAuth(makeReq(auth))).not.toThrow();
    expect(safeClerkAuth(makeReq(auth))).toBeUndefined();
  });

  it('returns whatever req.auth() returns — including null / { userId: null }', () => {
    expect(safeClerkAuth(makeReq(() => null))).toBeNull();
    expect(safeClerkAuth(makeReq(() => ({ userId: undefined })))).toEqual({ userId: undefined });
  });
});
