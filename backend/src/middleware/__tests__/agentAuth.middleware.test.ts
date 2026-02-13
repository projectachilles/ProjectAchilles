import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../services/agent/database.js', () => ({
  getDatabase: () => testDb,
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
    testDb = createTestDatabase();
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
    await vi.waitFor(() => {
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
});
