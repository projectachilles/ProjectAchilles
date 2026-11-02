import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Disable the agent row cache in tests — each test creates a fresh DB,
// so stale cache entries would cause false positives. The key-digest module
// is real (it reads and writes the test DB); its memory is cleared per test.
vi.mock('../../services/agent/agentAuthCache.js', () => ({
  getCachedAgent: () => null,
  setCachedAgent: () => {},
  invalidateAgentCache: () => {},
}));

// Only the real enrollAgent (loaded via importActual in one test) uses this.
vi.mock('../../services/agent/signing.service.js', () => ({
  getPublicKeyBase64: () => 'dGVzdC1wdWJsaWMta2V5LTMyLWJ5dGVzIQ==',
  ensureSigningKeyPair: () => {},
}));

// Mock the enrollment service exports used by the auth middleware.
// Both key-resolution helpers operate on the real test database.
vi.mock('../../services/agent/enrollment.service.js', () => ({
  ROTATION_GRACE_PERIOD_SECONDS: 300,
  cancelPendingKey: (agentId: string) => {
    testDb.prepare(`
      UPDATE agents
      SET pending_api_key_hash = NULL,
          pending_api_key_encrypted = NULL,
          key_rotation_initiated_at = NULL,
          updated_at = ?
      WHERE id = ? AND pending_api_key_hash IS NOT NULL
    `).run(new Date().toISOString(), agentId);
  },
  promotePendingKey: (agentId: string) => {
    const now = new Date().toISOString();
    testDb.prepare(`
      UPDATE agents
      SET api_key_hash = pending_api_key_hash,
          pending_api_key_hash = NULL,
          pending_api_key_encrypted = NULL,
          key_rotation_initiated_at = NULL,
          api_key_rotated_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, agentId);
  },
}));

const { requireAgentAuth } = await import('../agentAuth.middleware.js');
const { recordAgentKeyDigest, _clearAgentKeyDigestMemory } = await import(
  '../../services/agent/agentKeyDigest.js'
);

// The middleware answers from inside a cost-12 bcryptjs compare (pure JS, and
// it runs against a dummy hash even for unknown agents, to avoid a timing
// oracle). That takes ~0.3 s idle but can pass vi.waitFor's 1 s default when
// the whole suite runs in parallel, which made these tests flaky in the
// pre-commit hook. Only the ceiling is raised: a passing check returns as
// soon as the response is sent.
const waitForResponse = (assertion: () => void) =>
  vi.waitFor(assertion, { timeout: 10_000, interval: 25 });

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('requireAgentAuth', () => {
  let apiKeyPlain: string;
  let apiKeyHash: string;

  beforeEach(async () => {
    testDb = createTestDatabase();
    _clearAgentKeyDigestMemory();
    apiKeyPlain = 'ak_testapikey123456';
    apiKeyHash = await bcrypt.hash(apiKeyPlain, 10);
    insertTestAgent(testDb, { id: 'agent-001', api_key_hash: apiKeyHash, status: 'active' });
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = mockReq({ 'x-agent-id': 'agent-001' });
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Agent-ID header is missing', () => {
    const req = mockReq({ authorization: `Bearer ${apiKeyPlain}` });
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token does not start with ak_', () => {
    const req = mockReq({
      authorization: 'Bearer invalid_token',
      'x-agent-id': 'agent-001',
    });
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when agent ID does not exist', async () => {
    const req = mockReq({
      authorization: `Bearer ${apiKeyPlain}`,
      'x-agent-id': 'nonexistent',
    });
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    // bcrypt.compare runs against dummy hash to prevent timing oracle
    await waitForResponse(() => {
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  it('returns 401 when agent is disabled (uniform error)', async () => {
    insertTestAgent(testDb, {
      id: 'disabled-agent',
      api_key_hash: apiKeyHash,
      status: 'disabled',
    });

    const req = mockReq({
      authorization: `Bearer ${apiKeyPlain}`,
      'x-agent-id': 'disabled-agent',
    });
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    // Timing oracle fix: disabled agents return 401 with same message as not-found
    await waitForResponse(() => {
      expect(res.status).toHaveBeenCalledWith(401);
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid agent credentials' })
    );
  });

  it('calls next() and sets req.agent for valid credentials', async () => {
    const req = mockReq({
      authorization: `Bearer ${apiKeyPlain}`,
      'x-agent-id': 'agent-001',
      'x-request-timestamp': new Date().toISOString(),
    }) as any;
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    // bcrypt.compare is async, wait for it
    await waitForResponse(() => {
      expect(next).toHaveBeenCalled();
    });

    expect(req.agent).toBeDefined();
    expect(req.agent.id).toBe('agent-001');
    expect(req.agent.org_id).toBe('org-001');
  });

  describe('timestamp validation', () => {
    it('rejects request with missing timestamp header', async () => {
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
      }) as any;
      const res = mockRes();
      const next = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(res.status).toHaveBeenCalledWith(401);
      });
      expect(next).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing X-Request-Timestamp'));
      warnSpy.mockRestore();
    });

    it('allows request with valid recent timestamp', async () => {
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': new Date().toISOString(),
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(next).toHaveBeenCalled();
      });
    });

    it('rejects stale timestamp (6 min old)', async () => {
      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': staleTime,
      });
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(res.status).toHaveBeenCalledWith(401);
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects future timestamp (6 min ahead)', async () => {
      const futureTime = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': futureTime,
      });
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(res.status).toHaveBeenCalledWith(401);
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects invalid timestamp format', async () => {
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': 'not-a-date',
      });
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(res.status).toHaveBeenCalledWith(401);
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('returns 401 for wrong API key', async () => {
    const req = mockReq({
      authorization: 'Bearer ak_wrongkey',
      'x-agent-id': 'agent-001',
    });
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    await waitForResponse(() => {
      expect(res.status).toHaveBeenCalledWith(401);
    });

    expect(next).not.toHaveBeenCalled();
  });

  describe('dual-key rotation', () => {
    let pendingKeyPlain: string;
    let pendingKeyHash: string;

    beforeEach(async () => {
      pendingKeyPlain = 'ak_newpendingkey99999';
      pendingKeyHash = await bcrypt.hash(pendingKeyPlain, 10);
    });

    it('authenticates with current key when no pending rotation', async () => {
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': new Date().toISOString(),
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(req.agent.id).toBe('agent-001');
    });

    it('authenticates with current key during grace period', async () => {
      // Set pending key (within grace period)
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      testDb.prepare(`
        UPDATE agents SET pending_api_key_hash = ?, key_rotation_initiated_at = ? WHERE id = ?
      `).run(pendingKeyHash, recentTime, 'agent-001');

      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': new Date().toISOString(),
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(req.agent.id).toBe('agent-001');
    });

    it('authenticates with pending key and promotes it', async () => {
      // Set pending key (within grace period)
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      testDb.prepare(`
        UPDATE agents SET pending_api_key_hash = ?, pending_api_key_encrypted = 'encrypted_data', key_rotation_initiated_at = ? WHERE id = ?
      `).run(pendingKeyHash, recentTime, 'agent-001');

      const req = mockReq({
        authorization: `Bearer ${pendingKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': new Date().toISOString(),
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(next).toHaveBeenCalled();
      });

      // Pending key should have been promoted
      const row = testDb.prepare('SELECT api_key_hash, pending_api_key_hash FROM agents WHERE id = ?').get('agent-001') as any;
      expect(row.pending_api_key_hash).toBeNull();
      // New api_key_hash should match the pending key
      expect(await bcrypt.compare(pendingKeyPlain, row.api_key_hash)).toBe(true);
    });

    // A rotation must be resolved by which key the agent presents, never by a
    // clock. The next two tests pin both directions of the lockout that
    // timer-based resolution caused.

    it('an agent offline through the whole grace period keeps working on its OLD key', async () => {
      // Rotation armed 6 minutes ago; the agent was asleep and never received
      // the pending key via heartbeat.
      const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      testDb.prepare(`
        UPDATE agents SET pending_api_key_hash = ?, pending_api_key_encrypted = 'encrypted_data', key_rotation_initiated_at = ? WHERE id = ?
      `).run(pendingKeyHash, expiredTime, 'agent-001');

      // It comes back holding the only key it ever had.
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': new Date().toISOString(),
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      // Previously this 401'd forever: the undelivered key had been promoted on
      // expiry, so the agent's own key no longer matched anything.
      await waitForResponse(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(res.status).not.toHaveBeenCalledWith(401);

      // The rotation is abandoned and the original key remains primary.
      const row = testDb.prepare('SELECT api_key_hash, pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?').get('agent-001') as any;
      expect(row.pending_api_key_hash).toBeNull();
      expect(row.key_rotation_initiated_at).toBeNull();
      expect(await bcrypt.compare(apiKeyPlain, row.api_key_hash)).toBe(true);
    });

    it('an agent that DID adopt the new key still authenticates after the grace period', async () => {
      // Rotation armed 6 minutes ago; this agent picked the key up via
      // heartbeat inside the window, then went offline.
      const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      testDb.prepare(`
        UPDATE agents SET pending_api_key_hash = ?, pending_api_key_encrypted = 'encrypted_data', key_rotation_initiated_at = ? WHERE id = ?
      `).run(pendingKeyHash, expiredTime, 'agent-001');

      const req = mockReq({
        authorization: `Bearer ${pendingKeyPlain}`,
        'x-agent-id': 'agent-001',
        'x-request-timestamp': new Date().toISOString(),
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      // Cancelling on expiry — the naive fix for the case above — would have
      // discarded this key and locked this agent out instead.
      await waitForResponse(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(res.status).not.toHaveBeenCalledWith(401);

      // Proven possession promotes it.
      const row = testDb.prepare('SELECT api_key_hash, pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?').get('agent-001') as any;
      expect(row.pending_api_key_hash).toBeNull();
      expect(row.key_rotation_initiated_at).toBeNull();
      expect(await bcrypt.compare(pendingKeyPlain, row.api_key_hash)).toBe(true);
    });

    it('rejects wrong key even when pending key exists', async () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      testDb.prepare(`
        UPDATE agents SET pending_api_key_hash = ?, key_rotation_initiated_at = ? WHERE id = ?
      `).run(pendingKeyHash, recentTime, 'agent-001');

      const req = mockReq({
        authorization: 'Bearer ak_totallywrongkey',
        'x-agent-id': 'agent-001',
      });
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await waitForResponse(() => {
        expect(res.status).toHaveBeenCalledWith(401);
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('requireAgentAuth persisted key digest', () => {
  const AGENT_ID = 'agent-digest-001';
  const KEY_A = 'ak_' + 'a'.repeat(64);
  const KEY_B = 'ak_' + 'b'.repeat(64);
  let keyAHash: string;
  let compareSpy: ReturnType<typeof vi.spyOn>;

  /** Run the middleware once and resolve with 'next' or the HTTP status. */
  function authOnce(token: string, agentId = AGENT_ID, timestamp = new Date().toISOString()): Promise<'next' | number> {
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
        'x-agent-id': agentId,
        'x-request-timestamp': timestamp,
      },
    } as unknown as Request;
    return new Promise((resolve) => {
      const res = {
        status: (code: number) => {
          resolve(code);
          return res;
        },
        json: () => res,
      } as unknown as Response;
      requireAgentAuth(req, res, (() => resolve('next')) as NextFunction);
    });
  }

  beforeEach(async () => {
    testDb = createTestDatabase();
    _clearAgentKeyDigestMemory();
    keyAHash = await bcrypt.hash(KEY_A, 4);
    insertTestAgent(testDb, { id: AGENT_ID, api_key_hash: keyAHash, status: 'active' });
    compareSpy = vi.spyOn(bcrypt, 'compare');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips bcrypt after the first success, even across a restart', async () => {
    expect(await authOnce(KEY_A)).toBe('next');
    expect(compareSpy).toHaveBeenCalledTimes(1);

    _clearAgentKeyDigestMemory(); // simulated backend restart: DB rows survive

    expect(await authOnce(KEY_A)).toBe('next');
    expect(await authOnce(KEY_A)).toBe('next');
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('does not trust a digest bound to an older key', async () => {
    recordAgentKeyDigest(AGENT_ID, keyAHash, KEY_A);
    testDb
      .prepare('UPDATE agents SET api_key_hash = ? WHERE id = ?')
      .run(await bcrypt.hash(KEY_B, 4), AGENT_ID);

    expect(await authOnce(KEY_A)).toBe(401);
    expect(compareSpy).toHaveBeenCalled();
  });

  it('never uses the digest while a rotation is pending', async () => {
    recordAgentKeyDigest(AGENT_ID, keyAHash, KEY_A);
    const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
    testDb
      .prepare('UPDATE agents SET pending_api_key_hash = ?, key_rotation_initiated_at = ? WHERE id = ?')
      .run(await bcrypt.hash(KEY_B, 4), recentTime, AGENT_ID);

    expect(await authOnce(KEY_A)).toBe('next');
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('records the digest on pending-key promotion', async () => {
    const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
    testDb
      .prepare('UPDATE agents SET pending_api_key_hash = ?, key_rotation_initiated_at = ? WHERE id = ?')
      .run(await bcrypt.hash(KEY_B, 4), recentTime, AGENT_ID);

    // Current key fails, pending key matches and is promoted.
    expect(await authOnce(KEY_B)).toBe('next');
    expect(compareSpy).toHaveBeenCalledTimes(2);
    const row = testDb.prepare('SELECT pending_api_key_hash FROM agents WHERE id = ?').get(AGENT_ID) as {
      pending_api_key_hash: string | null;
    };
    expect(row.pending_api_key_hash).toBeNull();

    expect(await authOnce(KEY_B)).toBe('next');
    expect(compareSpy).toHaveBeenCalledTimes(2);
  });

  it('concurrent requests share one bcrypt compare', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => authOnce(KEY_A)));
    expect(results).toEqual(['next', 'next', 'next', 'next', 'next']);
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('newly enrolled agent authenticates without bcrypt', async () => {
    const enrollment = await vi.importActual<typeof import('../../services/agent/enrollment.service.js')>(
      '../../services/agent/enrollment.service.js',
    );
    const token = await enrollment.createToken('org-001', 'user-001', 24, 1);
    const enrolled = await enrollment.enrollAgent({
      token: token.token,
      hostname: 'fresh-host',
      os: 'linux',
      arch: 'amd64',
      agent_version: '1.0.0',
    });
    compareSpy.mockClear(); // enrollment itself bcrypt-checks the enrollment token

    expect(await authOnce(enrolled.agent_key, enrolled.agent_id)).toBe('next');
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('rejects decommissioned agents on the digest path', async () => {
    recordAgentKeyDigest(AGENT_ID, keyAHash, KEY_A);
    testDb.prepare(`UPDATE agents SET status = 'decommissioned' WHERE id = ?`).run(AGENT_ID);

    expect(await authOnce(KEY_A)).toBe(401);
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('still enforces the request timestamp on the digest path', async () => {
    recordAgentKeyDigest(AGENT_ID, keyAHash, KEY_A);
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();

    expect(await authOnce(KEY_A, AGENT_ID, stale)).toBe(401);
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('a wrong token never rides a recorded digest', async () => {
    recordAgentKeyDigest(AGENT_ID, keyAHash, KEY_A);

    expect(await authOnce(KEY_B)).toBe(401);
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('an unknown agent still pays a bcrypt compare', async () => {
    expect(await authOnce(KEY_A, 'no-such-agent')).toBe(401);
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });
});
