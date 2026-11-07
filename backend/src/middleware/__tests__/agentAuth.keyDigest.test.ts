import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../__tests__/helpers/db.js';

// Unlike agentAuth.middleware.test.ts, this file runs the REAL row cache and
// key-digest store: it checks how often agents pay for a bcrypt compare
// across polls and restarts.
let testDb: Database.Database;

vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { requireAgentAuth } = await import('../agentAuth.middleware.js');
const { invalidateAgentCache } = await import('../../services/agent/agentAuthCache.js');
const { _clearAgentKeyDigestMemory } = await import('../../services/agent/agentKeyDigest.js');

const AGENT_ID = 'agent-digest-poll-001';
const TOKEN = 'ak_keydigesttoken123';

/** Run the middleware once and resolve with 'next' or the HTTP status. */
function poll(now: number, token = TOKEN): Promise<'next' | number> {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const req = {
    headers: {
      authorization: `Bearer ${token}`,
      'x-agent-id': AGENT_ID,
      'x-request-timestamp': new Date(now).toISOString(),
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

describe('agent auth key digest across polls (real cache + digest store)', () => {
  const T0 = Date.parse('2026-10-31T17:00:00Z');
  let compareSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    testDb = createTestDatabase();
    invalidateAgentCache(AGENT_ID);
    _clearAgentKeyDigestMemory();
    insertTestAgent(testDb, { id: AGENT_ID, api_key_hash: await bcrypt.hash(TOKEN, 4), status: 'active' });
    compareSpy = vi.spyOn(bcrypt, 'compare');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs bcrypt once for an agent polling every 30 s', async () => {
    for (let i = 0; i < 6; i++) {
      expect(await poll(T0 + i * 31_000)).toBe('next');
    }
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('runs bcrypt once across a backend restart', async () => {
    expect(await poll(T0)).toBe('next');
    // Restart: both in-memory caches are gone, agent_key_digests survives.
    invalidateAgentCache(AGENT_ID);
    _clearAgentKeyDigestMemory();
    expect(await poll(T0 + 31_000)).toBe('next');
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects the old token once the key is replaced in the database', async () => {
    expect(await poll(T0)).toBe('next');
    testDb
      .prepare('UPDATE agents SET api_key_hash = ? WHERE id = ?')
      .run(await bcrypt.hash('ak_brandnewkey', 4), AGENT_ID);

    // Within the 30 s row cache the old row may still be used; once the row
    // is re-read, the recorded digest no longer matches its hash.
    expect(await poll(T0 + 31_000)).toBe(401);
  });

  it('rejects a deactivated agent on the fast path', async () => {
    expect(await poll(T0)).toBe('next');
    testDb.prepare(`UPDATE agents SET status = 'disabled' WHERE id = ?`).run(AGENT_ID);

    expect(await poll(T0 + 31_000)).toBe(401);
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('never lets a wrong token ride the digest', async () => {
    expect(await poll(T0)).toBe('next');
    expect(await poll(T0 + 1_000, 'ak_wrongtoken')).toBe(401);
    expect(compareSpy).toHaveBeenCalledTimes(2);
  });
});
