import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';
import type Database from 'better-sqlite3';

let testDb: Database.Database;
vi.mock('../../agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

beforeEach(() => {
  testDb = createTestDatabase();
});

describe('apiKeys.service', () => {
  it('generateApiKey returns a pa_-prefixed key, stores only the hash, and returns metadata', async () => {
    const { generateApiKey } = await import('../apiKeys.service.js');
    const created = generateApiKey({
      name: 'test key', scope: 'read', createdBy: 'user_1', orgId: 'org_1',
    });
    expect(created.key).toMatch(/^pa_[a-f0-9]{64}$/);
    expect(created.key_prefix).toBe(created.key.slice(0, 12));
    expect(created.scope).toBe('read');
    const row = testDb.prepare('SELECT * FROM api_keys WHERE id = ?').get(created.id) as any;
    expect(row.token_hash).not.toContain(created.key);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validateApiKey returns the row for a valid key', async () => {
    const { generateApiKey, validateApiKey } = await import('../apiKeys.service.js');
    const created = generateApiKey({ name: 'k', scope: 'read', createdBy: 'u', orgId: null });
    expect(validateApiKey(created.key)?.id).toBe(created.id);
  });

  it('validateApiKey rejects unknown / malformed / revoked / expired keys', async () => {
    const { generateApiKey, validateApiKey, revokeApiKey } = await import('../apiKeys.service.js');
    expect(validateApiKey('pa_unknown')).toBeNull();
    expect(validateApiKey('not_a_key')).toBeNull();

    const revoked = generateApiKey({ name: 'r', scope: 'read', createdBy: 'u', orgId: null });
    revokeApiKey(revoked.id);
    expect(validateApiKey(revoked.key)).toBeNull();

    const expired = generateApiKey({
      name: 'e', scope: 'read', createdBy: 'u', orgId: null,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(validateApiKey(expired.key)).toBeNull();
  });

  it('listApiKeys returns metadata only (no token_hash)', async () => {
    const { generateApiKey, listApiKeys } = await import('../apiKeys.service.js');
    generateApiKey({ name: 'a', scope: 'read', createdBy: 'u', orgId: null });
    const list = listApiKeys();
    expect(list.length).toBe(1);
    expect((list[0] as any).token_hash).toBeUndefined();
    expect(list[0].name).toBe('a');
  });

  it('touchLastUsed throttles writes to once per 60s per key', async () => {
    const { generateApiKey, touchLastUsed } = await import('../apiKeys.service.js');
    const k = generateApiKey({ name: 'k', scope: 'read', createdBy: 'u', orgId: null });
    touchLastUsed(k.id);
    const first = testDb.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(k.id) as any;
    expect(first.last_used_at).not.toBeNull();
    testDb.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run('2000-01-01 00:00:00', k.id);
    touchLastUsed(k.id);
    const second = testDb.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(k.id) as any;
    expect(second.last_used_at).toBe('2000-01-01 00:00:00');
  });
});
