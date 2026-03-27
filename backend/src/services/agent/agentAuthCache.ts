import type { AgentStatus, AgentOS, AgentArch } from '../../types/agent.js';

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
  cache.set(agentId, { row, cachedAt: Date.now() });
}

export function invalidateAgentCache(agentId: string): void {
  cache.delete(agentId);
}
