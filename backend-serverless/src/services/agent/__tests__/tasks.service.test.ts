import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DbHelper } from '../database.js';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: DbHelper;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return {
    ...actual,
    getDb: async () => testDb,
  };
});

// Mock the test-catalog service (used for metadata enrichment in createTasks)
const mockGetTestMetadata = vi.fn().mockReturnValue(null);
vi.mock('../test-catalog.service.js', () => ({
  getTestMetadata: (...args: unknown[]) => mockGetTestMetadata(...args),
}));

// Mock Blob storage for createTasks (reads build metadata and binary from Blob)
const mockBlobReadText = vi.fn();
const mockBlobRead = vi.fn();

vi.mock('../../storage.js', () => ({
  blobReadText: (...args: unknown[]) => mockBlobReadText(...args),
  blobRead: (...args: unknown[]) => mockBlobRead(...args),
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
  updateTaskNotes,
} = await import('../tasks.service.js');

describe('tasks.service', () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await insertTestAgent(testDb, { id: 'agent-001' });
  });

  describe('getNextTask', () => {
    it('returns the next pending task for an agent', async () => {
      await insertTestTask(testDb, { id: 'task-001', agent_id: 'agent-001', status: 'pending' });

      const task = await getNextTask('agent-001');

      expect(task).not.toBeNull();
      expect(task!.id).toBe('task-001');
      expect(task!.status).toBe('assigned');
    });

    it('returns null when no pending tasks exist', async () => {
      const task = await getNextTask('agent-001');
      expect(task).toBeNull();
    });

    it('assigns highest priority task first', async () => {
      await insertTestTask(testDb, { id: 'low', agent_id: 'agent-001', priority: 1 });
      await insertTestTask(testDb, { id: 'high', agent_id: 'agent-001', priority: 10 });

      const task = await getNextTask('agent-001');
      expect(task!.id).toBe('high');
    });

    it('does not return tasks for other agents', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestTask(testDb, { id: 'task-other', agent_id: 'agent-002' });

      const task = await getNextTask('agent-001');
      expect(task).toBeNull();
    });

    it('marks retrieved task as assigned', async () => {
      await insertTestTask(testDb, { id: 'task-001', agent_id: 'agent-001' });

      await getNextTask('agent-001');

      const row = await testDb.get('SELECT status FROM tasks WHERE id = ?', ['task-001']) as unknown as any;
      expect(row.status).toBe('assigned');
    });
  });

  describe('updateTaskStatus', () => {
    it('transitions assigned -> downloading', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      const task = await updateTaskStatus('t1', 'agent-001', 'downloading');
      expect(task.status).toBe('downloading');
    });

    it('transitions downloading -> executing', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'downloading' });

      const task = await updateTaskStatus('t1', 'agent-001', 'executing');
      expect(task.status).toBe('executing');
    });

    it('transitions executing -> completed', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const task = await updateTaskStatus('t1', 'agent-001', 'completed');
      expect(task.status).toBe('completed');
      expect(task.completed_at).toBeDefined();
    });

    it('transitions executing -> failed', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const task = await updateTaskStatus('t1', 'agent-001', 'failed');
      expect(task.status).toBe('failed');
    });

    it('rejects invalid state transition', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'pending' });

      await expect(updateTaskStatus('t1', 'agent-001', 'completed')).rejects.toThrow(
        'Invalid state transition: pending -> completed'
      );
    });

    it('rejects update from wrong agent', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      await expect(updateTaskStatus('t1', 'agent-002', 'downloading')).rejects.toThrow(
        'Agent does not own this task'
      );
    });

    it('throws for nonexistent task', async () => {
      await expect(updateTaskStatus('nonexistent', 'agent-001', 'assigned')).rejects.toThrow(
        'Task not found'
      );
    });
  });

  describe('submitResult', () => {
    it('saves result and marks task completed', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

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

      const task = await submitResult('t1', 'agent-001', result);
      expect(task.status).toBe('completed');
      expect(task.result).toBeDefined();
      expect(task.result!.exit_code).toBe(0);
    });

    it('rejects submission for wrong status', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'pending' });

      await expect(
        submitResult('t1', 'agent-001', { exit_code: 0 } as any)
      ).rejects.toThrow('Cannot submit result');
    });

    it('rejects submission from wrong agent', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      await expect(
        submitResult('t1', 'agent-002', { exit_code: 0 } as any)
      ).rejects.toThrow('Agent does not own this task');
    });
  });

  describe('listTasks', () => {
    it('returns tasks with pagination', async () => {
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-001' });

      const result = await listTasks({});
      expect(result.total).toBe(2);
      expect(result.tasks).toHaveLength(2);
    });

    it('filters by status', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'pending' });
      await insertTestTask(testDb, { id: 't2', status: 'completed' });

      const result = await listTasks({ status: 'pending' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t1');
    });

    it('filters by agent_id', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-002' });

      const result = await listTasks({ agent_id: 'agent-001' });
      expect(result.total).toBe(1);
    });

    it('supports pagination', async () => {
      await insertTestTask(testDb, { id: 't1' });
      await insertTestTask(testDb, { id: 't2' });
      await insertTestTask(testDb, { id: 't3' });

      const page1 = await listTasks({ limit: 2, offset: 0 });
      expect(page1.tasks).toHaveLength(2);

      const page2 = await listTasks({ limit: 2, offset: 2 });
      expect(page2.tasks).toHaveLength(1);
    });
  });

  describe('getTask', () => {
    it('returns a task by ID', async () => {
      await insertTestTask(testDb, { id: 'task-001' });

      const task = await getTask('task-001');
      expect(task.id).toBe('task-001');
      expect(task.payload).toBeDefined();
    });

    it('throws for nonexistent task', async () => {
      await expect(getTask('nonexistent')).rejects.toThrow('Task not found');
    });
  });

  describe('cancelTask', () => {
    it('cancels a pending task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'pending' });

      const task = await cancelTask('t1');
      expect(task.status).toBe('expired');
    });

    it('cancels an assigned task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'assigned' });

      const task = await cancelTask('t1');
      expect(task.status).toBe('expired');
    });

    it('rejects cancellation of completed task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'completed' });

      await expect(cancelTask('t1')).rejects.toThrow('Cannot cancel task');
    });

    it('rejects cancellation of failed task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'failed' });

      await expect(cancelTask('t1')).rejects.toThrow('Cannot cancel task');
    });
  });

  describe('expireOldTasks', () => {
    it('expires tasks past their TTL', async () => {
      // Insert task with 0 TTL (should expire immediately)
      await testDb.run(`
        INSERT INTO tasks (id, agent_id, org_id, type, status, payload, created_at, ttl, created_by)
        VALUES ('t-old', 'agent-001', 'org-001', 'execute_test', 'pending', '{}',
                datetime('now', '-2 days'), 1, 'user')
      `);

      const count = await expireOldTasks();
      expect(count).toBe(1);

      const row = await testDb.get('SELECT status FROM tasks WHERE id = ?', ['t-old']) as unknown as any;
      expect(row.status).toBe('expired');
    });

    it('does not expire tasks within their TTL', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'pending', ttl: 604800 }); // 7 day TTL

      const count = await expireOldTasks();
      expect(count).toBe(0);
    });
  });

  describe('expireStaleTasks', () => {
    it('fails executing tasks when agent is offline', async () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      await insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      await insertTestTask(testDb, { id: 't-stale', agent_id: 'offline-agent', status: 'executing' });

      const count = await expireStaleTasks();
      expect(count).toBe(1);

      const row = await testDb.get('SELECT status, result FROM tasks WHERE id = ?', ['t-stale']) as unknown as any;
      expect(row.status).toBe('failed');
      expect(JSON.parse(row.result)).toEqual({ error: 'Agent went offline during execution' });
    });

    it('fails downloading tasks when agent is offline', async () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      await insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      await insertTestTask(testDb, { id: 't-dl', agent_id: 'offline-agent', status: 'downloading' });

      const count = await expireStaleTasks();
      expect(count).toBe(1);

      const row = await testDb.get('SELECT status FROM tasks WHERE id = ?', ['t-dl']) as unknown as any;
      expect(row.status).toBe('failed');
    });

    it('does not fail tasks when agent is still online', async () => {
      await insertTestTask(testDb, { id: 't-active', agent_id: 'agent-001', status: 'executing' });

      const count = await expireStaleTasks();
      expect(count).toBe(0);

      const row = await testDb.get('SELECT status FROM tasks WHERE id = ?', ['t-active']) as unknown as any;
      expect(row.status).toBe('executing');
    });

    it('does not affect pending or assigned tasks', async () => {
      const staleHeartbeat = new Date(Date.now() - 600_000).toISOString();
      await insertTestAgent(testDb, { id: 'offline-agent', last_heartbeat: staleHeartbeat });
      await insertTestTask(testDb, { id: 't-pending', agent_id: 'offline-agent', status: 'pending' });
      await insertTestTask(testDb, { id: 't-assigned', agent_id: 'offline-agent', status: 'assigned' });

      const count = await expireStaleTasks();
      expect(count).toBe(0);
    });

    it('fails tasks when agent has null heartbeat', async () => {
      await insertTestAgent(testDb, { id: 'no-hb-agent', last_heartbeat: '' });
      await testDb.run("UPDATE agents SET last_heartbeat = NULL WHERE id = 'no-hb-agent'");
      await insertTestTask(testDb, { id: 't-nohb', agent_id: 'no-hb-agent', status: 'executing' });

      const count = await expireStaleTasks();
      expect(count).toBe(1);
    });
  });

  describe('updateTaskNotes', () => {
    it('saves notes and appends to history', async () => {
      await insertTestTask(testDb, { id: 't1' });

      const task = await updateTaskNotes('t1', 'First note', 'user-001');

      expect(task.notes).toBe('First note');
      expect(task.notes_history).toHaveLength(1);
      expect(task.notes_history[0].content).toBe('First note');
      expect(task.notes_history[0].editedBy).toBe('user-001');
    });

    it('preserves previous history entries', async () => {
      await insertTestTask(testDb, { id: 't1' });

      await updateTaskNotes('t1', 'First note', 'user-001');
      const task = await updateTaskNotes('t1', 'Updated note', 'user-002');

      expect(task.notes).toBe('Updated note');
      expect(task.notes_history).toHaveLength(2);
      expect(task.notes_history[0].content).toBe('First note');
      expect(task.notes_history[1].content).toBe('Updated note');
    });

    it('throws for nonexistent task', async () => {
      await expect(updateTaskNotes('nonexistent', 'note', 'user')).rejects.toThrow('Task not found');
    });
  });

  describe('createTasks', () => {
    function setupBlobMocks() {
      mockBlobReadText.mockResolvedValue(
        JSON.stringify({ binary_name: 'test-binary.exe', filename: 'test-binary.exe' }),
      );
      mockBlobRead.mockResolvedValue(Buffer.from('fake-binary-content'));
    }

    beforeEach(() => {
      setupBlobMocks();
      mockGetTestMetadata.mockReturnValue(null);
    });

    it('creates a task for a single agent', async () => {
      const taskIds = await createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      expect(taskIds).toHaveLength(1);

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', [taskIds[0]]) as unknown as any;
      expect(row).toBeDefined();
      expect(row.agent_id).toBe('agent-001');
      expect(row.org_id).toBe('org-001');
      expect(row.status).toBe('pending');
      expect(row.type).toBe('execute_test');

      const payload = JSON.parse(row.payload);
      expect(payload.test_uuid).toBe('test-uuid-001');
      expect(payload.binary_sha256).toBeDefined();
      expect(payload.binary_size).toBe(Buffer.from('fake-binary-content').length);
    });

    it('creates tasks for multiple agents', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestAgent(testDb, { id: 'agent-003' });

      const taskIds = await createTasks({
        agent_ids: ['agent-001', 'agent-002', 'agent-003'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      expect(taskIds).toHaveLength(3);

      // Each agent should have a separate task
      const rows = await testDb.all('SELECT agent_id FROM tasks') as unknown as any[];
      const agentIds = rows.map((r: any) => r.agent_id).sort();
      expect(agentIds).toEqual(['agent-001', 'agent-002', 'agent-003']);
    });

    it('throws 400 for missing agent_ids', async () => {
      await expect(
        createTasks({
          agent_ids: [],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).rejects.toThrow('At least one agent_id is required');
    });

    it('throws 400 for missing test_uuid', async () => {
      await expect(
        createTasks({
          agent_ids: ['agent-001'],
          test_uuid: '',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).rejects.toThrow('test_uuid, test_name, and binary_name are required');
    });

    it('throws 404 when build-meta.json is missing from Blob', async () => {
      mockBlobReadText.mockResolvedValue(null);

      await expect(
        createTasks({
          agent_ids: ['agent-001'],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).rejects.toThrow('Build metadata not found');
    });

    it('throws 404 when binary file is missing from Blob', async () => {
      mockBlobReadText.mockResolvedValue(
        JSON.stringify({ filename: 'bin.exe' }),
      );
      mockBlobRead.mockResolvedValue(null);

      await expect(
        createTasks({
          agent_ids: ['agent-001'],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        }, 'org-001', 'user-001')
      ).rejects.toThrow('Binary file not found');
    });

    it('enriches metadata from test catalog when request metadata is empty', async () => {
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

      const taskIds = await createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const row = await testDb.get('SELECT payload FROM tasks WHERE id = ?', [taskIds[0]]) as unknown as any;
      const payload = JSON.parse(row.payload);
      expect(payload.metadata.category).toBe('defense_evasion');
      expect(payload.metadata.techniques).toEqual(['T1055']);
      expect(payload.metadata.threat_actor).toBe('APT29');
    });

    it('uses default values for execution_timeout, arguments, and priority', async () => {
      const taskIds = await createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', [taskIds[0]]) as unknown as any;
      expect(row.priority).toBe(1);
      expect(row.ttl).toBe(604800);

      const payload = JSON.parse(row.payload);
      expect(payload.execution_timeout).toBe(300);
      expect(payload.arguments).toEqual([]);
    });
  });

  describe('deleteTask', () => {
    it('deletes a completed task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'completed' });

      await deleteTask('t1');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', ['t1']);
      expect(row).toBeUndefined();
    });

    it('deletes a failed task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'failed' });

      await deleteTask('t1');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', ['t1']);
      expect(row).toBeUndefined();
    });

    it('deletes an expired task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'expired' });

      await deleteTask('t1');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', ['t1']);
      expect(row).toBeUndefined();
    });

    it('deletes a pending task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'pending' });

      await deleteTask('t1');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', ['t1']);
      expect(row).toBeUndefined();
    });

    it('deletes an assigned task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'assigned' });

      await deleteTask('t1');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', ['t1']);
      expect(row).toBeUndefined();
    });

    it('deletes an executing task', async () => {
      await insertTestTask(testDb, { id: 't1', status: 'executing' });

      await deleteTask('t1');

      const row = await testDb.get('SELECT * FROM tasks WHERE id = ?', ['t1']);
      expect(row).toBeUndefined();
    });

    it('throws 404 for nonexistent task', async () => {
      await expect(deleteTask('nonexistent')).rejects.toThrow('Task not found');
    });
  });

  describe('listTasks search filtering', () => {
    it('filters by test_name in payload', async () => {
      const payload = JSON.stringify({
        test_uuid: 'uuid-1', test_name: 'Mimikatz Credential Dump',
        binary_name: 'mimi.exe', binary_sha256: 'abc', binary_size: 100,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null },
      });
      await insertTestTask(testDb, { id: 't-match', payload });
      await insertTestTask(testDb, { id: 't-other' }); // default payload with "Test Name"

      const result = await listTasks({ search: 'Mimikatz' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-match');
    });

    it('filters by command in payload', async () => {
      const payload = JSON.stringify({
        test_uuid: '', test_name: '', binary_name: '', binary_sha256: '', binary_size: 0,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null },
        command: 'whoami /priv',
      });
      await insertTestTask(testDb, { id: 't-cmd', payload, type: 'execute_command' });
      await insertTestTask(testDb, { id: 't-other' });

      const result = await listTasks({ search: 'whoami' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-cmd');
    });

    it('filters by agent hostname', async () => {
      await insertTestAgent(testDb, { id: 'agent-search', hostname: 'prod-server-42' });
      await insertTestTask(testDb, { id: 't-host', agent_id: 'agent-search' });
      await insertTestTask(testDb, { id: 't-default' }); // agent-001 with hostname "test-host"

      const result = await listTasks({ search: 'prod-server' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-host');
    });

    it('returns correct total with search and pagination', async () => {
      const makePayload = (name: string) => JSON.stringify({
        test_uuid: 'uuid', test_name: name,
        binary_name: 'b.exe', binary_sha256: 'abc', binary_size: 100,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null },
      });
      await insertTestTask(testDb, { id: 't1', payload: makePayload('LaZagne Extract') });
      await insertTestTask(testDb, { id: 't2', payload: makePayload('LaZagne Dump') });
      await insertTestTask(testDb, { id: 't3', payload: makePayload('Other Test') });

      const result = await listTasks({ search: 'LaZagne', limit: 1, offset: 0 });
      expect(result.tasks).toHaveLength(1);
      expect(result.total).toBe(2); // total reflects full filtered count
    });

    it('combines search with status filter', async () => {
      const payload = JSON.stringify({
        test_uuid: 'uuid', test_name: 'Rubeus Kerberoast',
        binary_name: 'r.exe', binary_sha256: 'abc', binary_size: 100,
        execution_timeout: 300, arguments: [],
        metadata: { category: '', subcategory: '', severity: '', techniques: [], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null },
      });
      await insertTestTask(testDb, { id: 't-pending', payload, status: 'pending' });
      await insertTestTask(testDb, { id: 't-completed', payload, status: 'completed' });

      const result = await listTasks({ search: 'Rubeus', status: 'completed' });
      expect(result.total).toBe(1);
      expect(result.tasks[0].id).toBe('t-completed');
    });

    it('returns empty results for no-match search', async () => {
      await insertTestTask(testDb, { id: 't1' });

      const result = await listTasks({ search: 'nonexistent-term-xyz' });
      expect(result.total).toBe(0);
      expect(result.tasks).toHaveLength(0);
    });
  });

  describe('agent_hostname in listTasks', () => {
    it('populates agent_hostname from joined agent data', async () => {
      await insertTestAgent(testDb, { id: 'agent-host', hostname: 'workstation-01' });
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-host' });

      const result = await listTasks({});
      const task = result.tasks.find(t => t.id === 't1');

      expect(task).toBeDefined();
      expect(task!.agent_hostname).toBe('workstation-01');
    });

    it('returns null agent_hostname when agent does not exist', async () => {
      // Insert task referencing a non-existent agent (bypass FK with pragma)
      await testDb.run('PRAGMA foreign_keys = OFF');
      await insertTestTask(testDb, { id: 't-orphan', agent_id: 'deleted-agent' });
      await testDb.run('PRAGMA foreign_keys = ON');

      const result = await listTasks({});
      const task = result.tasks.find(t => t.id === 't-orphan');

      expect(task).toBeDefined();
      expect(task!.agent_hostname).toBeNull();
    });
  });

  describe('batch_id assignment', () => {
    function setupBlobMocksForBatch() {
      mockBlobReadText.mockResolvedValue(
        JSON.stringify({ binary_name: 'test-binary.exe', filename: 'test-binary.exe' }),
      );
      mockBlobRead.mockResolvedValue(Buffer.from('fake-binary-content'));
    }

    beforeEach(() => {
      setupBlobMocksForBatch();
      mockGetTestMetadata.mockReturnValue(null);
    });

    it('createTasks assigns same batch_id to all tasks in a batch', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestAgent(testDb, { id: 'agent-003' });

      const taskIds = await createTasks({
        agent_ids: ['agent-001', 'agent-002', 'agent-003'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const rows: { batch_id: string }[] = [];
      for (const id of taskIds) {
        const row = await testDb.get('SELECT batch_id FROM tasks WHERE id = ?', [id]) as unknown as { batch_id: string };
        rows.push(row);
      }

      // All tasks share the same batch_id
      expect(rows[0].batch_id).toBeDefined();
      expect(rows[0].batch_id).toBe(rows[1].batch_id);
      expect(rows[1].batch_id).toBe(rows[2].batch_id);
    });

    it('createCommandTasks assigns same batch_id to all tasks', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });

      const taskIds = await createCommandTasks({
        agent_ids: ['agent-001', 'agent-002'],
        command: 'whoami',
      }, 'org-001', 'user-001');

      const rows: { batch_id: string }[] = [];
      for (const id of taskIds) {
        const row = await testDb.get('SELECT batch_id FROM tasks WHERE id = ?', [id]) as unknown as { batch_id: string };
        rows.push(row);
      }

      expect(rows[0].batch_id).toBeDefined();
      expect(rows[0].batch_id).toBe(rows[1].batch_id);
    });

    it('separate createTasks calls get different batch_ids', async () => {
      const taskIds1 = await createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const taskIds2 = await createTasks({
        agent_ids: ['agent-001'],
        test_uuid: 'test-uuid-001',
        test_name: 'Test One',
        binary_name: 'test-binary.exe',
      }, 'org-001', 'user-001');

      const row1 = await testDb.get('SELECT batch_id FROM tasks WHERE id = ?', [taskIds1[0]]) as unknown as { batch_id: string };
      const row2 = await testDb.get('SELECT batch_id FROM tasks WHERE id = ?', [taskIds2[0]]) as unknown as { batch_id: string };

      expect(row1.batch_id).not.toBe(row2.batch_id);
    });
  });

  describe('listTasksGrouped', () => {
    it('returns correct group structure for multi-agent batch', async () => {
      await insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
      await insertTestAgent(testDb, { id: 'agent-003', hostname: 'host-3' });

      const batchId = 'batch-001';
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      await insertTestTask(testDb, { id: 't3', agent_id: 'agent-003', batch_id: batchId, created_at: '2026-02-01 10:00:00' });

      const result = await listTasksGrouped({});

      expect(result.total).toBe(1);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].batch_id).toBe(batchId);
      expect(result.groups[0].agent_count).toBe(3);
      expect(result.groups[0].tasks).toHaveLength(3);
    });

    it('returns single-agent tasks as groups of 1', async () => {
      await insertTestTask(testDb, { id: 't1', created_at: '2026-02-01 10:00:01' });
      await insertTestTask(testDb, { id: 't2', created_at: '2026-02-01 10:00:02' });

      const result = await listTasksGrouped({});

      expect(result.total).toBe(2);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].agent_count).toBe(1);
      expect(result.groups[1].agent_count).toBe(1);
    });

    it('computes status_counts from child tasks', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });

      const batchId = 'batch-status';
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, status: 'completed', created_at: '2026-02-01 10:00:00' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, status: 'failed', created_at: '2026-02-01 10:00:00' });

      const result = await listTasksGrouped({});

      expect(result.groups[0].status_counts).toEqual({ completed: 1, failed: 1 });
    });

    it('pagination counts groups not individual tasks', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });

      // Batch of 2 tasks
      const batchId = 'batch-page';
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, created_at: '2026-02-01 10:00:00' });

      // Single task (different batch)
      await insertTestTask(testDb, { id: 't3', created_at: '2026-02-01 10:00:01' });

      const result = await listTasksGrouped({ limit: 1, offset: 0 });

      expect(result.total).toBe(2); // 2 groups
      expect(result.groups).toHaveLength(1); // page size 1
    });

    it('filters by status — group included if any task matches', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });

      const batchId = 'batch-filter';
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, status: 'completed', created_at: '2026-02-01 10:00:00' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', batch_id: batchId, status: 'failed', created_at: '2026-02-01 10:00:00' });

      // Another group with only completed
      await insertTestTask(testDb, { id: 't3', status: 'completed', created_at: '2026-02-01 10:00:01' });

      const result = await listTasksGrouped({ status: 'failed' });

      expect(result.total).toBe(1); // only the batch containing a failed task
      expect(result.groups[0].batch_id).toBe(batchId);
      // The group should still contain both tasks (the full batch)
      expect(result.groups[0].tasks).toHaveLength(2);
    });

    it('filters by search — group included if any task matches', async () => {
      await insertTestAgent(testDb, { id: 'agent-search', hostname: 'prod-server-42' });

      const batchId = 'batch-search';
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', batch_id: batchId, created_at: '2026-02-01 10:00:00' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-search', batch_id: batchId, created_at: '2026-02-01 10:00:00' });

      // Separate task that won't match
      await insertTestTask(testDb, { id: 't3', created_at: '2026-02-01 10:00:01' });

      const result = await listTasksGrouped({ search: 'prod-server' });

      expect(result.total).toBe(1);
      expect(result.groups[0].batch_id).toBe(batchId);
    });

    it('returns empty groups for no-match', async () => {
      await insertTestTask(testDb, { id: 't1' });

      const result = await listTasksGrouped({ search: 'nonexistent-xyz' });
      expect(result.total).toBe(0);
      expect(result.groups).toHaveLength(0);
    });

    it('orders groups by latest created_at descending', async () => {
      await insertTestTask(testDb, { id: 't-old', batch_id: 'batch-old', created_at: '2026-01-01 10:00:00' });
      await insertTestTask(testDb, { id: 't-new', batch_id: 'batch-new', created_at: '2026-02-01 10:00:00' });

      const result = await listTasksGrouped({});

      expect(result.groups[0].batch_id).toBe('batch-new');
      expect(result.groups[1].batch_id).toBe('batch-old');
    });
  });

  describe('createUninstallTasks', () => {
    it('creates uninstall tasks for eligible agents', async () => {
      await insertTestAgent(testDb, { id: 'agent-002' });

      const taskIds = await createUninstallTasks(['agent-001', 'agent-002'], 'org-001', 'user-001');

      expect(taskIds).toHaveLength(2);
      const task = await getTask(taskIds[0]);
      expect(task.type).toBe('uninstall');
      expect(task.priority).toBe(10);
      expect(task.status).toBe('pending');
      expect(task.payload.command).toBe('');
    });

    it('stores cleanup flag in payload.command', async () => {
      const taskIds = await createUninstallTasks(['agent-001'], 'org-001', 'user-001', true);

      const task = await getTask(taskIds[0]);
      expect(task.payload.command).toBe('cleanup');
    });

    it('rejects already-uninstalled agents', async () => {
      await insertTestAgent(testDb, { id: 'agent-uninstalled', status: 'uninstalled' });

      await expect(
        createUninstallTasks(['agent-uninstalled'], 'org-001', 'user-001')
      ).rejects.toThrow('Agents not eligible for uninstall');
    });

    it('rejects decommissioned agents', async () => {
      await insertTestAgent(testDb, { id: 'agent-decom', status: 'decommissioned' });

      await expect(
        createUninstallTasks(['agent-decom'], 'org-001', 'user-001')
      ).rejects.toThrow('Agents not eligible for uninstall');
    });

    it('rejects empty agent list', async () => {
      await expect(
        createUninstallTasks([], 'org-001', 'user-001')
      ).rejects.toThrow('At least one agent_id is required');
    });

    it('uses 24h TTL', async () => {
      const taskIds = await createUninstallTasks(['agent-001'], 'org-001', 'user-001');

      const rows = await testDb.all('SELECT ttl FROM tasks WHERE id = ?', [taskIds[0]]);
      expect((rows[0] as { ttl: number }).ttl).toBe(86400);
    });
  });

  describe('submitResult — uninstall hook', () => {
    it('marks agent as uninstalled when uninstall task completes', async () => {
      await insertTestTask(testDb, {
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

      await submitResult('uninstall-task-1', 'agent-001', result);

      const rows = await testDb.all('SELECT status FROM agents WHERE id = ?', ['agent-001']);
      expect((rows[0] as { status: string }).status).toBe('uninstalled');
    });

    it('does not change agent status for non-uninstall tasks', async () => {
      await insertTestTask(testDb, {
        id: 'test-task-1',
        agent_id: 'agent-001',
        status: 'executing',
        type: 'execute_test',
      });

      await submitResult('test-task-1', 'agent-001', {
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

      const rows = await testDb.all('SELECT status FROM agents WHERE id = ?', ['agent-001']);
      expect((rows[0] as { status: string }).status).toBe('active');
    });
  });
});
