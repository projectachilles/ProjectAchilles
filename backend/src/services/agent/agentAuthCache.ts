import crypto from 'crypto';
import type { AgentStatus, AgentOS, AgentArch } from '../../types/agent.js';

// Process-local secret used to derive cache keys from agent bearer tokens.
// Generated fresh per process — cache keys are ephemeral (30s TTL) and
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

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 10_000;

interface CacheEntry {
  row: CachedAgentRow;
  cachedAt: number;
  /**
   * HMAC-SHA256 (via hashTokenForCache) of an agent bearer token that has
   * passed bcrypt verification for this agent. Lets the middleware skip the
   * expensive bcrypt.compare on repeat requests with the same token, while
   * still requiring an exact token match (so a wrong token cannot ride a
   * previous valid request's verdict). Cleared whenever the cached row is
   * replaced — the new row may have a different api_key_hash post-rotation,
   * invalidating the verdict.
   */
  verifiedTokenHash?: string;
  verifiedAt?: number;
}

const cache = new Map<string, CacheEntry>();

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
  // Evict oldest entries if cache exceeds max size
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  // Replacing the row drops any prior verdict: the new row may carry a
  // different api_key_hash (post-rotation), and we don't want a stale
  // verdict to authenticate a token that no longer matches.
  cache.set(agentId, { row, cachedAt: Date.now() });
}

/**
 * Record that `tokenHash` (sha256 of an agent bearer token) successfully
 * passed bcrypt for `agentId`. No-op if the row isn't cached — verdict only
 * has meaning alongside the row it was verified against.
 */
export function setVerifiedToken(agentId: string, tokenHash: string): void {
  const entry = cache.get(agentId);
  if (!entry) return;
  entry.verifiedTokenHash = tokenHash;
  entry.verifiedAt = Date.now();
}

/**
 * Returns true if `tokenHash` was verified for `agentId` within CACHE_TTL_MS.
 * The exact-match requirement means a wrong token cannot piggyback on a
 * previous valid request's verdict.
 */
export function isTokenVerifiedRecently(agentId: string, tokenHash: string): boolean {
  const entry = cache.get(agentId);
  if (!entry || !entry.verifiedTokenHash || entry.verifiedAt === undefined) return false;
  if (entry.verifiedTokenHash !== tokenHash) return false;
  if (Date.now() - entry.verifiedAt > CACHE_TTL_MS) return false;
  return true;
}

export function invalidateAgentCache(agentId: string): void {
  cache.delete(agentId);
}
