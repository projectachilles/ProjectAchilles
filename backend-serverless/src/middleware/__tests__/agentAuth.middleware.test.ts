import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { DbHelper } from '../../services/agent/database.js';
import { createTestDatabase, insertTestAgent } from '../../__tests__/helpers/db.js';

let testDb: DbHelper;

vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDb: async () => testDb };
});

// Mock the enrollment service exports used by the auth middleware.
// promotePendingKey needs to operate on the real test database.
vi.mock('../../services/agent/enrollment.service.js', () => ({
  ROTATION_GRACE_PERIOD_SECONDS: 300,
  promotePendingKey: async (agentId: string) => {
    const now = new Date().toISOString();
    await testDb.run(`
      UPDATE agents
      SET api_key_hash = pending_api_key_hash,
          pending_api_key_hash = NULL,
          pending_api_key_encrypted = NULL,
          key_rotation_initiated_at = NULL,
          api_key_rotated_at = ?,
          updated_at = ?
      WHERE id = ?
    `, [now, now, agentId]);
  },
}));

const { requireAgentAuth } = await import('../agentAuth.middleware.js');

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
    testDb = await createTestDatabase();
    apiKeyPlain = 'ak_testapikey123456';
    apiKeyHash = await bcrypt.hash(apiKeyPlain, 10);
    await insertTestAgent(testDb, { id: 'agent-001', api_key_hash: apiKeyHash, status: 'active' });
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
    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  it('returns 401 when agent is disabled (uniform error)', async () => {
    await insertTestAgent(testDb, {
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
    await vi.waitFor(() => {
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
    }) as any;
    const res = mockRes();
    const next = vi.fn();

    requireAgentAuth(req, res, next);

    // bcrypt.compare is async, wait for it
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    expect(req.agent).toBeDefined();
    expect(req.agent.id).toBe('agent-001');
    expect(req.agent.org_id).toBe('org-001');
  });

  describe('timestamp validation', () => {
    it('allows request with missing timestamp (backwards compat)', async () => {
      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
      }) as any;
      const res = mockRes();
      const next = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      requireAgentAuth(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('without X-Request-Timestamp'));
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

      await vi.waitFor(() => {
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

      await vi.waitFor(() => {
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

      await vi.waitFor(() => {
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

      await vi.waitFor(() => {
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

    await vi.waitFor(() => {
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
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(req.agent.id).toBe('agent-001');
    });

    it('authenticates with current key during grace period', async () => {
      // Set pending key (within grace period)
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await testDb.run(`
        UPDATE agents SET pending_api_key_hash = ?, key_rotation_initiated_at = ? WHERE id = ?
      `, [pendingKeyHash, recentTime, 'agent-001']);

      const req = mockReq({
        authorization: `Bearer ${apiKeyPlain}`,
        'x-agent-id': 'agent-001',
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalled();
      });
      expect(req.agent.id).toBe('agent-001');
    });

    it('authenticates with pending key and promotes it', async () => {
      // Set pending key (within grace period)
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await testDb.run(`
        UPDATE agents SET pending_api_key_hash = ?, pending_api_key_encrypted = 'encrypted_data', key_rotation_initiated_at = ? WHERE id = ?
      `, [pendingKeyHash, recentTime, 'agent-001']);

      const req = mockReq({
        authorization: `Bearer ${pendingKeyPlain}`,
        'x-agent-id': 'agent-001',
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalled();
      });

      // Pending key should have been promoted
      const row = await testDb.get('SELECT api_key_hash, pending_api_key_hash FROM agents WHERE id = ?', ['agent-001']) as unknown as any;
      expect(row.pending_api_key_hash).toBeNull();
      // New api_key_hash should match the pending key
      expect(await bcrypt.compare(pendingKeyPlain, row.api_key_hash)).toBe(true);
    });

    it('promotes pending key when grace period expires then authenticates with promoted key', async () => {
      // Set pending key with expired grace period (6 min ago)
      const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      await testDb.run(`
        UPDATE agents SET pending_api_key_hash = ?, pending_api_key_encrypted = 'encrypted_data', key_rotation_initiated_at = ? WHERE id = ?
      `, [pendingKeyHash, expiredTime, 'agent-001']);

      // Try to auth with the pending (now promoted) key
      const req = mockReq({
        authorization: `Bearer ${pendingKeyPlain}`,
        'x-agent-id': 'agent-001',
      }) as any;
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await vi.waitFor(() => {
        expect(next).toHaveBeenCalled();
      });

      // Pending columns should be cleared after promotion
      const row = await testDb.get('SELECT pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?', ['agent-001']) as unknown as any;
      expect(row.pending_api_key_hash).toBeNull();
      expect(row.key_rotation_initiated_at).toBeNull();
    });

    it('rejects wrong key even when pending key exists', async () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await testDb.run(`
        UPDATE agents SET pending_api_key_hash = ?, key_rotation_initiated_at = ? WHERE id = ?
      `, [pendingKeyHash, recentTime, 'agent-001']);

      const req = mockReq({
        authorization: 'Bearer ak_totallywrongkey',
        'x-agent-id': 'agent-001',
      });
      const res = mockRes();
      const next = vi.fn();

      requireAgentAuth(req, res, next);

      await vi.waitFor(() => {
        expect(res.status).toHaveBeenCalledWith(401);
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
