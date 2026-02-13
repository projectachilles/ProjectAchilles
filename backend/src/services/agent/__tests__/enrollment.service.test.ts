import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';

// Mock the database module to use our in-memory DB
let testDb: Database.Database;

vi.mock('../database.js', () => ({
  getDatabase: () => testDb,
}));

// Import AFTER mock setup
const { createToken, enrollAgent, listTokens, revokeToken, rotateAgentKey } = await import('../enrollment.service.js');

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

    it('updates hash in DB so old key no longer validates', async () => {
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

      const newHash = (testDb.prepare('SELECT api_key_hash FROM agents WHERE id = ?').get(enrolled.agent_id) as any).api_key_hash;
      expect(newHash).not.toBe(oldHash);
    });

    it('sets api_key_rotated_at timestamp', async () => {
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
      expect(agent.api_key_rotated_at).toBeDefined();
      expect(agent.api_key_rotated_at).not.toBeNull();
    });

    it('throws 404 for nonexistent agent', async () => {
      await expect(rotateAgentKey('nonexistent')).rejects.toThrow('Agent not found');
    });

    it('new key authenticates, old key does not', async () => {
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

      const row = testDb.prepare('SELECT api_key_hash FROM agents WHERE id = ?').get(enrolled.agent_id) as any;
      expect(await bcrypt.compare(newKey, row.api_key_hash)).toBe(true);
      expect(await bcrypt.compare(oldKey, row.api_key_hash)).toBe(false);
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
