import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCachedAgent,
  setCachedAgent,
  invalidateAgentCache,
  type CachedAgentRow,
} from '../agentAuthCache.js';

function makeRow(overrides: Partial<CachedAgentRow> = {}): CachedAgentRow {
  return {
    id: 'agent-001',
    org_id: 'org-001',
    hostname: 'host-1',
    os: 'linux',
    arch: 'amd64',
    status: 'active',
    api_key_hash: '$2a$12$dummyhashvalueforsmoke',
    pending_api_key_hash: null,
    key_rotation_initiated_at: null,
    ...overrides,
  };
}

describe('agentAuthCache row cache', () => {
  beforeEach(() => {
    // Cache module retains state across tests; clear known entries.
    invalidateAgentCache('agent-001');
    invalidateAgentCache('agent-002');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when nothing cached', () => {
    expect(getCachedAgent('agent-001')).toBeNull();
  });

  it('stores and returns a cached row', () => {
    const row = makeRow();
    setCachedAgent('agent-001', row);
    expect(getCachedAgent('agent-001')).toEqual(row);
  });

  it('invalidateAgentCache clears the entry', () => {
    setCachedAgent('agent-001', makeRow());
    invalidateAgentCache('agent-001');
    expect(getCachedAgent('agent-001')).toBeNull();
  });

  it('expires a row after the 30 s TTL', () => {
    vi.useFakeTimers();
    setCachedAgent('agent-001', makeRow());
    vi.advanceTimersByTime(29_000);
    expect(getCachedAgent('agent-001')).not.toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(getCachedAgent('agent-001')).toBeNull();
  });
});
