import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';
import type { HeartbeatPayload } from '../../../types/agent.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../enrollment.service.js', () => ({
  ROTATION_GRACE_PERIOD_SECONDS: 300,
  decryptPendingKey: (encrypted: string) => `decrypted_${encrypted}`,
  promotePendingKey: vi.fn(),
}));

// events.service uses database.js mock transitively
vi.mock('../events.service.js', async () => {
  const actual = await vi.importActual<typeof import('../events.service.js')>('../events.service.js');
  return actual;
});

const {
  recordHeartbeatHistory,
  getHeartbeatHistory,
  pruneHeartbeatHistory,
  detectOfflineAgents,
  getFleetHealthMetrics,
  getStaleAgentIds,
  processHeartbeat,
  resetHeartbeatCounters,
} = await import('../heartbeat.service.js');

function makeHeartbeatPayload(overrides: Partial<HeartbeatPayload> = {}): HeartbeatPayload {
  return {
    timestamp: new Date().toISOString(),
    status: 'idle',
    current_task: null,
    system: {
      hostname: 'test-host',
      os: 'linux',
      arch: 'amd64',
      uptime_seconds: 3600,
      cpu_percent: 25.5,
      memory_mb: 4096,
      disk_free_mb: 50000,
    },
    agent_version: '1.0.0',
    last_task_completed: null,
    ...overrides,
  };
}

