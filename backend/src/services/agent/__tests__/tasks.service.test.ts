import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', () => ({
  getDatabase: () => testDb,
}));

// Mock the test-catalog service (used for metadata enrichment in createTasks)
vi.mock('../test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

const {
  getNextTask,
  updateTaskStatus,
  submitResult,
  listTasks,
  getTask,
  cancelTask,
  expireOldTasks,
  updateTaskNotes,
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
});
