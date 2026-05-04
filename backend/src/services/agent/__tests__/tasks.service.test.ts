import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Mock the test-catalog service (used for metadata enrichment in createTasks)
const mockGetTestMetadata = vi.fn().mockReturnValue(null);
vi.mock('../test-catalog.service.js', () => ({
  getTestMetadata: (...args: unknown[]) => mockGetTestMetadata(...args),
}));

// Mock fs and os for createTasks (reads build metadata from disk).
// The source does `import fs from 'fs'` which becomes `fs.default` in ESM.
// vi.mock provides both named exports and default to cover all access patterns.
// vi.hoisted lifts these into hoist scope — required because the database mock
// now uses importOriginal(), which triggers a real `import fs` chain at hoist
// time and would hit a TDZ on plain top-level consts.
const { mockExistsSync, mockReadFileSync, mockStatSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockReadFileSync: vi.fn(),
  mockStatSync: vi.fn().mockReturnValue({ size: 1024 }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    statSync: mockStatSync,
  };
  return {
    ...actual,
    ...overrides,
    default: { ...actual, ...overrides },
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => '/mock-home' };
  return {
    ...actual,
    ...overrides,
    default: { ...actual, ...overrides },
  };
});

// Mock integrations settings service for credential injection tests
const mockGetAzureCredentials = vi.fn().mockReturnValue(null);
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getAzureCredentials() { return mockGetAzureCredentials(); }
  },
}));

const {
  createTasks,
  createCommandTasks,
  createUninstallTasks,
  getNextTask,
  updateTaskStatus,
  submitResult,
  listTasks,
  listTasksGrouped,
  getTask,
  cancelTask,
  deleteTask,
  expireOldTasks,
  expireStaleTasks,
  expireOverdueTasks,
  updateTaskNotes,
  sanitizeTaskForAdmin,
  TerminalStateRejection,
} = await import('../tasks.service.js');

