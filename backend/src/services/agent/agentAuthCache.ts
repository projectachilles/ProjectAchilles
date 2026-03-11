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
  return entry.row;
}

export function setCachedAgent(agentId: string, row: CachedAgentRow): void {
  cache.set(agentId, { row, cachedAt: Date.now() });
}

export function invalidateAgentCache(agentId: string): void {
  cache.delete(agentId);
}
