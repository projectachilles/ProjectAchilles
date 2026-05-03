import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

// Mock the database module to use our in-memory DB
let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Mock signing service — use real ensureSigningKeyPair (creates key on disk)
// so that pending key encryption works, but override getPublicKeyBase64 for
// deterministic enrollment response.
vi.mock('../signing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../signing.service.js')>();
  return {
    ...actual,
    getPublicKeyBase64: () => 'dGVzdC1wdWJsaWMta2V5LTMyLWJ5dGVzIQ==',
  };
});

// Import AFTER mock setup
const {
  createToken,
  enrollAgent,
  listTokens,
  revokeToken,
  rotateAgentKey,
  encryptPendingKey,
  decryptPendingKey,
  promotePendingKey,
} = await import('../enrollment.service.js');

describe('enrollment.service', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe('createToken', () => {
    it('creates a token and returns plaintext + metadata', async () => {
      const result = await createToken('org-001', 'user-001', 24, 5, { env: 'test' });

      expect(result.token).toMatch(/^acht_/);
      expect(result.id).toBeDefined();
      expect(result.expires_at).toBeDefined();
      expect(result.max_uses).toBe(5);
    });

    it('stores hashed token in database', async () => {
      const result = await createToken('org-001', 'user-001');

      const row = testDb.prepare('SELECT * FROM enrollment_tokens WHERE id = ?').get(result.id) as any;
      expect(row).toBeDefined();
      expect(row.token_hash).not.toBe(result.token); // Should be bcrypt hash
      expect(row.token_hash).toMatch(/^\$2[ab]\$/);
      expect(row.org_id).toBe('org-001');
      expect(row.created_by).toBe('user-001');
    });

    it('uses default TTL and max_uses', async () => {
      const result = await createToken('org-001', 'user-001');

      expect(result.max_uses).toBe(1);
      // Expires ~24h from now
      const expiresAt = new Date(result.expires_at);
      const now = Date.now();
      const diffHours = (expiresAt.getTime() - now) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });
  });

  describe('enrollAgent', () => {
    it('enrolls agent with valid token', async () => {
      const token = await createToken('org-001', 'user-001', 24, 5);

      const result = await enrollAgent({
        token: token.token,
        hostname: 'test-host',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      expect(result.agent_id).toBeDefined();
      expect(result.agent_key).toMatch(/^ak_/);
      expect(result.org_id).toBe('org-001');
      expect(result.poll_interval).toBe(30);
      expect(result.update_public_key).toBeDefined();
    });

    it('increments token use_count after enrollment', async () => {
      const token = await createToken('org-001', 'user-001', 24, 5);

      await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      const row = testDb.prepare('SELECT use_count FROM enrollment_tokens WHERE id = ?').get(token.id) as any;
      expect(row.use_count).toBe(1);
    });

    it('creates agent record in database', async () => {
      const token = await createToken('org-001', 'user-001');

      const result = await enrollAgent({
        token: token.token,
        hostname: 'my-server',
        os: 'windows',
        arch: 'arm64',
        agent_version: '2.0.0',
      });

      const agent = testDb.prepare('SELECT * FROM agents WHERE id = ?').get(result.agent_id) as any;
      expect(agent.hostname).toBe('my-server');
      expect(agent.os).toBe('windows');
      expect(agent.arch).toBe('arm64');
      expect(agent.agent_version).toBe('2.0.0');
      expect(agent.status).toBe('active');
    });

    it('rejects invalid token', async () => {
      await expect(
        enrollAgent({
          token: 'acht_invalidtoken',
          hostname: 'host',
          os: 'linux',
          arch: 'amd64',
          agent_version: '1.0.0',
        })
      ).rejects.toThrow('Invalid or expired enrollment token');
    });

    it('runs bcrypt even when no tokens exist (timing oracle fix)', async () => {
      // When zero candidate tokens exist, bcrypt.compare should still run
      // against a dummy hash to prevent timing-based detection of valid tokens.
      const start = Date.now();

      await expect(
        enrollAgent({
          token: 'acht_nonexistenttoken',
          hostname: 'host',
          os: 'linux',
          arch: 'amd64',
          agent_version: '1.0.0',
        })
      ).rejects.toThrow('Invalid or expired enrollment token');

      const elapsed = Date.now() - start;
      // bcrypt round-12 takes >50ms even on fast hardware
      expect(elapsed).toBeGreaterThan(50);
    });

    it('rejects expired token', async () => {
      // Create token with 0 TTL (expired immediately)
      const token = await createToken('org-001', 'user-001', 0);

      await expect(
        enrollAgent({
          token: token.token,
          hostname: 'host',
          os: 'linux',
          arch: 'amd64',
          agent_version: '1.0.0',
        })
      ).rejects.toThrow('Invalid or expired enrollment token');
    });

    it('rejects token that has been fully used', async () => {
      const token = await createToken('org-001', 'user-001', 24, 1); // max 1 use

      await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      // Second use should fail
      await expect(
        enrollAgent({
          token: token.token,
          hostname: 'host-2',
          os: 'linux',
          arch: 'amd64',
          agent_version: '1.0.0',
        })
      ).rejects.toThrow('Invalid or expired enrollment token');
    });
  });

  describe('listTokens', () => {
    it('returns active tokens for an org', async () => {
      await createToken('org-001', 'user-001', 24, 5);
      await createToken('org-001', 'user-001', 24, 3);
      await createToken('org-002', 'user-002', 24, 1); // Different org

      const tokens = listTokens('org-001');

      expect(tokens).toHaveLength(2);
      expect(tokens[0].org_id).toBe('org-001');
      expect(tokens[0].token).toBe('***'); // Never returns plaintext
    });

    it('excludes expired tokens', async () => {
      await createToken('org-001', 'user-001', 0); // Expired

      const tokens = listTokens('org-001');
      expect(tokens).toHaveLength(0);
    });

    it('returns empty array for unknown org', () => {
      const tokens = listTokens('nonexistent');
      expect(tokens).toEqual([]);
    });
  });

  describe('rotateAgentKey', () => {
    it('generates a new key with ak_ prefix', async () => {
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      const result = await rotateAgentKey(enrolled.agent_id);

      expect(result.agent_key).toMatch(/^ak_/);
      expect(result.agent_id).toBe(enrolled.agent_id);
      expect(result.rotated_at).toBeDefined();
    });

    it('stores pending hash, not primary (grace period model)', async () => {
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      const oldHash = (testDb.prepare('SELECT api_key_hash FROM agents WHERE id = ?').get(enrolled.agent_id) as any).api_key_hash;

      await rotateAgentKey(enrolled.agent_id);

      const row = testDb.prepare('SELECT api_key_hash, pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?').get(enrolled.agent_id) as any;
      // Primary hash unchanged during grace period
      expect(row.api_key_hash).toBe(oldHash);
      // Pending hash is set
      expect(row.pending_api_key_hash).toBeDefined();
      expect(row.pending_api_key_hash).not.toBeNull();
      expect(row.key_rotation_initiated_at).toBeDefined();
    });

    it('stores encrypted pending key', async () => {
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      await rotateAgentKey(enrolled.agent_id);

      const row = testDb.prepare('SELECT pending_api_key_encrypted FROM agents WHERE id = ?').get(enrolled.agent_id) as any;
      expect(row.pending_api_key_encrypted).toBeDefined();
      expect(row.pending_api_key_encrypted).not.toBeNull();
      // Should be base64 (iv + authTag + ciphertext)
      expect(() => Buffer.from(row.pending_api_key_encrypted, 'base64')).not.toThrow();
    });

    it('does not set api_key_rotated_at until promotion', async () => {
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      await rotateAgentKey(enrolled.agent_id);

      const agent = testDb.prepare('SELECT api_key_rotated_at FROM agents WHERE id = ?').get(enrolled.agent_id) as any;
      // api_key_rotated_at is only set when pending key is promoted
      expect(agent.api_key_rotated_at).toBeNull();
    });

    it('throws 404 for nonexistent agent', async () => {
      await expect(rotateAgentKey('nonexistent')).rejects.toThrow('Agent not found');
    });

    it('new key validates against pending hash', async () => {
      const bcrypt = await import('bcryptjs');
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });
      const oldKey = enrolled.agent_key;

      const result = await rotateAgentKey(enrolled.agent_id);
      const newKey = result.agent_key;

      const row = testDb.prepare('SELECT api_key_hash, pending_api_key_hash FROM agents WHERE id = ?').get(enrolled.agent_id) as any;
      // New key matches pending hash
      expect(await bcrypt.compare(newKey, row.pending_api_key_hash)).toBe(true);
      // Old key still matches primary hash (grace period)
      expect(await bcrypt.compare(oldKey, row.api_key_hash)).toBe(true);
    });

    it('double rotation replaces previous pending key', async () => {
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      const result1 = await rotateAgentKey(enrolled.agent_id);
      const row1 = testDb.prepare('SELECT pending_api_key_hash FROM agents WHERE id = ?').get(enrolled.agent_id) as any;

      const result2 = await rotateAgentKey(enrolled.agent_id);
      const row2 = testDb.prepare('SELECT pending_api_key_hash FROM agents WHERE id = ?').get(enrolled.agent_id) as any;

      expect(result1.agent_key).not.toBe(result2.agent_key);
      expect(row1.pending_api_key_hash).not.toBe(row2.pending_api_key_hash);
    });

    it('promotePendingKey moves pending to primary', async () => {
      const bcrypt = await import('bcryptjs');
      const token = await createToken('org-001', 'user-001');
      const enrolled = await enrollAgent({
        token: token.token,
        hostname: 'host-1',
        os: 'linux',
        arch: 'amd64',
        agent_version: '1.0.0',
      });

      const result = await rotateAgentKey(enrolled.agent_id);

      promotePendingKey(enrolled.agent_id);

      const row = testDb.prepare('SELECT api_key_hash, pending_api_key_hash, pending_api_key_encrypted, key_rotation_initiated_at, api_key_rotated_at FROM agents WHERE id = ?').get(enrolled.agent_id) as any;
      expect(await bcrypt.compare(result.agent_key, row.api_key_hash)).toBe(true);
      expect(row.pending_api_key_hash).toBeNull();
      expect(row.pending_api_key_encrypted).toBeNull();
      expect(row.key_rotation_initiated_at).toBeNull();
      expect(row.api_key_rotated_at).not.toBeNull();
    });
  });

  describe('pendingKey encryption', () => {
    it('round-trips encrypt/decrypt', () => {
      const original = 'ak_test_key_12345';
      const encrypted = encryptPendingKey(original);
      const decrypted = decryptPendingKey(encrypted);
      expect(decrypted).toBe(original);
    });

    it('produces different ciphertext each time (unique IV)', () => {
      const key = 'ak_same_key';
      const enc1 = encryptPendingKey(key);
      const enc2 = encryptPendingKey(key);
      expect(enc1).not.toBe(enc2);
    });
  });

  describe('revokeToken', () => {
    it('deletes a token', async () => {
      const token = await createToken('org-001', 'user-001');

      revokeToken(token.id);

      const row = testDb.prepare('SELECT * FROM enrollment_tokens WHERE id = ?').get(token.id);
      expect(row).toBeUndefined();
    });

    it('throws for nonexistent token', () => {
      expect(() => revokeToken('nonexistent')).toThrow('Token not found');
    });
  });
});
