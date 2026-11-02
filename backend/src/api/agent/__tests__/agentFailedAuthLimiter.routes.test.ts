import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

/**
 * Per-IP bound on failed agent authentication, tested through the real
 * `createAgentRouter()` so the middleware order is the production one:
 * failed-auth limiter + agentDeviceLimiter -> requireAgentAuth -> routers.
 *
 * The attack: random `ak_` token + a fresh X-Agent-ID on every request. Each
 * one costs a bcrypt cost-12 compare against DUMMY_HASH, and rotating the ID
 * escapes agentDeviceLimiter (keyed on IP + agent ID). The failed-auth limiter
 * only counts 401s for UNKNOWN agent IDs (requireAgentAuth marks them with
 * res.locals.agentAuthFailure = 'not_found'), so it has to observe the final
 * status requireAgentAuth sends from inside its async bcrypt callback. Known
 * agents that fail (decommissioned, stale key, clock skew) are already capped
 * per ID by agentDeviceLimiter and must not throttle healthy peers on one NAT.
 *
 * bcryptjs is swapped for a fast, still-async stand-in (counting compares) so
 * 60+ failures don't cost minutes of cost-12 hashing; everything else is real.
 */

let testDb: Database.Database;
vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const compareCalls = { n: 0 };
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcryptjs')>();
  // The code under test uses the default export (`import bcrypt from 'bcryptjs'`).
  const base = (actual as unknown as { default?: typeof actual }).default ?? actual;
  const fake = {
    ...base,
    hashSync: (value: string) => `fake$${value}`,
    compare: async (value: string, hash: string) => {
      compareCalls.n++;
      await new Promise((r) => setImmediate(r)); // stay async, like the real compare
      return hash === `fake$${value}`;
    },
  };
  return { ...actual, default: fake };
});

// Each test uses a fresh DB; the process-wide agent row cache would leak rows.
vi.mock('../../../services/agent/agentAuthCache.js', () => ({
  getCachedAgent: () => null,
  setCachedAgent: () => {},
  invalidateAgentCache: () => {},
}));

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
}));

const { createAgentRouter } = await import('../index.js');
const { _clearAgentKeyDigestMemory } = await import('../../../services/agent/agentKeyDigest.js');

function makeApp() {
  const app = express();
  app.set('trust proxy', 1); // as server.ts (TRUST_PROXY_HOPS default)
  app.use(express.json());
  app.use('/api/agent', createAgentRouter({ testSources: [], testsSourcePath: '', agentSourcePath: '' }));
  return app;
}

const randomToken = () => `ak_${crypto.randomBytes(32).toString('hex')}`;

function forged(app: express.Express, ip: string) {
  return request(app)
    .get('/api/agent/version')
    .set('X-Forwarded-For', ip)
    .set('Authorization', `Bearer ${randomToken()}`)
    .set('X-Agent-ID', `agent-${crypto.randomUUID()}`)
    .set('X-Request-Timestamp', new Date().toISOString());
}

