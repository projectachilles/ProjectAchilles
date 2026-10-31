import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCachedAgent,
  setCachedAgent,
  invalidateAgentCache,
  isTokenVerifiedRecently,
  setVerifiedToken,
  hashTokenForCache,
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
});

describe('agentAuthCache verdict (bcrypt-skip) cache', () => {
  const TOKEN_HASH = 'a'.repeat(64);
  const OTHER_TOKEN_HASH = 'b'.repeat(64);
  const KEY_HASH = '$2a$12$dummyhashvalueforsmoke';

  beforeEach(() => {
    invalidateAgentCache('agent-001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isTokenVerifiedRecently returns false before any verdict is recorded', () => {
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, makeRow())).toBe(false);
  });

  it('a recorded verdict is honoured for the same token and key hash', () => {
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, makeRow())).toBe(true);
  });

  it('a verdict never vouches for a DIFFERENT token', () => {
    // Wrong-token requests must always fall through to the bcrypt path.
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);
    expect(isTokenVerifiedRecently('agent-001', OTHER_TOKEN_HASH, makeRow())).toBe(false);
  });

  it('outlives the 30 s row cache, so agents polling every 30 s skip bcrypt', () => {
    // The agent default poll interval equals the row-cache TTL (30 s), so a
    // verdict tied to the row expired just before nearly every poll and each
    // one paid a cost-12 bcryptjs compare (~0.5-0.7 s on half a CPU).
    vi.useFakeTimers();
    setCachedAgent('agent-001', makeRow());
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);

    vi.advanceTimersByTime(31_000);
    expect(getCachedAgent('agent-001')).toBeNull(); // row re-read from the DB
    setCachedAgent('agent-001', makeRow()); // ...and re-cached
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, makeRow())).toBe(true);
  });

  it('expires after an hour', () => {
    vi.useFakeTimers();
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);
    vi.advanceTimersByTime(59 * 60_000);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, makeRow())).toBe(true);
    vi.advanceTimersByTime(2 * 60_000);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, makeRow())).toBe(false);
  });

  it('is void once the agent row carries a different api_key_hash (rotated key)', () => {
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);
    const rotated = makeRow({ api_key_hash: '$2a$12$newhashpostrotation' });
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, rotated)).toBe(false);
  });

  it('is not used while a key rotation is pending (rotation is resolved on the bcrypt path)', () => {
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);
    const rotating = makeRow({
      pending_api_key_hash: '$2a$12$pendinghash',
      key_rotation_initiated_at: '2026-10-31 12:00:00',
    });
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, rotating)).toBe(false);
  });

  it('invalidateAgentCache also drops the verdict', () => {
    setVerifiedToken('agent-001', TOKEN_HASH, KEY_HASH);
    invalidateAgentCache('agent-001');
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH, makeRow())).toBe(false);
  });
});

describe('hashTokenForCache', () => {
  it('produces a 64-hex-char HMAC-SHA256 digest', () => {
    const h = hashTokenForCache('ak_some_token');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input within a process', () => {
    // Cache lookups depend on the same token deriving the same key.
    expect(hashTokenForCache('ak_a')).toBe(hashTokenForCache('ak_a'));
  });

  it('produces different outputs for different tokens', () => {
    expect(hashTokenForCache('ak_a')).not.toBe(hashTokenForCache('ak_b'));
  });
});