describe('heartbeat history', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
    resetHeartbeatCounters();
  });

  describe('recordHeartbeatHistory', () => {
    it('inserts a row into heartbeat_history', () => {
      const payload = makeHeartbeatPayload();
      recordHeartbeatHistory('agent-001', payload);

      const row = testDb.prepare('SELECT * FROM heartbeat_history WHERE agent_id = ?').get('agent-001') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.cpu_percent).toBe(25.5);
      expect(row.memory_mb).toBe(4096);
      expect(row.disk_free_mb).toBe(50000);
      expect(row.uptime_seconds).toBe(3600);
    });

    it('records multiple heartbeats append-only', () => {
      recordHeartbeatHistory('agent-001', makeHeartbeatPayload());
      recordHeartbeatHistory('agent-001', makeHeartbeatPayload());
      recordHeartbeatHistory('agent-001', makeHeartbeatPayload());

      const count = testDb.prepare('SELECT COUNT(*) as c FROM heartbeat_history WHERE agent_id = ?').get('agent-001') as { c: number };
      expect(count.c).toBe(3);
    });
  });

  describe('getHeartbeatHistory', () => {
    it('returns history within the specified day range', () => {
      // Insert a recent record
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent, memory_mb, disk_free_mb, uptime_seconds)
        VALUES (?, datetime('now', '-1 hour'), 50.0, 2048, 30000, 7200)
      `).run('agent-001');

      // Insert an old record (8 days ago)
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent, memory_mb, disk_free_mb, uptime_seconds)
        VALUES (?, datetime('now', '-8 days'), 30.0, 1024, 40000, 1000)
      `).run('agent-001');

      const history = getHeartbeatHistory('agent-001', 7);
      expect(history).toHaveLength(1);
      expect(history[0].cpu_percent).toBe(50.0);
    });

    it('returns results in ascending order (oldest first)', () => {
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent)
        VALUES (?, datetime('now', '-2 hours'), 30.0)
      `).run('agent-001');
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent)
        VALUES (?, datetime('now', '-1 hour'), 60.0)
      `).run('agent-001');

      const history = getHeartbeatHistory('agent-001', 7);
      expect(history).toHaveLength(2);
      expect(history[0].cpu_percent).toBe(30.0);
      expect(history[1].cpu_percent).toBe(60.0);
    });

    it('returns empty array for agent with no history', () => {
      const history = getHeartbeatHistory('agent-002', 7);
      expect(history).toHaveLength(0);
    });
  });

  describe('pruneHeartbeatHistory', () => {
    it('deletes rows older than 30 days', () => {
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent)
        VALUES (?, datetime('now', '-31 days'), 10.0)
      `).run('agent-001');
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent)
        VALUES (?, datetime('now', '-1 day'), 20.0)
      `).run('agent-001');

      const pruned = pruneHeartbeatHistory();
      expect(pruned).toBe(1);

      const remaining = testDb.prepare('SELECT COUNT(*) as c FROM heartbeat_history').get() as { c: number };
      expect(remaining.c).toBe(1);
    });

    it('returns 0 when nothing to prune', () => {
      testDb.prepare(`
        INSERT INTO heartbeat_history (agent_id, timestamp, cpu_percent)
        VALUES (?, datetime('now'), 10.0)
      `).run('agent-001');

      const pruned = pruneHeartbeatHistory();
      expect(pruned).toBe(0);
    });
  });

  describe('detectOfflineAgents', () => {
    it('records went_offline event for agents exceeding heartbeat timeout', () => {
      // Set agent heartbeat to 5 minutes ago (past 180s threshold)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(fiveMinAgo, 'agent-001');

      const count = detectOfflineAgents();
      expect(count).toBe(1);

      const events = testDb.prepare('SELECT * FROM agent_events WHERE agent_id = ? AND event_type = ?').all('agent-001', 'went_offline') as Record<string, unknown>[];
      expect(events).toHaveLength(1);
    });

    it('does not duplicate went_offline events', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(fiveMinAgo, 'agent-001');

      detectOfflineAgents();
      detectOfflineAgents(); // Second call should not create duplicate

      const events = testDb.prepare('SELECT * FROM agent_events WHERE agent_id = ? AND event_type = ?').all('agent-001', 'went_offline') as Record<string, unknown>[];
      expect(events).toHaveLength(1);
    });

    it('skips disabled agents', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE agents SET status = ?, last_heartbeat = ? WHERE id = ?').run('disabled', fiveMinAgo, 'agent-001');

      const count = detectOfflineAgents();
      expect(count).toBe(0);
    });

    it('skips agents with null last_heartbeat', () => {
      testDb.prepare('UPDATE agents SET last_heartbeat = NULL WHERE id = ?').run('agent-001');

      const count = detectOfflineAgents();
      expect(count).toBe(0);
    });
  });

  describe('processHeartbeat event hooks', () => {
    it('records came_online event when agent was offline', () => {
      // Set agent heartbeat to 5 minutes ago (offline threshold)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(fiveMinAgo, 'agent-001');

      processHeartbeat('agent-001', makeHeartbeatPayload());

      const events = testDb.prepare(
        "SELECT * FROM agent_events WHERE agent_id = ? AND event_type = 'came_online'"
      ).all('agent-001') as Record<string, unknown>[];
      expect(events).toHaveLength(1);
    });

    it('records version_updated event when version changes', () => {
      processHeartbeat('agent-001', makeHeartbeatPayload({ agent_version: '2.0.0' }));

      const events = testDb.prepare(
        "SELECT * FROM agent_events WHERE agent_id = ? AND event_type = 'version_updated'"
      ).all('agent-001') as Record<string, unknown>[];
      expect(events).toHaveLength(1);

      const details = JSON.parse(events[0].details as string);
      expect(details.from).toBe('1.0.0');
      expect(details.to).toBe('2.0.0');
    });

    it('does not record came_online when agent was already online', () => {
      // Agent has a recent heartbeat (already online)
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(new Date().toISOString(), 'agent-001');

      processHeartbeat('agent-001', makeHeartbeatPayload());

      const events = testDb.prepare(
        "SELECT * FROM agent_events WHERE agent_id = ? AND event_type = 'came_online'"
      ).all('agent-001') as Record<string, unknown>[];
      expect(events).toHaveLength(0);
    });

    it('records heartbeat history every 5th processHeartbeat call (sampled)', () => {
      // Sampling: record every 5th heartbeat per agent to reduce write volume
      for (let i = 0; i < 5; i++) {
        processHeartbeat('agent-001', makeHeartbeatPayload());
      }

      const count = testDb.prepare('SELECT COUNT(*) as c FROM heartbeat_history WHERE agent_id = ?').get('agent-001') as { c: number };
      expect(count.c).toBe(1);
    });
  });

  describe('getFleetHealthMetrics', () => {
    it('returns default values for empty fleet', () => {
      // Remove all agents
      testDb.prepare('DELETE FROM agents').run();

      const metrics = getFleetHealthMetrics();
      expect(metrics.fleet_uptime_percent_30d).toBe(0);
      expect(metrics.task_success_rate_7d).toBe(100);
      expect(metrics.mtbf_hours).toBeNull();
      expect(metrics.stale_agent_count).toBe(0);
      expect(metrics.stale_agent_ids).toEqual([]);
    });

    it('calculates task success rate correctly', () => {
      // Insert completed and failed tasks with recent timestamps
      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, completed_at, batch_id)
        VALUES ('t1', 'agent-001', 'org-001', 'execute_test', 'completed', '{}', datetime('now', '-1 day'), 't1')
      `).run();
      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, completed_at, batch_id)
        VALUES ('t2', 'agent-001', 'org-001', 'execute_test', 'completed', '{}', datetime('now', '-2 days'), 't2')
      `).run();
      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, completed_at, batch_id)
        VALUES ('t3', 'agent-001', 'org-001', 'execute_test', 'failed', '{}', datetime('now', '-1 day'), 't3')
      `).run();

      const metrics = getFleetHealthMetrics();
      // 2 completed / 3 total = 66.7%
      expect(metrics.task_success_rate_7d).toBe(66.7);
    });

    it('identifies stale agents', () => {
      // agent-001 has a heartbeat but no completed tasks in 7d
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(new Date().toISOString(), 'agent-001');

      const metrics = getFleetHealthMetrics();
      expect(metrics.stale_agent_count).toBe(2); // both agents have no completed tasks
      expect(metrics.stale_agent_ids).toContain('agent-001');
    });
  });

  describe('getStaleAgentIds', () => {
    it('returns agents with no recent completed tasks', () => {
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(new Date().toISOString(), 'agent-001');

      const staleIds = getStaleAgentIds();
      expect(staleIds.has('agent-001')).toBe(true);
    });

    it('excludes agents with recent completed tasks', () => {
      testDb.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(new Date().toISOString(), 'agent-001');
      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, completed_at, batch_id)
        VALUES ('t1', 'agent-001', 'org-001', 'execute_test', 'completed', '{}', datetime('now', '-1 day'), 't1')
      `).run();

      const staleIds = getStaleAgentIds();
      expect(staleIds.has('agent-001')).toBe(false);
    });
  });
});
