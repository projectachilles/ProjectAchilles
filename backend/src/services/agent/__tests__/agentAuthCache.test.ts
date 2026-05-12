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

  beforeEach(() => {
    invalidateAgentCache('agent-001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isTokenVerifiedRecently returns false before any verdict is recorded', () => {
    setCachedAgent('agent-001', makeRow());
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(false);
  });

  it('setVerifiedToken makes isTokenVerifiedRecently return true for the same hash', () => {
    setCachedAgent('agent-001', makeRow());
    setVerifiedToken('agent-001', TOKEN_HASH);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(true);
  });

  it('isTokenVerifiedRecently returns false for a DIFFERENT token hash', () => {
    // A previously verified token cannot "vouch for" a different token —
    // wrong-token requests must always fall through to the bcrypt path.
    setCachedAgent('agent-001', makeRow());
    setVerifiedToken('agent-001', TOKEN_HASH);
    expect(isTokenVerifiedRecently('agent-001', OTHER_TOKEN_HASH)).toBe(false);
  });

  it('setVerifiedToken is a no-op when the row is not cached', () => {
    // Verdict has no meaning without an accompanying row.
    setVerifiedToken('agent-001', TOKEN_HASH);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(false);
  });

  it('verdict expires after CACHE_TTL_MS (30s)', () => {
    vi.useFakeTimers();
    setCachedAgent('agent-001', makeRow());
    setVerifiedToken('agent-001', TOKEN_HASH);

    vi.advanceTimersByTime(29_999);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(true);

    vi.advanceTimersByTime(2);
    // The row cache itself expires at 30s too; getCachedAgent inside
    // isTokenVerifiedRecently will drop the entry. Verdict goes with it.
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(false);
  });

  it('setCachedAgent (re-caching the row) drops any prior verdict', () => {
    // Rotation flow: when the row is replaced with one carrying a new
    // api_key_hash, the previously cached verdict must NOT survive — the
    // old token may no longer match the new hash.
    setCachedAgent('agent-001', makeRow());
    setVerifiedToken('agent-001', TOKEN_HASH);
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(true);

    setCachedAgent('agent-001', makeRow({ api_key_hash: '$2a$12$newhashpostrotation' }));
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(false);
  });

  it('invalidateAgentCache also drops the verdict', () => {
    setCachedAgent('agent-001', makeRow());
    setVerifiedToken('agent-001', TOKEN_HASH);
    invalidateAgentCache('agent-001');
    expect(isTokenVerifiedRecently('agent-001', TOKEN_HASH)).toBe(false);
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
