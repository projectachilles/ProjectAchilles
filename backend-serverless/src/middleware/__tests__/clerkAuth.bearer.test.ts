import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * clerkMiddleware forces acceptsToken: 'any', so for any Bearer token that is
 * not a JWT it calls Clerk's Backend API (POST /api_keys/verify) with that
 * token. Agent keys (ak_) and Achilles API keys (pa_) are not Clerk tokens:
 * they must never leave the deployment, and the round trip added ~140 ms to
 * every agent poll. This runs the REAL clerkMiddleware with well-formed fake
 * keys and records every outbound fetch.
 */

const outbound: Array<{ url: string; body: string }> = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  // A syntactically valid publishable key: base64("clerk.example.com$").
  process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from('clerk.example.com$').toString('base64')}`;
  // Built at runtime: a literal sk_test_ value trips secret scanning.
  process.env.CLERK_SECRET_KEY = ['sk', 'test', 'f'.repeat(40)].join('_');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    outbound.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    return new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function appWithClerk() {
  const { clerkAuth } = await import('../clerk.middleware.js');
  const app = express();
  app.use(clerkAuth);
  app.get('/probe', (req, res) => {
    const auth = (req as unknown as { auth?: unknown }).auth;
    res.json({
      authorization: req.headers.authorization ?? null,
      hasAuth: typeof auth === 'function' || typeof auth === 'object',
    });
  });
  return app;
}

describe('clerkAuth with non-Clerk bearer tokens', () => {
  beforeEach(() => {
    outbound.length = 0;
  });

  for (const token of [`ak_${'a'.repeat(40)}`, `pa_${'b'.repeat(40)}`]) {
    it(`never sends a ${token.slice(0, 3)} token to Clerk, and leaves it for the next middleware`, async () => {
      const app = await appWithClerk();
      const res = await request(app).get('/probe').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(outbound.filter((c) => c.body.includes(token) || c.url.includes(token))).toEqual([]);
      expect(outbound.filter((c) => c.url.includes('api_keys'))).toEqual([]);
      expect(res.body.authorization).toBe(`Bearer ${token}`);
      expect(res.body.hasAuth).toBe(true);
    });
  }

  it('still runs Clerk for requests without a bearer token', async () => {
    const app = await appWithClerk();
    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
    expect(res.body.hasAuth).toBe(true);
  });
});
