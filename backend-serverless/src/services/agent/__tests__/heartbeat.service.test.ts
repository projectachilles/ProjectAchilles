import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DbHelper } from '../database.js';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: DbHelper;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return {
    ...actual,
    getDb: async () => testDb,
  };
});

// Mock the enrollment service — getPendingRotationKey calls decrypt/promote
vi.mock('../enrollment.service.js', () => ({
  ROTATION_GRACE_PERIOD_SECONDS: 300,
  decryptPendingKey: (encrypted: string) => `decrypted_${encrypted}`,
  promotePendingKey: async (agentId: string) => {
    const now = new Date().toISOString();
    await testDb.run(`
      UPDATE agents
      SET api_key_hash = pending_api_key_hash,
          pending_api_key_hash = NULL,
          pending_api_key_encrypted = NULL,
          key_rotation_initiated_at = NULL,
          api_key_rotated_at = ?,
          updated_at = ?
      WHERE id = ?
    `, [now, now, agentId]);
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
  beforeEach(async () => {
    testDb = await createTestDatabase();
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
    it('updates agent heartbeat timestamp and data', async () => {
      await insertTestAgent(testDb);

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

      await processHeartbeat('agent-001', payload);

      const agent = await testDb.get('SELECT * FROM agents WHERE id = ?', ['agent-001']) as unknown as any;
      expect(agent.agent_version).toBe('1.1.0');
      expect(agent.last_heartbeat).toBeDefined();
      const data = JSON.parse(agent.last_heartbeat_data);
      expect(data.system.cpu_percent).toBe(25);
    });
  });

  describe('getAgentMetrics', () => {
    it('returns correct counts', async () => {
      await insertTestAgent(testDb, { id: 'a1', status: 'active', last_heartbeat: new Date().toISOString() });
      await insertTestAgent(testDb, { id: 'a2', status: 'active', last_heartbeat: new Date(Date.now() - 300000).toISOString() }); // offline
      await insertTestAgent(testDb, { id: 'a3', status: 'disabled' });

      const metrics = await getAgentMetrics();

      expect(metrics.total).toBe(3); // all non-decommissioned
      expect(metrics.online).toBe(1); // only a1
      expect(metrics.offline).toBe(2);
    });

    it('filters by org_id', async () => {
      await insertTestAgent(testDb, { id: 'a1', org_id: 'org-1' });
      await insertTestAgent(testDb, { id: 'a2', org_id: 'org-2' });

      const metrics = await getAgentMetrics('org-1');
      expect(metrics.total).toBe(1);
    });

    it('counts pending tasks', async () => {
      await insertTestAgent(testDb, { id: 'a1' });

      // Insert a pending task directly
      await testDb.run(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_by, ttl)
        VALUES ('t1', 'a1', 'org-001', 'execute_test', 'pending', '{}', 'user', 604800)
      `);

      const metrics = await getAgentMetrics();
      expect(metrics.pending_tasks).toBe(1);
    });

    it('includes task_activity_24h stats', async () => {
      await insertTestAgent(testDb, { id: 'a1' });

      const recentTime = new Date(Date.now() - 2 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const oldTime = new Date(Date.now() - 48 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

      // Completed within 24h
      await testDb.run(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_by, ttl, completed_at)
        VALUES ('t1', 'a1', 'org-001', 'execute_test', 'completed', '{}', 'user', 604800, ?)
      `, [recentTime]);

      // Failed within 24h
      await testDb.run(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_by, ttl, completed_at)
        VALUES ('t2', 'a1', 'org-001', 'execute_test', 'failed', '{}', 'user', 604800, ?)
      `, [recentTime]);

      // Completed outside 24h — should not count
      await testDb.run(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_by, ttl, completed_at)
        VALUES ('t3', 'a1', 'org-001', 'execute_test', 'completed', '{}', 'user', 604800, ?)
      `, [oldTime]);

      // In-progress task (executing)
      await testDb.run(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_by, ttl)
        VALUES ('t4', 'a1', 'org-001', 'execute_test', 'executing', '{}', 'user', 604800)
      `);

      const metrics = await getAgentMetrics();
      expect(metrics.task_activity_24h.completed).toBe(1);
      expect(metrics.task_activity_24h.failed).toBe(1);
      expect(metrics.task_activity_24h.total).toBe(2);
      expect(metrics.task_activity_24h.success_rate).toBe(50);
      expect(metrics.task_activity_24h.in_progress).toBe(1);
    });

    it('includes by_version distribution', async () => {
      await insertTestAgent(testDb, { id: 'a1', agent_version: '1.0.0' });
      await insertTestAgent(testDb, { id: 'a2', agent_version: '1.0.0' });
      await insertTestAgent(testDb, { id: 'a3', agent_version: '1.1.0' });
      await insertTestAgent(testDb, { id: 'a4', agent_version: '1.1.0', status: 'decommissioned' });

      const metrics = await getAgentMetrics();
      expect(metrics.by_version).toEqual({ '1.0.0': 2, '1.1.0': 1 });
    });
  });

  describe('listAgents', () => {
    it('returns agents with summary info', async () => {
      await insertTestAgent(testDb, { id: 'a1', hostname: 'server-1' });
      await insertTestAgent(testDb, { id: 'a2', hostname: 'server-2' });

      const result = await listAgents({});

      expect(result.total).toBe(2);
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0]).toHaveProperty('runtime_status');
      expect(result.agents[0]).toHaveProperty('is_online');
    });

    it('filters by status', async () => {
      await insertTestAgent(testDb, { id: 'a1', status: 'active' });
      await insertTestAgent(testDb, { id: 'a2', status: 'disabled' });

      const result = await listAgents({ status: 'disabled' });
      expect(result.total).toBe(1);
      expect(result.agents[0].id).toBe('a2');
    });

    it('filters by OS', async () => {
      await insertTestAgent(testDb, { id: 'a1', os: 'linux' });
      await insertTestAgent(testDb, { id: 'a2', os: 'windows' });

      const result = await listAgents({ os: 'linux' });
      expect(result.total).toBe(1);
    });

    it('filters by hostname substring', async () => {
      await insertTestAgent(testDb, { id: 'a1', hostname: 'web-server-01' });
      await insertTestAgent(testDb, { id: 'a2', hostname: 'db-server-01' });

      const result = await listAgents({ hostname: 'web' });
      expect(result.total).toBe(1);
      expect(result.agents[0].hostname).toBe('web-server-01');
    });

    it('supports pagination', async () => {
      await insertTestAgent(testDb, { id: 'a1' });
      await insertTestAgent(testDb, { id: 'a2' });
      await insertTestAgent(testDb, { id: 'a3' });

      const page1 = await listAgents({ limit: 2, offset: 0 });
      expect(page1.agents).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = await listAgents({ limit: 2, offset: 2 });
      expect(page2.agents).toHaveLength(1);
    });

    it('excludes decommissioned agents by default', async () => {
      await insertTestAgent(testDb, { id: 'a1', status: 'active' });
      await insertTestAgent(testDb, { id: 'a2', status: 'decommissioned' });

      const result = await listAgents({});
      expect(result.total).toBe(1);
    });
  });

  describe('getAgent', () => {
    it('returns full agent details', async () => {
      await insertTestAgent(testDb, { id: 'a1', hostname: 'my-host', tags: '["tag1","tag2"]' });

      const agent = await getAgent('a1');

      expect(agent).not.toBeNull();
      expect(agent!.hostname).toBe('my-host');
      expect(agent!.tags).toEqual(['tag1', 'tag2']);
    });

    it('returns null for nonexistent agent', async () => {
      expect(await getAgent('nonexistent')).toBeNull();
    });
  });

  describe('updateAgent', () => {
    it('updates agent status', async () => {
      await insertTestAgent(testDb, { id: 'a1', status: 'active' });

      await updateAgent('a1', { status: 'disabled' });

      const agent = await getAgent('a1');
      expect(agent!.status).toBe('disabled');
    });

    it('updates agent tags', async () => {
      await insertTestAgent(testDb, { id: 'a1' });

      await updateAgent('a1', { tags: ['new-tag'] });

      const agent = await getAgent('a1');
      expect(agent!.tags).toEqual(['new-tag']);
    });
  });

  describe('deleteAgent', () => {
    it('soft-deletes by setting status to decommissioned', async () => {
      await insertTestAgent(testDb, { id: 'a1', status: 'active' });

      await deleteAgent('a1');

      const agent = await getAgent('a1');
      expect(agent!.status).toBe('decommissioned');
    });
  });

  describe('addTag / removeTag', () => {
    it('adds a tag to an agent', async () => {
      await insertTestAgent(testDb, { id: 'a1', tags: '["existing"]' });

      const tags = await addTag('a1', 'new-tag');

      expect(tags).toEqual(['existing', 'new-tag']);
    });

    it('does not duplicate existing tags', async () => {
      await insertTestAgent(testDb, { id: 'a1', tags: '["tag1"]' });

      const tags = await addTag('a1', 'tag1');
      expect(tags).toEqual(['tag1']);
    });

    it('removes a tag from an agent', async () => {
      await insertTestAgent(testDb, { id: 'a1', tags: '["keep","remove"]' });

      const tags = await removeTag('a1', 'remove');
      expect(tags).toEqual(['keep']);
    });

    it('throws for nonexistent agent', async () => {
      await expect(addTag('nonexistent', 'tag')).rejects.toThrow('not found');
    });
  });

  describe('getPendingRotationKey', () => {
    it('returns decrypted key when pending and within grace period', async () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await insertTestAgent(testDb, { id: 'a1' });
      await testDb.run(`
        UPDATE agents SET pending_api_key_encrypted = 'test_enc', key_rotation_initiated_at = ? WHERE id = ?
      `, [recentTime, 'a1']);

      const key = await getPendingRotationKey('a1');
      expect(key).toBe('decrypted_test_enc');
    });

    it('returns null when no pending rotation', async () => {
      await insertTestAgent(testDb, { id: 'a1' });

      const key = await getPendingRotationKey('a1');
      expect(key).toBeNull();
    });

    it('auto-promotes and returns null when grace period expired', async () => {
      const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      await insertTestAgent(testDb, { id: 'a1' });
      await testDb.run(`
        UPDATE agents SET pending_api_key_hash = 'hash', pending_api_key_encrypted = 'enc', key_rotation_initiated_at = ? WHERE id = ?
      `, [expiredTime, 'a1']);

      const key = await getPendingRotationKey('a1');
      expect(key).toBeNull();

      // Should have promoted
      const row = await testDb.get('SELECT pending_api_key_hash, key_rotation_initiated_at FROM agents WHERE id = ?', ['a1']) as unknown as any;
      expect(row.pending_api_key_hash).toBeNull();
      expect(row.key_rotation_initiated_at).toBeNull();
    });

    it('returns null for nonexistent agent', async () => {
      const key = await getPendingRotationKey('nonexistent');
      expect(key).toBeNull();
    });
  });

  describe('rotation_pending in agent queries', () => {
    it('listAgents includes rotation_pending: true when rotation is active', async () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await insertTestAgent(testDb, { id: 'a1' });
      await testDb.run(`
        UPDATE agents SET key_rotation_initiated_at = ? WHERE id = ?
      `, [recentTime, 'a1']);

      const result = await listAgents({});
      expect(result.agents[0].rotation_pending).toBe(true);
    });

    it('listAgents includes rotation_pending: false when no rotation', async () => {
      await insertTestAgent(testDb, { id: 'a1' });

      const result = await listAgents({});
      expect(result.agents[0].rotation_pending).toBe(false);
    });

    it('getAgent includes rotation_pending field', async () => {
      const recentTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await insertTestAgent(testDb, { id: 'a1' });
      await testDb.run(`
        UPDATE agents SET key_rotation_initiated_at = ? WHERE id = ?
      `, [recentTime, 'a1']);

      const agent = await getAgent('a1');
      expect(agent!.rotation_pending).toBe(true);
    });
  });
});
