import crypto from 'crypto';
import { getDatabase } from './database.js';

/**
 * Persisted proof that an agent's bearer key passed bcrypt.
 *
 * Agent keys are checked with bcrypt cost 12 (bcryptjs, pure JS on the main
 * thread, a few hundred ms each). With only an in-memory shortcut, every
 * backend restart made the whole fleet re-run bcrypt at once, which stalled
 * the event loop long enough for agents to be marked offline. This module
 * stores, per agent, an HMAC-SHA256 digest of the key (keyed by the bcrypt
 * hash `agents.api_key_hash` it was proven against) together with that hash,
 * in `agent_key_digests`.
 *
 * A digest is only ever trusted for the exact `api_key_hash` it was recorded
 * against (checked explicitly, and bound cryptographically by the HMAC key),
 * so any key change (promotion, re-enrollment, a manual SQL update)
 * voids it without an explicit invalidation step. `agents.api_key_hash` itself
 * is never touched here, so rolling back to a build without this table is safe:
 * the old code ignores it and falls back to bcrypt.
 */

const MAX_MEMORY_ENTRIES = 10_000;

interface DigestEntry {
  /** The agents.api_key_hash the key was proven against. */
  apiKeyHash: string;
  /** digestAgentKey(key, apiKeyHash). */
  keyDigest: string;
}

// Write-through copy of agent_key_digests, so a poll costs no DB read.
const memory = new Map<string, DigestEntry>();

function remember(agentId: string, entry: DigestEntry): void {
  memory.delete(agentId);
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memory.keys().next().value;
    if (oldestKey !== undefined) memory.delete(oldestKey);
  }
  memory.set(agentId, entry);
}

/**
 * Hex HMAC-SHA256 of the full bearer token (`ak_…`), keyed by the bcrypt hash
 * (`agents.api_key_hash`) the token is checked against.
 *
 * A fast keyed hash is sufficient here, unlike for passwords: agent keys are
 * 256-bit random values (crypto.randomBytes(32)), so the keyspace makes brute
 * force infeasible regardless of hash speed. Keying the HMAC by the bcrypt
 * hash is stable across restarts (no extra secret to manage) and binds the
 * digest to that hash: the same token yields a different digest under any
 * other hash. bcrypt remains the authority for every key without a digest;
 * this only lets a key already proven against that hash skip the repeat
 * compare.
 */
export function digestAgentKey(token: string, apiKeyHash: string): string {
  return crypto.createHmac('sha256', apiKeyHash).update(token).digest('hex');
}

/**
 * Record that `token` passed bcrypt against `apiKeyHash` for `agentId`.
 * Replaces any earlier digest for the agent (one row per agent).
 */
export function recordAgentKeyDigest(agentId: string, apiKeyHash: string, token: string): void {
  const keyDigest = digestAgentKey(token, apiKeyHash);
  getDatabase().prepare(`
    INSERT INTO agent_key_digests (agent_id, api_key_hash, key_digest, verified_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      api_key_hash = excluded.api_key_hash,
      key_digest = excluded.key_digest,
      verified_at = excluded.verified_at
  `).run(agentId, apiKeyHash, keyDigest, new Date().toISOString());
  remember(agentId, { apiKeyHash, keyDigest });
}

/**
 * True when `token` was proven for `agentId` against exactly `apiKeyHash`
 * (the hash the agent row carries now). Memory first, the DB on a miss, so a
 * restart costs one indexed read per agent instead of a bcrypt compare.
 *
 * Callers must not use this while a key rotation is pending: rotation is
 * resolved on the bcrypt path.
 */
export function agentKeyDigestMatches(agentId: string, apiKeyHash: string, token: string): boolean {
  let entry = memory.get(agentId);
  if (!entry) {
    const row = getDatabase()
      .prepare('SELECT api_key_hash, key_digest FROM agent_key_digests WHERE agent_id = ?')
      .get(agentId) as { api_key_hash: string; key_digest: string } | undefined;
    if (!row) return false;
    entry = { apiKeyHash: row.api_key_hash, keyDigest: row.key_digest };
    remember(agentId, entry);
  }
  if (entry.apiKeyHash !== apiKeyHash) return false;

  const stored = Buffer.from(entry.keyDigest, 'hex');
  const presented = Buffer.from(digestAgentKey(token, apiKeyHash), 'hex');
  return stored.length === presented.length && crypto.timingSafeEqual(stored, presented);
}

/** Tests only: drop the in-memory copy (simulates a restart; DB rows survive). */
export function _clearAgentKeyDigestMemory(): void {
  memory.clear();
}
