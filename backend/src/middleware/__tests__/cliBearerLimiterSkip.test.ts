import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { cliBearerLimiterSkip } from '../cliBearerLimiterSkip.js';

function makeReq(opts: { authorization?: string; auth?: unknown }): Request {
  const req: Record<string, unknown> = {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
  };
  if (Object.prototype.hasOwnProperty.call(opts, 'auth')) {
    req.auth = opts.auth;
  }
  return req as unknown as Request;
}

describe('cliBearerLimiterSkip()', () => {
  it('skips when no Authorization header is present', () => {
    expect(cliBearerLimiterSkip(makeReq({}))).toBe(true);
  });

  it('skips non-Bearer authentication schemes', () => {
    expect(cliBearerLimiterSkip(makeReq({ authorization: 'Basic dXNlcjpwYXNz' }))).toBe(true);
  });

  it('skips Bearer pa_ API keys (handled by apiKeyAuthLimiter)', () => {
    expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer pa_live_abc123' }))).toBe(true);
  });

  it('skips Clerk-authenticated requests where req.auth is a function (Clerk v5+)', () => {
    const auth = () => ({ userId: 'user_2NxXabcDEF' });
    expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer eyJ.clerk.jwt', auth }))).toBe(true);
  });

  it('skips Clerk-authenticated requests where req.auth is a plain object (legacy Clerk SDK)', () => {
    expect(cliBearerLimiterSkip(makeReq({
      authorization: 'Bearer eyJ.clerk.jwt',
      auth: { userId: 'user_2NxXabcDEF' },
    }))).toBe(true);
  });

  it('counts (does NOT skip) an unauthenticated Bearer token — the actual CLI-verifier candidate', () => {
    expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer eyJ.unknown.jwt' }))).toBe(false);
  });

  it('counts a Bearer request where req.auth exists but carries no userId', () => {
    expect(cliBearerLimiterSkip(makeReq({
      authorization: 'Bearer eyJ.unknown.jwt',
      auth: { sessionId: 'sess_only' },
    }))).toBe(false);
  });

  it('counts a Bearer request where req.auth() returns null', () => {
    expect(cliBearerLimiterSkip(makeReq({
      authorization: 'Bearer eyJ.unknown.jwt',
      auth: () => null,
    }))).toBe(false);
  });

  it('regression: 100 sequential Clerk-authenticated requests all skip (would have throttled at 60)', () => {
    const auth = () => ({ userId: 'user_dashboard' });
    const req = makeReq({ authorization: 'Bearer eyJ.clerk.jwt', auth });
    for (let i = 0; i < 100; i++) {
      expect(cliBearerLimiterSkip(req)).toBe(true);
    }
  });
});
