import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', () => ({
  getDatabase: () => testDb,
}));

// Mock the enrollment service — getPendingRotationKey calls decrypt/promote
vi.mock('../enrollment.service.js', () => ({
  ROTATION_GRACE_PERIOD_SECONDS: 300,
  decryptPendingKey: (encrypted: string) => `decrypted_${encrypted}`,
  promotePendingKey: (agentId: string) => {
    const now = new Date().toISOString();
    testDb.prepare(`
      UPDATE agents
      SET api_key_hash = pending_api_key_hash,
          pending_api_key_hash = NULL,
          pending_api_key_encrypted = NULL,
          key_rotation_initiated_at = NULL,
          api_key_rotated_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, agentId);
  },
}));

const {
  processHeartbeat,
  isAgentOnline,
  getPendingRotationKey,
  getAgentMetrics,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  addTag,
  removeTag,
} = await import('../heartbeat.service.js');

describe('heartbeat.service', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe('isAgentOnline', () => {
    it('returns true for recent heartbeat', () => {
      expect(isAgentOnline(new Date().toISOString())).toBe(true);
    });

    it('returns false for old heartbeat', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(isAgentOnline(fiveMinAgo)).toBe(false);
    });

    it('returns false for null heartbeat', () => {
      expect(isAgentOnline(null)).toBe(false);
    });
  });

  describe('processHeartbeat', () => {
    it('updates agent heartbeat timestamp and data', () => {
      insertTestAgent(testDb);

      const payload = {
        timestamp: new Date().toISOString(),
        status: 'idle' as const,
        current_task: null,
        system: {
          hostname: 'test-host',
          os: 'linux' as const,
          arch: 'amd64' as const,
          uptime_seconds: 3600,
          cpu_percent: 25,
          memory_mb: 512,
          disk_free_mb: 10000,
        },
        agent_version: '1.1.0',
        last_task_completed: null,
      };

      processHeartbeat('agent-001', payload);

      const agent = testDb.prepare('SELECT * FROM agents WHERE id = ?').get('agent-001') as any;
      expect(agent.agent_version).toBe('1.1.0');
      expect(agent.last_heartbeat).toBeDefined();
      const data = JSON.parse(agent.last_heartbeat_data);
      expect(data.system.cpu_percent).toBe(25);
    });
  });

  describe('getAgentMetrics', () => {
    it('returns correct counts', () => {
      insertTestAgent(testDb, { id: 'a1', status: 'active', last_heartbeat: new Date().toISOString() });
      insertTestAgent(testDb, { id: 'a2', status: 'active', last_heartbeat: new Date(Date.now() - 300000).toISOString() }); // offline
      insertTestAgent(testDb, { id: 'a3', status: 'disabled' });

      const metrics = getAgentMetrics();

      expect(metrics.total).toBe(3); // all non-decommissioned
      expect(metrics.online).toBe(1); // only a1
      expect(metrics.offline).toBe(2);
    });

    it('filters by org_id', () => {
      insertTestAgent(testDb, { id: 'a1', org_id: 'org-1' });
      insertTestAgent(testDb, { id: 'a2', org_id: 'org-2' });

      const metrics = getAgentMetrics('org-1');
      expect(metrics.total).toBe(1);
    });

    it('counts pending tasks', () => {
      insertTestAgent(testDb, { id: 'a1' });

      // Insert a pending task directly
      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_by, ttl)
        VALUES ('t1', 'a1', 'org-001', 'execute_test', 'pending', '{}', 'user', 604800)
      `).run();

      const metrics = getAgentMetrics();
      expect(metrics.pending_tasks).toBe(1);
    });
  });

  describe('listAgents', () => {
    it('returns agents with summary info', () => {
      insertTestAgent(testDb, { id: 'a1', hostname: 'server-1' });
      insertTestAgent(testDb, { id: 'a2', hostname: 'server-2' });

      const result = listAgents({});

      expect(result.total).toBe(2);
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0]).toHaveProperty('runtime_status');
      expect(result.agents[0]).toHaveProperty('is_online');
    });

    it('filters by status', () => {
      insertTestAgent(testDb, { id: 'a1', status: 'active' });
      insertTestAgent(testDb, { id: 'a2', status: 'disabled' });

      const result = listAgents({ status: 'disabled' });
      expect(result.total).toBe(1);
      expect(result.agents[0].id).toBe('a2');
    });

    it('filters by OS', () => {
      insertTestAgent(testDb, { id: 'a1', os: 'linux' });
      insertTestAgent(testDb, { id: 'a2', os: 'windows' });

      const result = listAgents({ os: 'linux' });
      expect(result.total).toBe(1);
    });

    it('filters by hostname substring', () => {
      insertTestAgent(testDb, { id: 'a1', hostname: 'web-server-01' });
      insertTestAgent(testDb, { id: 'a2', hostname: 'db-server-01' });

      const result = listAgents({ hostname: 'web' });
      expect(result.total).toBe(1);
      expect(result.agents[0].hostname).toBe('web-server-01');
    });

    it('supports pagination', () => {
      insertTestAgent(testDb, { id: 'a1' });
      insertTestAgent(testDb, { id: 'a2' });
      insertTestAgent(testDb, { id: 'a3' });

      const page1 = listAgents({ limit: 2, offset: 0 });
      expect(page1.agents).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = listAgents({ limit: 2, offset: 2 });
      expect(page2.agents).toHaveLength(1);
    });

    it('excludes decommissioned agents by default', () => {
      insertTestAgent(testDb, { id: 'a1', status: 'active' });
      insertTestAgent(testDb, { id: 'a2', status: 'decommissioned' });

      const result = listAgents({});
      expect(result.total).toBe(1);
    });
  });

  describe('getAgent', () => {
    it('returns full agent details', () => {
      insertTestAgent(testDb, { id: 'a1', hostname: 'my-host', tags: '["tag1","tag2"]' });

      const agent = getAgent('a1');

      expect(agent).not.toBeNull();
      expect(agent!.hostname).toBe('my-host');
      expect(agent!.tags).toEqual(['tag1', 'tag2']);
    });

    it('returns null for nonexistent agent', () => {
      expect(getAgent('nonexistent')).toBeNull();
    });
  });

  describe('updateAgent', () => {
    it('updates agent status', () => {
      insertTestAgent(testDb, { id: 'a1', status: 'active' });

      updateAgent('a1', { status: 'disabled' });

      const agent = getAgent('a1');
      expect(agent!.status).toBe('disabled');
    });

    it('updates agent tags', () => {
      insertTestAgent(testDb, { id: 'a1' });

      updateAgent('a1', { tags: ['new-tag'] });

      const agent = getAgent('a1');
      expect(agent!.tags).toEqual(['new-tag']);
    });
  });

  describe('deleteAgent', () => {
    it('soft-deletes by setting status to decommissioned', () => {
      insertTestAgent(testDb, { id: 'a1', status: 'active' });

      deleteAgent('a1');

      const agent = getAgent('a1');
      expect(agent!.status).toBe('decommissioned');
    });
  });

  describe('addTag / removeTag', () => {
    it('adds a tag to an agent', () => {
      insertTestAgent(testDb, { id: 'a1', tags: '["existing"]' });

      const tags = addTag('a1', 'new-tag');

      expect(tags).toEqual(['existing', 'new-tag']);
    });

    it('does not duplicate existing tags', () => {
      insertTestAgent(testDb, { id: 'a1', tags: '["tag1"]' });

      const tags = addTag('a1', 'tag1');
      expect(tags).toEqual(['tag1']);
    });

    it('removes a tag from an agent', () => {
      insertTestAgent(testDb, { id: 'a1', tags: '["keep","remove"]' });

      const tags = removeTag('a1', 'remove');
      expect(tags).toEqual(['keep']);
    });

    it('throws for nonexistent agent', () => {
      expect(() => addTag('nonexistent', 'tag')).toThrow('not found');
    });
  });

  describe('getPendingRotationKey', () => {
    it('returns decrypted key when pending and within grace period', () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      insertTestAgent(testDb, { id: 'a1' });
      testDb.prepare(`
        UPDATE agents SET pending_api_key_encrypted = 'test_enc', key_rotation_initiated_at = ? WHERE id = ?
      `).run(recentTime, 'a1');

      const key = getPendingRotationKey('a1');
      expect(key).toBe('decrypted_test_enc');
    });

    it('returns null when no pending rotation', () => {
      insertTestAgent(testDb, { id: 'a1' });

      const key = getPendingRotationKey('a1');
      expect(key).toBeNull();
    });

    it('auto-promotes and returns null when grace period expired', () => {
      const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      insertTestAgent(testDb, { id: 'a1' });
      testDb.prepare(`
        UPDATE agents SET pending_api_key_hash = 'hash', pending_api_key_encrypted = 'enc', key_rotation_initiated_at = ? WHERE id = ?
      `).run(expiredTime, 'a1');

      const key = getPendingRotationKey('a1');
      expect(key).toBeNull();

      // Should have promoted
      const row = testDb.prepare('SELECT pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?').get('a1') as any;
      expect(row.pending_api_key_hash).toBeNull();
      expect(row.key_rotation_initiated_at).toBeNull();
    });

    it('returns null for nonexistent agent', () => {
      const key = getPendingRotationKey('nonexistent');
      expect(key).toBeNull();
    });
  });

  describe('rotation_pending in agent queries', () => {
    it('listAgents includes rotation_pending: true when rotation is active', () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      insertTestAgent(testDb, { id: 'a1' });
      testDb.prepare(`
        UPDATE agents SET key_rotation_initiated_at = ? WHERE id = ?
      `).run(recentTime, 'a1');

      const result = listAgents({});
      expect(result.agents[0].rotation_pending).toBe(true);
    });

    it('listAgents includes rotation_pending: false when no rotation', () => {
      insertTestAgent(testDb, { id: 'a1' });

      const result = listAgents({});
      expect(result.agents[0].rotation_pending).toBe(false);
    });

    it('getAgent includes rotation_pending field', () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      insertTestAgent(testDb, { id: 'a1' });
      testDb.prepare(`
        UPDATE agents SET key_rotation_initiated_at = ? WHERE id = ?
      `).run(recentTime, 'a1');

      const agent = getAgent('a1');
      expect(agent!.rotation_pending).toBe(true);
    });
  });
});