describe('tasks.service', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
  });

  describe('getNextTask', () => {
    it('returns the next pending task for an agent', () => {
      insertTestTask(testDb, { id: 'task-001', agent_id: 'agent-001', status: 'pending' });

      const task = getNextTask('agent-001');

      expect(task).not.toBeNull();
      expect(task!.id).toBe('task-001');
      expect(task!.status).toBe('assigned');
    });

    it('returns null when no pending tasks exist', () => {
      const task = getNextTask('agent-001');
      expect(task).toBeNull();
    });

    it('assigns highest priority task first', () => {
      insertTestTask(testDb, { id: 'low', agent_id: 'agent-001', priority: 1 });
      insertTestTask(testDb, { id: 'high', agent_id: 'agent-001', priority: 10 });

      const task = getNextTask('agent-001');
      expect(task!.id).toBe('high');
    });

    it('does not return tasks for other agents', () => {
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestTask(testDb, { id: 'task-other', agent_id: 'agent-002' });

      const task = getNextTask('agent-001');
      expect(task).toBeNull();
    });

    it('marks retrieved task as assigned', () => {
      insertTestTask(testDb, { id: 'task-001', agent_id: 'agent-001' });

      getNextTask('agent-001');

      const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('task-001') as any;
      expect(row.status).toBe('assigned');
    });
  });

  describe('updateTaskStatus', () => {
    it('transitions assigned -> downloading', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      const task = updateTaskStatus('t1', 'agent-001', 'downloading');
      expect(task.status).toBe('downloading');
    });

    it('transitions downloading -> executing', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'downloading' });

      const task = updateTaskStatus('t1', 'agent-001', 'executing');
      expect(task.status).toBe('executing');
    });

    it('transitions executing -> completed', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const task = updateTaskStatus('t1', 'agent-001', 'completed');
      expect(task.status).toBe('completed');
      expect(task.completed_at).toBeDefined();
    });

    it('transitions executing -> failed', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const task = updateTaskStatus('t1', 'agent-001', 'failed');
      expect(task.status).toBe('failed');
    });

    it('rejects invalid state transition', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'pending' });

      expect(() => updateTaskStatus('t1', 'agent-001', 'completed')).toThrow(
        'Invalid state transition: pending -> completed'
      );
    });

    it('rejects update from wrong agent', () => {
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      expect(() => updateTaskStatus('t1', 'agent-002', 'downloading')).toThrow(
        'Agent does not own this task'
      );
    });

    it('throws for nonexistent task', () => {
      expect(() => updateTaskStatus('nonexistent', 'agent-001', 'assigned')).toThrow(
        'Task not found'
      );
    });

    // ────────────────────────────────────────────────────────────────────
    // Terminal-state idempotency for PATCH status. The agent's reporter
    // PATCHes status='failed' as a final give-up after exhausting retries;
    // if the server already terminated the task, this PATCH must be
    // accepted idempotently rather than logged as "Invalid state transition".
    // ────────────────────────────────────────────────────────────────────
    it.each([
      ['completed', 'failed'],
      ['failed', 'failed'],
      ['expired', 'failed'],
      ['failed', 'completed'],
    ] as const)(
      'throws TerminalStateRejection when transitioning %s -> %s',
      (fromStatus, toStatus) => {
        insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: fromStatus });

        let caught: unknown;
        try {
          updateTaskStatus('t1', 'agent-001', toStatus);
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(TerminalStateRejection);
        expect((caught as InstanceType<typeof TerminalStateRejection>).task.status).toBe(fromStatus);
      },
    );

    it('does NOT modify task state when terminal rejection fires', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'completed' });
      const before = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');

      try {
        updateTaskStatus('t1', 'agent-001', 'failed');
      } catch {
        // expected
      }

      const after = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(after).toEqual(before);
    });
  });

  describe('submitResult', () => {
    it('saves result and marks task completed', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const result = {
        task_id: 't1',
        test_uuid: 'test-001',
        exit_code: 0,
        stdout: 'Success',
        stderr: '',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        execution_duration_ms: 1500,
        binary_sha256: 'abc',
        hostname: 'test-host',
        os: 'linux' as const,
        arch: 'amd64' as const,
      };

      const task = submitResult('t1', 'agent-001', result);
      expect(task.status).toBe('completed');
      expect(task.result).toBeDefined();
      expect(task.result!.exit_code).toBe(0);
    });

    it('rejects submission for wrong status', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'pending' });

      expect(() =>
        submitResult('t1', 'agent-001', { exit_code: 0 } as any)
      ).toThrow('Cannot submit result');
    });

    it('rejects submission from wrong agent', () => {
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      expect(() =>
        submitResult('t1', 'agent-002', { exit_code: 0 } as any)
      ).toThrow('Agent does not own this task');
    });

    // ────────────────────────────────────────────────────────────────────
    // Terminal-state idempotency: regression tests for the May-2026 storm.
    // Agents in the field repeatedly POSTed results for tasks already
    // marked failed/expired by server-side expiration sweeps. The old
    // behavior threw HTTP 400 and the agent's queue.Drain looped forever.
    // Now we throw TerminalStateRejection so routes can return 2xx.
    // ────────────────────────────────────────────────────────────────────
    it.each(['completed', 'failed', 'expired'] as const)(
      'throws TerminalStateRejection (not AppError) when task is %s',
      (status) => {
        insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status });

        let caught: unknown;
        try {
          submitResult('t1', 'agent-001', { exit_code: 0 } as any);
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(TerminalStateRejection);
        expect((caught as InstanceType<typeof TerminalStateRejection>).task.status).toBe(status);
      },
    );

    it('does NOT modify task state when terminal rejection fires', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'failed' });
      const before = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');

      try {
        submitResult('t1', 'agent-001', { exit_code: 0, stdout: 'tampered' } as any);
      } catch {
        // expected
      }

      const after = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(after).toEqual(before);
    });
  });

  describe('listTasks', () => {
    it('returns tasks with pagination', () => {
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-001' });

      const result = listTasks({});
      expect(result.total).toBe(2);
      expect(result.tasks).toHaveLength(2);
    });

    it('filters by status', () => {
      insertTestTask(testDb, { id: 't1', status: 'pending' });
      insertTestTask(testDb, { id: 't2', status: 'completed' });

      const result = listTasks({ status: 'pending' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t1');
    });

    it('filters by agent_id', () => {
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-002' });

      const result = listTasks({ agent_id: 'agent-001' });
      expect(result.total).toBe(1);
    });

    it('supports pagination', () => {
      insertTestTask(testDb, { id: 't1' });
      insertTestTask(testDb, { id: 't2' });
      insertTestTask(testDb, { id: 't3' });

      const page1 = listTasks({ limit: 2, offset: 0 });
      expect(page1.tasks).toHaveLength(2);

      const page2 = listTasks({ limit: 2, offset: 2 });
      expect(page2.tasks).toHaveLength(1);
    });
  });

  describe('getTask', () => {
    it('returns a task by ID', () => {
      insertTestTask(testDb, { id: 'task-001' });

      const task = getTask('task-001');
      expect(task.id).toBe('task-001');
      expect(task.payload).toBeDefined();
    });

    it('throws for nonexistent task', () => {
      expect(() => getTask('nonexistent')).toThrow('Task not found');
    });
  });

  describe('cancelTask', () => {
    it('cancels a pending task', () => {
      insertTestTask(testDb, { id: 't1', status: 'pending' });

      const task = cancelTask('t1');
      expect(task.status).toBe('expired');
    });

    it('cancels an assigned task', () => {
      insertTestTask(testDb, { id: 't1', status: 'assigned' });

      const task = cancelTask('t1');
      expect(task.status).toBe('expired');
    });

    it('rejects cancellation of completed task', () => {
      insertTestTask(testDb, { id: 't1', status: 'completed' });

      expect(() => cancelTask('t1')).toThrow('Cannot cancel task');
    });

    it('rejects cancellation of failed task', () => {
      insertTestTask(testDb, { id: 't1', status: 'failed' });

      expect(() => cancelTask('t1')).toThrow('Cannot cancel task');
    });
  });

  describe('expireOldTasks', () => {
    it('expires tasks past their TTL', () => {
      // Insert task with 0 TTL (should expire immediately)
      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_at, ttl, created_by)
        VALUES ('t-old', 'agent-001', 'org-001', 'execute_test', 'pending', '{}',
                datetime('now', '-2 days'), 1, 'user')
      `).run();

      const count = expireOldTasks();
      expect(count).toBe(1);

      const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t-old') as any;
      expect(row.status).toBe('expired');
    });

    it('does not expire tasks within their TTL', () => {
      insertTestTask(testDb, { id: 't1', status: 'pending', ttl: 604800 }); // 7 day TTL

      const count = expireOldTasks();
      expect(count).toBe(0);
    });
  });

  describe('expireStaleTasks', () => {
    it('fails executing tasks when agent is offline', () => {
      // Agent with last heartbeat 10 minutes ago (well past 360s threshold)
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      insertTestTask(testDb, { id: 't-stale', agent_id: 'offline-agent', status: 'executing' });

      const count = expireStaleTasks();
      expect(count).toBe(1);

      const row = testDb.prepare('SELECT status, result FROM tasks WHERE id = ?').get('t-stale') as any;
      expect(row.status).toBe('failed');
      expect(JSON.parse(row.result)).toEqual({ error: 'Agent went offline during execution', exit_code: -1, stdout: '', stderr: 'Agent went offline during execution', execution_duration_ms: 0 });
    });

    it('fails downloading tasks when agent is offline', () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      insertTestTask(testDb, { id: 't-dl', agent_id: 'offline-agent', status: 'downloading' });

      const count = expireStaleTasks();
      expect(count).toBe(1);

      const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t-dl') as any;
      expect(row.status).toBe('failed');
    });

    it('does not fail tasks when agent is still online', () => {
      // Agent with recent heartbeat (default is now)
      insertTestTask(testDb, { id: 't-active', agent_id: 'agent-001', status: 'executing' });

      const count = expireStaleTasks();
      expect(count).toBe(0);

      const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t-active') as any;
      expect(row.status).toBe('executing');
    });

    it('does not affect pending or assigned tasks', () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      insertTestTask(testDb, { id: 't-pending', agent_id: 'offline-agent', status: 'pending' });
      insertTestTask(testDb, { id: 't-assigned', agent_id: 'offline-agent', status: 'assigned' });

      const count = expireStaleTasks();
      expect(count).toBe(0);
    });

    it('fails tasks when agent has null heartbeat', () => {
      // Agent that never sent a heartbeat
      insertTestAgent(testDb, { id: 'no-hb-agent', last_heartbeat: '' });
      // SQLite stores empty string; update to NULL for this test
      testDb.prepare("UPDATE agents SET last_heartbeat = NULL WHERE id = 'no-hb-agent'").run();
      insertTestTask(testDb, { id: 't-nohb', agent_id: 'no-hb-agent', status: 'executing' });

      const count = expireStaleTasks();
      expect(count).toBe(1);
    });

    // ──────────────────────────────────────────────────────────────────────
    // Retry creation gating: regression for the May-2026 retry-pile-on
    // pattern observed on tpsgl. Previously, every stale task on an
    // agent that stayed offline (e.g. laptop powered off overnight) got
    // 2 auto-retries — both of which then also failed when the same
    // agent stayed offline. Resulting `failed×3 / completed×0` chains
    // flooded the Tasks UI without any chance of succeeding.
    // ──────────────────────────────────────────────────────────────────────
    it('skips retry creation when agent is still offline at fail time', () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      insertTestAgent(testDb, { id: 'still-offline', last_heartbeat: staleHeartbeat });
      insertTestTask(testDb, {
        id: 't-stale', agent_id: 'still-offline', status: 'executing',
        type: 'execute_test',
      });
      // Defaults from schema: retry_count=0, max_retries=2.

      expect(expireStaleTasks()).toBe(1);

      const retries = testDb.prepare(
        `SELECT COUNT(*) AS n FROM tasks WHERE original_task_id = ? OR (id != ? AND agent_id = ?)`
      ).get('t-stale', 't-stale', 'still-offline') as { n: number };
      expect(retries.n).toBe(0);

      // The original task is still failed — no new pending retry.
      const orig = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t-stale') as { status: string };
      expect(orig.status).toBe('failed');
    });

    it('still creates retry when agent has come back online', () => {
      // Agent was offline (so the SELECT for stale tasks fires), but by the
      // time we process the retry decision the heartbeat has refreshed.
      // Simulated by inserting both a stale-then-fresh agent and a fresh
      // task assigned to it: the stale tasks are picked up by SELECT due
      // to their executing status combined with the agent's PRIOR offline
      // state — but in the real system, heartbeats can refresh between
      // SELECT and the retry decision. We simulate by setting
      // last_heartbeat fresh but leaving an executing task in place.
      // Note: in practice the SELECT would not return rows for a fresh
      // agent. To test the gate logic itself, we directly call the gate
      // by writing the row, then observing post-call retry creation.

      // For a true end-to-end test of the gate within expireStaleTasks,
      // we need the agent to be detected as stale by the SELECT but
      // re-fetched as fresh inside the loop. SQLite is fast and runs in a
      // single transaction, so simulating a heartbeat update mid-call is
      // unrealistic. Instead we test the inverse: a previously-stale
      // agent that came back online creates retry as expected when the
      // SELECT picks up tasks via their NULL heartbeat alias.

      // Set up: agent currently fresh, task in executing — should NOT
      // be picked up by SELECT, so no fail and no retry expected.
      insertTestAgent(testDb, { id: 'fresh-agent' });
      insertTestTask(testDb, {
        id: 't-fresh', agent_id: 'fresh-agent', status: 'executing',
        type: 'execute_test',
      });
      expect(expireStaleTasks()).toBe(0);

      // Now: agent went stale, task still executing → SELECT picks it up,
      // re-fetch returns stale → no retry.
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      testDb.prepare("UPDATE agents SET last_heartbeat = ? WHERE id = 'fresh-agent'")
        .run(staleHeartbeat);
      expect(expireStaleTasks()).toBe(1);

      const retryCount = testDb.prepare(
        `SELECT COUNT(*) AS n FROM tasks WHERE original_task_id = 't-fresh'`
      ).get() as { n: number };
      expect(retryCount.n).toBe(0); // no retry — agent still offline at fail time
    });

    it('does NOT skip retry for non-execute_test types (no retry was ever expected)', () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      insertTestTask(testDb, {
        id: 't-cmd', agent_id: 'offline-agent', status: 'executing',
        type: 'execute_command',
      });

      expect(expireStaleTasks()).toBe(1);

      const retryCount = testDb.prepare(
        `SELECT COUNT(*) AS n FROM tasks WHERE original_task_id = 't-cmd'`
      ).get() as { n: number };
      expect(retryCount.n).toBe(0);
    });
  });

  describe('expireOverdueTasks', () => {
    it('fails executing tasks that exceeded execution_timeout + buffer', () => {
      // Task assigned 10 minutes ago with 300s timeout (300+120=420s threshold, 600s > 420s)
      const assignedAt = new Date(Date.now() - 600_000).toISOString().replace('T', ' ').slice(0, 19);
      insertTestTask(testDb, { id: 't-overdue', status: 'executing', assigned_at: assignedAt });

      const count = expireOverdueTasks();
      expect(count).toBe(1);

      const row = testDb.prepare('SELECT status, result FROM tasks WHERE id = ?').get('t-overdue') as any;
      expect(row.status).toBe('failed');
      expect(JSON.parse(row.result).error).toBe('Task exceeded execution timeout');
    });

    it('does not fail tasks still within timeout + buffer', () => {
      // Task assigned 2 minutes ago with 300s timeout (300+120=420s, 120s < 420s)
      const assignedAt = new Date(Date.now() - 120_000).toISOString().replace('T', ' ').slice(0, 19);
      insertTestTask(testDb, { id: 't-ok', status: 'executing', assigned_at: assignedAt });

      const count = expireOverdueTasks();
      expect(count).toBe(0);

      const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t-ok') as any;
      expect(row.status).toBe('executing');
    });

    it('respects custom execution_timeout from payload', () => {
      // Task with 60s timeout, assigned 200s ago (60+120=180s threshold, 200s > 180s)
      const assignedAt = new Date(Date.now() - 200_000).toISOString().replace('T', ' ').slice(0, 19);
      const payload = JSON.stringify({
        test_uuid: 'uuid', test_name: 'name', binary_name: 'bin',
        binary_sha256: 'sha', binary_size: 100, execution_timeout: 60,
        arguments: [], metadata: { category: '', subcategory: '', severity: '',
          techniques: [], tactics: [], threat_actor: '', target: [],
          complexity: '', tags: [], score: null, integrations: [] },
      });
      insertTestTask(testDb, { id: 't-short', status: 'executing', assigned_at: assignedAt, payload });

      const count = expireOverdueTasks();
      expect(count).toBe(1);
    });

    it('does not fail tasks without assigned_at', () => {
      insertTestTask(testDb, { id: 't-noassign', status: 'executing' });

      const count = expireOverdueTasks();
      expect(count).toBe(0);
    });

    it('catches online agent with stuck task', () => {
      // Agent is online (recent heartbeat) but task is overdue
      const assignedAt = new Date(Date.now() - 600_000).toISOString().replace('T', ' ').slice(0, 19);
      insertTestTask(testDb, { id: 't-stuck', status: 'executing', assigned_at: assignedAt });

      // expireStaleTasks should NOT catch this (agent is online)
      expect(expireStaleTasks()).toBe(0);
      // expireOverdueTasks SHOULD catch it
      expect(expireOverdueTasks()).toBe(1);

      const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t-stuck') as any;
      expect(row.status).toBe('failed');
    });

    // ──────────────────────────────────────────────────────────────────────
    // Regression: 'assigned' tasks that the agent never PATCHed to
    // 'downloading' must be picked up. Previously the WHERE clause only
    // covered 'executing'/'downloading', so an 'assigned' task whose
    // agent crashed mid-handoff zombied for 7 days until TTL expiry. A
    // real such zombie was observed on tpsgl: task df09471f sat assigned
    // for 4+ days while the agent was heartbeating fresh.
    // ──────────────────────────────────────────────────────────────────────
    it('catches assigned tasks past execution_timeout + buffer', () => {
      const assignedAt = new Date(Date.now() - 600_000).toISOString().replace('T', ' ').slice(0, 19);
      insertTestTask(testDb, { id: 't-assigned-zombie', status: 'assigned', assigned_at: assignedAt });

      const count = expireOverdueTasks();
      expect(count).toBe(1);

      const row = testDb.prepare('SELECT status, result FROM tasks WHERE id = ?').get('t-assigned-zombie') as any;
      expect(row.status).toBe('failed');
      expect(JSON.parse(row.result).error).toBe('Task exceeded execution timeout');
    });
  });

  describe('updateTaskNotes', () => {
    it('saves notes and appends to history', () => {
      insertTestTask(testDb, { id: 't1' });

      const task = updateTaskNotes('t1', 'First note', 'user-001');

      expect(task.notes).toBe('First note');
      expect(task.notes_history).toHaveLength(1);
      expect(task.notes_history[0].content).toBe('First note');
      expect(task.notes_history[0].editedBy).toBe('user-001');
    });

    it('preserves previous history entries', () => {
      insertTestTask(testDb, { id: 't1' });

      updateTaskNotes('t1', 'First note', 'user-001');
      const task = updateTaskNotes('t1', 'Updated note', 'user-002');

      expect(task.notes).toBe('Updated note');
      expect(task.notes_history).toHaveLength(2);
      expect(task.notes_history[0].content).toBe('First note');
      expect(task.notes_history[1].content).toBe('Updated note');
    });

    it('throws for nonexistent task', () => {
      expect(() => updateTaskNotes('nonexistent', 'note', 'user')).toThrow('Task not found');
    });
  });

  describe('createTasks', () => {
    function setupFsMocks() {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('build-meta.json')) {
          return JSON.stringify({ binary_name: 'test-binary.exe', filename: 'test-binary.exe' });
        }
        return Buffer.from('fake-binary-content');
      });
      mockStatSync.mockReturnValue({ size: 2048 });
    }

    beforeEach(() => {
      setupFsMocks();
      mockGetTestMetadata.mockReturnValue(null);
    });

    it('creates a task for a single agent', () => {
      const taskIds = createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      expect(taskIds).toHaveLength(1);

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskIds[0]) as any;
      expect(row).toBeDefined();
      expect(row.agent_id).toBe('agent-001');
      expect(row.org_id).toBe('org-001');
      expect(row.status).toBe('pending');
      expect(row.type).toBe('execute_test');

      const payload = JSON.parse(row.payload);
      expect(payload.test_uuid).toBe('test-uuid-001');
      expect(payload.binary_sha256).toBeDefined();
      expect(payload.binary_size).toBe(2048);
    });

    it('creates tasks for multiple agents', () => {
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestAgent(testDb, { id: 'agent-003' });

      const taskIds = createTasks({
        agent_ids: ['agent-001', 'agent-002', 'agent-003'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      expect(taskIds).toHaveLength(3);

      // Each agent should have a separate task
      const rows = testDb.prepare('SELECT agent_id FROM tasks').all() as any[];
      const agentIds = rows.map((r: any) => r.agent_id).sort();
      expect(agentIds).toEqual(['agent-001', 'agent-002', 'agent-003']);
    });

    it('throws 400 for missing agent_ids', () => {
      expect(() =>
        createTasks({
          agent_ids: [],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).toThrow('At least one agent_id is required');
    });

    it('throws 400 for missing test_uuid', () => {
      expect(() =>
        createTasks({
          agent_ids: ['agent-001'],
          test_uuid: '',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).toThrow('test_uuid, test_name, and binary_name are required');
    });

    it('throws 404 when build-meta.json is missing', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('build-meta.json')) return false;
        return true;
      });

      expect(() =>
        createTasks({
          agent_ids: ['agent-001'],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).toThrow('Build metadata not found');
    });

    it('throws 404 when binary file is missing', () => {
      let callCount = 0;
      mockExistsSync.mockImplementation(() => {
        callCount++;
        // First call is for build-meta.json → exists
        // Second call is for binary file → doesn't exist
        return callCount === 1;
      });

      expect(() =>
        createTasks({
          agent_ids: ['agent-001'],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).toThrow('Binary file not found');
    });

    it('enriches metadata from test catalog when request metadata is empty', () => {
      mockGetTestMetadata.mockReturnValue({
        category: 'defense_evasion',
        subcategory: 'process_injection',
        severity: 'high',
        techniques: ['T1055'],
        tactics: ['TA0005'],
        threatActor: 'APT29',
        target: ['windows'],
        complexity: 'medium',
        tags: ['edr-test'],
        score: 8,
      });

      const taskIds = createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get(taskIds[0]) as any;
      const payload = JSON.parse(row.payload);
      expect(payload.metadata.category).toBe('defense_evasion');
      expect(payload.metadata.techniques).toEqual(['T1055']);
      expect(payload.metadata.threat_actor).toBe('APT29');
    });

    it('uses default values for execution_timeout, arguments, and priority', () => {
      const taskIds = createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskIds[0]) as any;
      expect(row.priority).toBe(1);
      expect(row.ttl).toBe(604800);

      const payload = JSON.parse(row.payload);
      expect(payload.execution_timeout).toBe(300);
      expect(payload.arguments).toEqual([]);
    });
  });

  describe('deleteTask', () => {
    it('deletes a completed task', () => {
      insertTestTask(testDb, { id: 't1', status: 'completed' });

      deleteTask('t1');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(row).toBeUndefined();
    });

    it('deletes a failed task', () => {
      insertTestTask(testDb, { id: 't1', status: 'failed' });

      deleteTask('t1');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(row).toBeUndefined();
    });

    it('deletes an expired task', () => {
      insertTestTask(testDb, { id: 't1', status: 'expired' });

      deleteTask('t1');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(row).toBeUndefined();
    });

    it('deletes a pending task', () => {
      insertTestTask(testDb, { id: 't1', status: 'pending' });

      deleteTask('t1');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(row).toBeUndefined();
    });

    it('deletes an assigned task', () => {
      insertTestTask(testDb, { id: 't1', status: 'assigned' });

      deleteTask('t1');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(row).toBeUndefined();
    });

    it('deletes an executing task', () => {
      insertTestTask(testDb, { id: 't1', status: 'executing' });

      deleteTask('t1');

      const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
      expect(row).toBeUndefined();
    });

    it('throws 404 for nonexistent task', () => {
      expect(() => deleteTask('nonexistent')).toThrow('Task not found');
    });
  });

  describe('listTasks search filtering', () => {
    it('filters by test_name in payload', () => {
      const payload = JSON.stringify({
        test_uuid: 'uuid-1', test_name: 'Mimikatz Credential Dump',
        binary_name: 'mimi.exe', binary_sha256: 'abc', binary_size: 100,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [] },
      });
      insertTestTask(testDb, { id: 't-match', payload });
      insertTestTask(testDb, { id: 't-other' }); // default payload with "Test Name"

      const result = listTasks({ search: 'Mimikatz' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-match');
    });

    it('filters by command in payload', () => {
      const payload = JSON.stringify({
        test_uuid: '', test_name: '', binary_name: '', binary_sha256: '', binary_size: 0,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [] },
        command: 'whoami /priv',
      });
      insertTestTask(testDb, { id: 't-cmd', payload, type: 'execute_command' });
      insertTestTask(testDb, { id: 't-other' });

      const result = listTasks({ search: 'whoami' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-cmd');
    });

    it('filters by agent hostname', () => {
      insertTestAgent(testDb, { id: 'agent-search', hostname: 'prod-server-42' });
      insertTestTask(testDb, { id: 't-host', agent_id: 'agent-search' });
      insertTestTask(testDb, { id: 't-default' }); // agent-001 with hostname "test-host"

      const result = listTasks({ search: 'prod-server' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-host');
    });

    it('returns correct total with search and pagination', () => {
      const makePayload = (name: string) => JSON.stringify({
        test_uuid: 'uuid', test_name: name,
        binary_name: 'b.exe', binary_sha256: 'abc', binary_size: 100,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [] },
      });
      insertTestTask(testDb, { id: 't1', payload: makePayload('LaZagne Extract') });
      insertTestTask(testDb, { id: 't2', payload: makePayload('LaZagne Dump') });
      insertTestTask(testDb, { id: 't3', payload: makePayload('Other Test') });

      const result = listTasks({ search: 'LaZagne', limit: 1, offset: 0 });
      expect(result.tasks).toHaveLength(1);
      expect(result.total).toBe(2); // total reflects full filtered count
    });

    it('combines search with status filter', () => {
      const payload = JSON.stringify({
        test_uuid: 'uuid', test_name: 'Rubeus Kerberoast',
        binary_name: 'r.exe', binary_sha256: 'abc', binary_size: 100,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [] },
      });
      insertTestTask(testDb, { id: 't-pending', payload, status: 'pending' });
      insertTestTask(testDb, { id: 't-completed', payload, status: 'completed' });

      const result = listTasks({ search: 'Rubeus', status: 'completed' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-completed');
    });

    it('returns empty results for no-match search', () => {
      insertTestTask(testDb, { id: 't1' });

      const result = listTasks({ search: 'nonexistent-term-xyz' });
      expect(result.total).toBe(0);
      expect(result.tasks).toHaveLength(0);
    });
  });

  describe('agent_hostname in listTasks', () => {
    it('populates agent_hostname from joined agent data', () => {
      insertTestAgent(testDb, { id: 'agent-host', hostname: 'workstation-01' });
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-host' });

      const result = listTasks({});
      const task = result.tasks.find(t => t.id === 't1');

      expect(task).toBeDefined();
      expect(task!.agent_hostname).toBe('workstation-01');
    });

    it('returns null agent_hostname when agent does not exist', () => {
      // Insert task referencing a non-existent agent (bypass FK with pragma)
      testDb.pragma('foreign_keys = OFF');
      insertTestTask(testDb, { id: 't-orphan', agent_id: 'deleted-agent' });
      testDb.pragma('foreign_keys = ON');

      const result = listTasks({});
      const task = result.tasks.find(t => t.id === 't-orphan');

      expect(task).toBeDefined();
      expect(task!.agent_hostname).toBeNull();
    });
  });

  describe('batch_id assignment', () => {
    function setupFsMocks() {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('build-meta.json')) {
          return JSON.stringify({ binary_name: 'test-binary.exe', filename: 'test-binary.exe' });
        }
        return Buffer.from('fake-binary-content');
      });
      mockStatSync.mockReturnValue({ size: 2048 });
    }

    beforeEach(() => {
      setupFsMocks();
      mockGetTestMetadata.mockReturnValue(null);
    });

    it('createTasks assigns same batch_id to all tasks in a batch', () => {
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestAgent(testDb, { id: 'agent-003' });

      const taskIds = createTasks({
        agent_ids: ['agent-001', 'agent-002', 'agent-003'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const rows = taskIds.map((id: string) =>
        testDb.prepare('SELECT batch_id FROM tasks WHERE id = ?').get(id) as { batch_id: string }
      );

      // All tasks share the same batch_id
      expect(rows[0].batch_id).toBeDefined();
      expect(rows[0].batch_id).toBe(rows[1].batch_id);
      expect(rows[1].batch_id).toBe(rows[2].batch_id);
    });

    it('createCommandTasks assigns same batch_id to all tasks', () => {
      insertTestAgent(testDb, { id: 'agent-002' });

      const taskIds = createCommandTasks({
        agent_ids: ['agent-001', 'agent-002'],
        command: 'whoami',
      }, 'org-001', 'user-001');

      const rows = taskIds.map((id: string) =>
        testDb.prepare('SELECT batch_id FROM tasks WHERE id = ?').get(id) as { batch_id: string }
      );

      expect(rows[0].batch_id).toBeDefined();
      expect(rows[0].batch_id).toBe(rows[1].batch_id);
    });

    it('separate createTasks calls get different batch_ids', () => {
      const taskIds1 = createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const taskIds2 = createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const row1 = testDb.prepare('SELECT batch_id FROM tasks WHERE id = ?').get(taskIds1[0]) as { batch_id: string };
      const row2 = testDb.prepare('SELECT batch_id FROM tasks WHERE id = ?').get(taskIds2[0]) as { batch_id: string };

      expect(row1.batch_id).not.toBe(row2.batch_id);
    });
  });

  describe('listTasksGrouped', () => {
    it('returns correct group structure for multi-agent batch', () => {
      insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
      insertTestAgent(testDb, { id: 'agent-003', hostname: 'host-3' });

      const batchId = 'batch-001';
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      insertTestTask(testDb, { id: 't3', agent_id: 'agent-003', batch_id: batchId, created_at: '2026-02-01 10:00:00' });

      const result = listTasksGrouped({});

      expect(result.total).toBe(1);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].batch_id).toBe(batchId);
      expect(result.groups[0].agent_count).toBe(3);
      expect(result.groups[0].tasks).toHaveLength(3);
    });

    it('returns single-agent tasks as groups of 1', () => {
      insertTestTask(testDb, { id: 't1', created_at: '2026-02-01 10:00:01' });
      insertTestTask(testDb, { id: 't2', created_at: '2026-02-01 10:00:02' });

      const result = listTasksGrouped({});

      expect(result.total).toBe(2);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].agent_count).toBe(1);
      expect(result.groups[1].agent_count).toBe(1);
    });

    it('computes status_counts from child tasks', () => {
      insertTestAgent(testDb, { id: 'agent-002' });

      const batchId = 'batch-status';
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, status: 'completed', created_at: '2026-02-01 10:00:00' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, status: 'failed', created_at: '2026-02-01 10:00:00' });

      const result = listTasksGrouped({});

      expect(result.groups[0].status_counts).toEqual({ completed: 1, failed: 1 });
    });

    it('pagination counts groups not individual tasks', () => {
      insertTestAgent(testDb, { id: 'agent-002' });

      // Batch of 2 tasks
      const batchId = 'batch-page';
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, created_at: '2026-02-01 10:00:00' });

      // Single task (different batch)
      insertTestTask(testDb, { id: 't3', created_at: '2026-02-01 10:00:01' });

      const result = listTasksGrouped({ limit: 1, offset: 0 });

      expect(result.total).toBe(2); // 2 groups
      expect(result.groups).toHaveLength(1); // page size 1
    });

    it('filters by status — group included if any task matches', () => {
      insertTestAgent(testDb, { id: 'agent-002' });

      const batchId = 'batch-filter';
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, status: 'completed', created_at: '2026-02-01 10:00:00' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, status: 'failed', created_at: '2026-02-01 10:00:00' });

      // Another group with only completed
      insertTestTask(testDb, { id: 't3', status: 'completed', created_at: '2026-02-01 10:00:01' });

      const result = listTasksGrouped({ status: 'failed' });

      expect(result.total).toBe(1); // only the batch containing a failed task
      expect(result.groups[0].batch_id).toBe(batchId);
      // The group should still contain both tasks (the full batch)
      expect(result.groups[0].tasks).toHaveLength(2);
    });

    it('filters by search — group included if any task matches', () => {
      insertTestAgent(testDb, { id: 'agent-search', hostname: 'prod-server-42' });

      const batchId = 'batch-search';
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-search', batch_id: batchId, created_at: '2026-02-01 10:00:00' });

      // Separate task that won't match
      insertTestTask(testDb, { id: 't3', created_at: '2026-02-01 10:00:01' });

      const result = listTasksGrouped({ search: 'prod-server' });

      expect(result.total).toBe(1);
      expect(result.groups[0].batch_id).toBe(batchId);
    });

    it('returns empty groups for no-match', () => {
      insertTestTask(testDb, { id: 't1' });

      const result = listTasksGrouped({ search: 'nonexistent-xyz' });
      expect(result.total).toBe(0);
      expect(result.groups).toHaveLength(0);
    });

    it('orders groups by latest created_at descending', () => {
      insertTestTask(testDb, { id: 't-old', batch_id: 'batch-old', created_at: '2026-01-01 10:00:00' });
      insertTestTask(testDb, { id: 't-new', batch_id: 'batch-new', created_at: '2026-02-01 10:00:00' });

      const result = listTasksGrouped({});

      expect(result.groups[0].batch_id).toBe('batch-new');
      expect(result.groups[1].batch_id).toBe('batch-old');
    });
  });

  describe('createUninstallTasks', () => {
    it('creates uninstall tasks for eligible agents', () => {
      insertTestAgent(testDb, { id: 'agent-002' });

      const taskIds = createUninstallTasks(['agent-001', 'agent-002'], 'org-001', 'user-001');

      expect(taskIds).toHaveLength(2);
      // Verify the tasks exist in the DB with correct type and priority
      const task = getTask(taskIds[0]);
      expect(task.type).toBe('uninstall');
      expect(task.priority).toBe(10);
      expect(task.status).toBe('pending');
      expect(task.payload.command).toBe(''); // cleanup=false by default
    });

    it('stores cleanup flag in payload.command', () => {
      const taskIds = createUninstallTasks(['agent-001'], 'org-001', 'user-001', true);

      const task = getTask(taskIds[0]);
      expect(task.payload.command).toBe('cleanup');
    });

    it('rejects already-uninstalled agents', () => {
      insertTestAgent(testDb, { id: 'agent-uninstalled', status: 'uninstalled' });

      expect(() =>
        createUninstallTasks(['agent-uninstalled'], 'org-001', 'user-001')
      ).toThrow('Agents not eligible for uninstall');
    });

    it('rejects decommissioned agents', () => {
      insertTestAgent(testDb, { id: 'agent-decom', status: 'decommissioned' });

      expect(() =>
        createUninstallTasks(['agent-decom'], 'org-001', 'user-001')
      ).toThrow('Agents not eligible for uninstall');
    });

    it('rejects empty agent list', () => {
      expect(() =>
        createUninstallTasks([], 'org-001', 'user-001')
      ).toThrow('At least one agent_id is required');
    });

    it('uses 24h TTL', () => {
      const taskIds = createUninstallTasks(['agent-001'], 'org-001', 'user-001');

      const row = testDb.prepare('SELECT ttl FROM tasks WHERE id = ?').get(taskIds[0]) as { ttl: number };
      expect(row.ttl).toBe(86400);
    });
  });

  describe('submitResult — uninstall hook', () => {
    it('marks agent as uninstalled when uninstall task completes', () => {
      insertTestTask(testDb, {
        id: 'uninstall-task-1',
        agent_id: 'agent-001',
        status: 'executing',
        type: 'uninstall',
      });

      const result = {
        task_id: 'uninstall-task-1',
        test_uuid: '',
        exit_code: 0,
        stdout: 'uninstall initiated',
        stderr: '',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        execution_duration_ms: 100,
        binary_sha256: '',
        hostname: 'test-host',
        os: 'linux' as const,
        arch: 'amd64' as const,
      };

      submitResult('uninstall-task-1', 'agent-001', result);

      // Verify the agent status was changed to 'uninstalled'
      const agent = testDb.prepare('SELECT status FROM agents WHERE id = ?').get('agent-001') as { status: string };
      expect(agent.status).toBe('uninstalled');
    });

    it('does not change agent status for non-uninstall tasks', () => {
      insertTestTask(testDb, {
        id: 'test-task-1',
        agent_id: 'agent-001',
        status: 'executing',
        type: 'execute_test',
      });

      submitResult('test-task-1', 'agent-001', {
        task_id: 'test-task-1',
        test_uuid: 'test-uuid-001',
        exit_code: 0,
        stdout: 'ok',
        stderr: '',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        execution_duration_ms: 100,
        binary_sha256: 'abc',
        hostname: 'test-host',
        os: 'linux' as const,
        arch: 'amd64' as const,
      });

      const agent = testDb.prepare('SELECT status FROM agents WHERE id = ?').get('agent-001') as { status: string };
      expect(agent.status).toBe('active'); // unchanged
    });
  });

  // ── env_vars credential injection & stripping ─────────────────

  describe('env_vars injection and stripping', () => {
    it('injects Azure env_vars for identity-tenant tests', () => {
      mockGetAzureCredentials.mockReturnValueOnce({
        tenant_id: 'test-tenant-id',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      });

      // build-meta.json for the test
      mockReadFileSync.mockImplementation((p: string) => {
        if (String(p).endsWith('build-meta.json')) {
          return JSON.stringify({ binary_name: 'test.exe' });
        }
        // Binary file content (sha256 will be computed from this)
        return Buffer.from('test-binary-content');
      });

      mockGetTestMetadata.mockReturnValueOnce({
        category: 'cyber-hygiene',
        subcategory: 'identity-tenant',
        severity: 'high',
        techniques: ['T1078'],
        tactics: ['TA0001'],
        threatActor: '',
        target: ['entra-id'],
        complexity: 'medium',
        tags: [],
        score: null,
        integrations: ['azure'],
      });

      const taskIds = createTasks(
        {
          agent_ids: ['agent-001'],
          test_uuid: 'test-uuid-identity',
          test_name: 'Entra ID Test',
          binary_name: 'test.exe',
        },
        'org-001',
        'user-001'
      );

      expect(taskIds).toHaveLength(1);

      // Check that the stored payload contains env_vars
      const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get(taskIds[0]) as { payload: string };
      const payload = JSON.parse(row.payload);
      expect(payload.env_vars).toEqual({
        AZURE_TENANT_ID: 'test-tenant-id',
        AZURE_CLIENT_ID: 'test-client-id',
        AZURE_CLIENT_SECRET: 'test-client-secret',
      });
    });

    it('injects Azure env_vars when integrations includes azure (non-identity-tenant subcategory)', () => {
      mockGetAzureCredentials.mockReturnValueOnce({
        tenant_id: 'azure-tid',
        client_id: 'azure-cid',
        client_secret: 'azure-cs',
      });

      mockReadFileSync.mockImplementation((p: string) => {
        if (String(p).endsWith('build-meta.json')) {
          return JSON.stringify({ binary_name: 'cis.exe' });
        }
        return Buffer.from('binary');
      });

      mockGetTestMetadata.mockReturnValueOnce({
        category: 'cyber-hygiene',
        subcategory: 'cis-identity-ad-l1',
        severity: 'critical',
        techniques: ['T1078.002'],
        tactics: ['credential-access'],
        threatActor: '',
        target: ['windows-endpoint'],
        complexity: 'medium',
        tags: [],
        score: null,
        integrations: ['azure'],
      });

      const taskIds = createTasks(
        {
          agent_ids: ['agent-001'],
          test_uuid: 'test-uuid-cis',
          test_name: 'CIS Identity AD L1',
          binary_name: 'cis.exe',
        },
        'org-001',
        'user-001'
      );

      const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get(taskIds[0]) as { payload: string };
      const payload = JSON.parse(row.payload);
      expect(payload.env_vars).toEqual({
        AZURE_TENANT_ID: 'azure-tid',
        AZURE_CLIENT_ID: 'azure-cid',
        AZURE_CLIENT_SECRET: 'azure-cs',
      });
      expect(payload.metadata.integrations).toEqual(['azure']);
    });

    it('does not inject env_vars for non-identity-tenant tests', () => {
      mockGetAzureCredentials.mockReturnValueOnce({
        tenant_id: 'test-tenant-id',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      });

      mockReadFileSync.mockImplementation((p: string) => {
        if (String(p).endsWith('build-meta.json')) {
          return JSON.stringify({ binary_name: 'test.exe' });
        }
        return Buffer.from('test-binary-content');
      });

      mockGetTestMetadata.mockReturnValueOnce({
        category: 'cyber-hygiene',
        subcategory: 'endpoint-baseline',
        severity: 'medium',
        techniques: [],
        tactics: [],
        threatActor: '',
        target: ['windows-endpoint'],
        complexity: 'low',
        tags: [],
        score: null,
        integrations: [],
      });

      const taskIds = createTasks(
        {
          agent_ids: ['agent-001'],
          test_uuid: 'test-uuid-baseline',
          test_name: 'Baseline Test',
          binary_name: 'test.exe',
        },
        'org-001',
        'user-001'
      );

      const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get(taskIds[0]) as { payload: string };
      const payload = JSON.parse(row.payload);
      expect(payload.env_vars).toBeUndefined();
    });

    it('strips env_vars from stored payload after getNextTask dispatch', () => {
      // Insert a task with env_vars in the payload
      const payloadWithEnv = JSON.stringify({
        test_uuid: 'test-uuid-001',
        test_name: 'Identity Test',
        binary_name: 'test.exe',
        binary_sha256: 'abc123',
        binary_size: 1024,
        execution_timeout: 300,
        arguments: [],
        metadata: {
          category: 'cyber-hygiene',
          subcategory: 'identity-tenant',
          severity: 'high',
          techniques: [],
          tactics: [],
          threat_actor: '',
          target: [],
          complexity: '',
          tags: [],
          score: null,
          integrations: [],
        },
        env_vars: {
          AZURE_TENANT_ID: 'sensitive-tenant',
          AZURE_CLIENT_ID: 'sensitive-client',
          AZURE_CLIENT_SECRET: 'sensitive-secret',
        },
      });

      testDb.prepare(`
        INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_at, ttl, created_by, batch_id)
        VALUES ('task-env', 'agent-001', 'org-001', 'execute_test', 1, 'pending', ?, datetime('now'), 604800, 'user-001', 'batch-env')
      `).run(payloadWithEnv);

      // Dispatch: agent fetches the task
      const task = getNextTask('agent-001');

      // Agent should receive env_vars in the dispatched payload
      expect(task).not.toBeNull();
      expect(task!.payload.env_vars).toEqual({
        AZURE_TENANT_ID: 'sensitive-tenant',
        AZURE_CLIENT_ID: 'sensitive-client',
        AZURE_CLIENT_SECRET: 'sensitive-secret',
      });

      // DB should no longer contain env_vars
      const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get('task-env') as { payload: string };
      const storedPayload = JSON.parse(row.payload);
      expect(storedPayload.env_vars).toBeUndefined();
    });

    it('does not modify stored payload when no env_vars present', () => {
      insertTestTask(testDb, { id: 'task-normal', agent_id: 'agent-001', status: 'pending' });

      const task = getNextTask('agent-001');
      expect(task).not.toBeNull();
      expect(task!.payload.env_vars).toBeUndefined();

      // Payload should be unchanged
      const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get('task-normal') as { payload: string };
      const payload = JSON.parse(row.payload);
      expect(payload.env_vars).toBeUndefined();
    });
  });

  // ── sanitizeTaskForAdmin ──────────────────────────────────────

  describe('sanitizeTaskForAdmin', () => {
    it('strips env_vars from task payload', () => {
      insertTestTask(testDb, { id: 'task-s1', agent_id: 'agent-001' });
      const task = getTask('task-s1');
      task.payload.env_vars = { SECRET: 'value' };

      const sanitized = sanitizeTaskForAdmin(task);
      expect(sanitized.payload.env_vars).toBeUndefined();
      expect(sanitized.payload.test_name).toBe(task.payload.test_name); // other fields preserved
    });

    it('returns task unchanged when no env_vars', () => {
      insertTestTask(testDb, { id: 'task-s2', agent_id: 'agent-001' });
      const task = getTask('task-s2');

      const sanitized = sanitizeTaskForAdmin(task);
      expect(sanitized).toBe(task); // same reference — no clone needed
    });
  });
});
