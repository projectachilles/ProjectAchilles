import { describe, it, expect } from 'vitest';
import express from 'express';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { cliBearerLimiterSkip } from '../cliBearerLimiterSkip.js';

function makeReq(opts: { authorization?: string; auth?: unknown; url?: string }): Request {
  const req: Record<string, unknown> = {
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    originalUrl: opts.url ?? '/api/analytics/defense-score',
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

  it('regression: does NOT propagate when req.auth() throws (Clerk parse error on malformed JWT)', () => {
    // Real example from prod: @clerk/express threw `Error: Unexpected end of
    // data` from its base64 decode when a stale/empty Bearer hit the server.
    const auth = () => { throw new Error('Unexpected end of data'); };
    const req = makeReq({ authorization: 'Bearer abc.def.ghi', auth });
    expect(() => cliBearerLimiterSkip(req)).not.toThrow();
    // Counted toward the limit — downstream auth will return a clean 401.
    expect(cliBearerLimiterSkip(req)).toBe(false);
  });

  it('invokes req.auth as a method so `this` binding is preserved for Clerk SDK impls that rely on it', () => {
    const calls: Array<unknown> = [];
    const req = {
      headers: { authorization: 'Bearer eyJ.clerk.jwt' },
      auth(this: unknown): { userId: string } {
        calls.push(this);
        return { userId: 'user_bound' };
      },
    } as unknown as Request;
    expect(cliBearerLimiterSkip(req)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(req);
  });

  describe('agent device traffic', () => {
    it('skips Bearer ak_ on agent device routes', () => {
      for (const url of ['/api/agent/tasks', '/api/agent/heartbeat', '/api/agent/tasks?x=1']) {
        expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer ak_abc123', url }))).toBe(true);
      }
    });

    it('still counts Bearer ak_ on admin and non-agent routes', () => {
      for (const url of [
        '/api/agent/admin/agents',
        '/api/agent/admin?x=1',
        '/api/analytics/defense-score',
        '/api/agent',
        '/api/agentx/tasks',
      ]) {
        expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer ak_abc123', url }))).toBe(false);
      }
    });

    it('existing rules unchanged on agent paths', () => {
      const url = '/api/agent/tasks';
      expect(cliBearerLimiterSkip(makeReq({ url }))).toBe(true);
      expect(cliBearerLimiterSkip(makeReq({ authorization: 'Basic dXNlcjpwYXNz', url }))).toBe(true);
      expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer pa_live_x', url }))).toBe(true);
      expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer eyJ.c.jwt', auth: { userId: 'u' }, url }))).toBe(true);
      expect(cliBearerLimiterSkip(makeReq({ authorization: 'Bearer random-token', url }))).toBe(false);
    });

    it('25 agents behind one IP are not rate-limited by the CLI limiter', async () => {
      const app = express();
      app.use(rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        skip: cliBearerLimiterSkip,
      }));
      app.get('/api/agent/tasks', (_req, res) => { res.json({ ok: true }); });
      app.get('/api/other', (_req, res) => { res.json({ ok: true }); });

      let limited = 0;
      for (let round = 0; round < 3; round++) {
        for (let a = 0; a < 25; a++) {
          const r = await request(app).get('/api/agent/tasks').set('Authorization', `Bearer ak_agent${a}`);
          if (r.status === 429) limited++;
        }
      }
      expect(limited).toBe(0);

      // ak_ on a non-agent path is still counted and eventually limited
      let other429 = 0;
      for (let i = 0; i < 70; i++) {
        const r = await request(app).get('/api/other').set('Authorization', 'Bearer ak_probe');
        if (r.status === 429) other429++;
      }
      expect(other429).toBeGreaterThan(0);
    });
  });
});
