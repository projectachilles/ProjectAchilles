import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { acceptCliAuth } from '../cliAuth.middleware.js';

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
});