beforeEach(() => {
  testDb = createTestDatabase();
  _clearAgentKeyDigestMemory();
  compareCalls.n = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent failed-auth limiter (per IP)', () => {
  it('one IP rotating agent IDs is limited after 60 failed auths', async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      const res = await forged(app, '203.0.113.10');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Invalid agent credentials' });
    }
    expect(compareCalls.n).toBe(60);

    const blocked = await forged(app, '203.0.113.10');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ success: false, error: 'Too many failed agent authentication attempts' });
    // Rejected before requireAgentAuth: no bcrypt compare for the 61st request.
    expect(compareCalls.n).toBe(60);

    // Another IP is unaffected.
    const other = await forged(app, '198.51.100.20');
    expect(other.status).toBe(401);
  });

  it('successful agents behind one IP are never limited by it', async () => {
    const app = makeApp();
    const agents = Array.from({ length: 25 }, (_, i) => {
      const token = randomToken();
      const id = `agent-ok-${i}`;
      insertTestAgent(testDb, { id, api_key_hash: `fake$${token}` });
      return { id, token };
    });

    const statuses: number[] = [];
    for (let round = 0; round < 4; round++) {
      for (const a of agents) {
        const res = await request(app)
          .get('/api/agent/version')
          .set('X-Forwarded-For', '192.0.2.50')
          .set('Authorization', `Bearer ${a.token}`)
          .set('X-Agent-ID', a.id)
          .set('X-Request-Timestamp', new Date().toISOString());
        statuses.push(res.status);
      }
    }
    expect(statuses).toHaveLength(100);
    expect(statuses.every((s) => s === 204)).toBe(true);

    // The 100 successes left the failed-auth budget untouched: the same IP can
    // still fail 60 times before the 61st is limited.
    for (let i = 0; i < 60; i++) {
      expect((await forged(app, '192.0.2.50')).status).toBe(401);
    }
    expect((await forged(app, '192.0.2.50')).status).toBe(429);
  });

  it('counts only 401s: a busy agent throttled by agentDeviceLimiter does not fill it', async () => {
    const token = randomToken();
    insertTestAgent(testDb, { id: 'agent-busy', api_key_hash: `fake$${token}` });
    const app = makeApp();
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await request(app)
        .get('/api/agent/version')
        .set('X-Forwarded-For', '192.0.2.77')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Agent-ID', 'agent-busy')
        .set('X-Request-Timestamp', new Date().toISOString());
      statuses.push(res.status);
    }
    // 30/min per IP + agent ID, then agentDeviceLimiter's own 429s.
    expect(statuses.filter((s) => s === 204)).toHaveLength(30);
    expect(statuses.filter((s) => s === 429)).toHaveLength(70);

    // None of those 70 429s counted as failed authentication.
    for (let i = 0; i < 60; i++) {
      expect((await forged(app, '192.0.2.77')).status).toBe(401);
    }
    expect((await forged(app, '192.0.2.77')).status).toBe(429);
  });

  it('a known but decommissioned agent failing 70 times from one IP is never limited by it', async () => {
    const token = randomToken();
    insertTestAgent(testDb, { id: 'agent-gone', api_key_hash: `fake$${token}`, status: 'decommissioned' });
    const app = makeApp();
    const bodies: Array<{ status: number; error: string }> = [];
    for (let i = 0; i < 70; i++) {
      const res = await request(app)
        .get('/api/agent/version')
        .set('X-Forwarded-For', '203.0.113.99')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Agent-ID', 'agent-gone')
        .set('X-Request-Timestamp', new Date().toISOString());
      bodies.push({ status: res.status, error: res.body.error });
    }
    // 30 x 401 (uniform body), then agentDeviceLimiter's per-ID cap; never this limiter.
    expect(bodies.slice(0, 30).every((b) => b.status === 401 && b.error === 'Invalid agent credentials')).toBe(true);
    expect(bodies.slice(30).every((b) => b.status === 429 && b.error === 'Too many agent requests, try again later')).toBe(true);

    // None of the 70 counted: the IP still has its full 60 unknown-agent failures.
    for (let i = 0; i < 60; i++) {
      expect((await forged(app, '203.0.113.99')).status).toBe(401);
    }
    const blocked = await forged(app, '203.0.113.99');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Too many failed agent authentication attempts');
  });

  it('does not count a known agent with a wrong key or a request missing its agent headers', async () => {
    insertTestAgent(testDb, { id: 'agent-known', api_key_hash: 'fake$ak_right' });
    const app = makeApp();
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .get('/api/agent/version')
        .set('X-Forwarded-For', '203.0.113.98')
        .set('Authorization', 'Bearer ak_wrong')
        .set('X-Agent-ID', 'agent-known')
        .set('X-Request-Timestamp', new Date().toISOString());
      expect(res.status).toBe(401);
    }
    // No X-Agent-ID: rejected before any bcrypt work.
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .get('/api/agent/version')
        .set('X-Forwarded-For', '203.0.113.98')
        .set('Authorization', `Bearer ${randomToken()}`);
      expect(res.status).toBe(401);
    }
    for (let i = 0; i < 60; i++) {
      expect((await forged(app, '203.0.113.98')).status).toBe(401);
    }
    expect((await forged(app, '203.0.113.98')).status).toBe(429);
  });
});
