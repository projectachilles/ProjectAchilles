import crypto from 'crypto';
import type { AgentStatus, AgentOS, AgentArch } from '../../types/agent.js';

// Process-local secret used to derive cache keys from agent bearer tokens.
// Generated fresh per process — cache keys are ephemeral (in-memory) and
// never cross process boundaries, so the secret doesn't need to be stable
// or shared. HMAC (not raw SHA-256) is used here so static analysis
// correctly identifies this as key derivation, not password storage.
const TOKEN_KEY_SECRET = crypto.randomBytes(32);

/**
 * Derive a cache key from an agent bearer token. The output is a
 * deterministic-per-process value safe to use as a Map key — it ties the
 * verdict to the exact token (so a wrong token can't ride a previous
 * valid request's verdict) without persisting the plaintext token in
 * the cache.
 */
export function hashTokenForCache(token: string): string {
  return crypto.createHmac('sha256', TOKEN_KEY_SECRET).update(token).digest('hex');
}

export interface CachedAgentRow {
  id: string;
  org_id: string;
  hostname: string;
  os: AgentOS;
  arch: AgentArch;
  status: AgentStatus;
  api_key_hash: string;
  pending_api_key_hash: string | null;
  key_rotation_initiated_at: string | null;
}

/**
 * Row cache TTL. Bounds how long a status change or a new key rotation made
 * outside the invalidation hooks takes to reach the auth path.
 */
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 10_000;

/**
 * How long a bcrypt verdict is reused. It is bound to the exact token and the
 * api_key_hash it was checked against (see isTokenVerifiedRecently), so it
 * cannot outlive a key change; the TTL only bounds memory and staleness.
 * Agents poll every 30 s, which is why this must not be tied to the row TTL:
 * a 30 s verdict expired just before nearly every poll, so each one ran a
 * cost-12 bcryptjs compare (~0.5-0.7 s of main-thread CPU on half a core).
 */
const VERDICT_TTL_MS = 60 * 60_000;

interface CacheEntry {
  row: CachedAgentRow;
  cachedAt: number;
}

interface Verdict {
  /** hashTokenForCache() of a bearer token that passed bcrypt. */
  tokenHash: string;
  /** The api_key_hash the token was verified against. */
  apiKeyHash: string;
  verifiedAt: number;
}

const cache = new Map<string, CacheEntry>();
const verdicts = new Map<string, Verdict>();

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  if (map.size >= MAX_CACHE_SIZE) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

export function getCachedAgent(agentId: string): CachedAgentRow | null {
  const entry = cache.get(agentId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(agentId);
    return null;
  }
  // Move to end for LRU ordering (Map preserves insertion order)
  cache.delete(agentId);
  cache.set(agentId, entry);
  return entry.row;
}

export function setCachedAgent(agentId: string, row: CachedAgentRow): void {
  setBounded(cache, agentId, { row, cachedAt: Date.now() });
}

/**
 * Record that `tokenHash` (hashTokenForCache of an agent bearer token) passed
 * bcrypt against `apiKeyHash` for `agentId`.
 */
export function setVerifiedToken(agentId: string, tokenHash: string, apiKeyHash: string): void {
  setBounded(verdicts, agentId, { tokenHash, apiKeyHash, verifiedAt: Date.now() });
}

/**
 * True when `tokenHash` passed bcrypt for `agentId` within VERDICT_TTL_MS
 * against the api_key_hash `row` carries now, and no key rotation is pending.
 *
 * - Exact token match: a wrong token can never ride a previous verdict.
 * - Same api_key_hash: a rotated, cancelled or replaced key voids the verdict
 *   as soon as the row (re-read at least every 30 s) shows the new hash.
 * - No pending key: rotation is resolved on the bcrypt path (promote when the
 *   agent presents the new key, cancel once the delivery window has passed),
 *   so a rotating agent always takes it.
 * Status (inactive, decommissioned) is checked after this, on the row.
 */
export function isTokenVerifiedRecently(
  agentId: string,
  tokenHash: string,
  row: CachedAgentRow,
): boolean {
  if (row.pending_api_key_hash) return false;
  const verdict = verdicts.get(agentId);
  if (!verdict) return false;
  if (Date.now() - verdict.verifiedAt > VERDICT_TTL_MS) {
    verdicts.delete(agentId);
    return false;
  }
  return verdict.tokenHash === tokenHash && verdict.apiKeyHash === row.api_key_hash;
}

export function invalidateAgentCache(agentId: string): void {
  cache.delete(agentId);
  verdicts.delete(agentId);
}
