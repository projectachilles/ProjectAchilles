import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import { mockClerkMiddleware } from '../../../__tests__/helpers/clerk-mock.js';

let testDb: Database.Database;

vi.mock('../../../services/agent/database.js', () => ({
  getDatabase: () => testDb,
}));

// Mock fs and os for createTasks dependency (reads build metadata from disk)
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockReadFileSync = vi.fn();
const mockStatSync = vi.fn().mockReturnValue({ size: 1024 });

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    statSync: mockStatSync,
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => '/mock-home' };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('../../../services/agent/test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

// Mock results ingestion (sync attempt path in POST /tasks/:id/result)
vi.mock('../../../services/agent/results.service.js', () => ({
  ingestResult: vi.fn().mockResolvedValue(undefined),
}));

// Mock the ingestion retry worker so the admin endpoint test is hermetic.
vi.mock('../../../services/agent/ingestionWorker.service.js', () => ({
  retryPendingIngestions: vi.fn(),
}));

mockClerkMiddleware();

const { agentTasksRouter, adminTasksRouter } = await import('../tasks.routes.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

/**
 * Create Express app with both agent and admin routes.
 * Agent routes get a middleware that injects req.agent (simulating requireAgentAuth).
 */
function createApp() {
  const app = express();
  app.use(express.json());

  // Agent routes: inject req.agent to simulate requireAgentAuth middleware
  app.use('/agent', (req, _res, next) => {
    req.agent = {
      id: 'agent-001',
      org_id: 'org-001',
      hostname: 'test-host',
      os: 'linux',
      arch: 'amd64',
      status: 'active',
    } as any;
    next();
  }, agentTasksRouter);

  // Admin routes: Clerk auth is mocked via mockClerkMiddleware
  app.use('/admin', adminTasksRouter);
  app.use(errorHandler);
  return app;
}

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

describe('tasks routes', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    setupFsMocks();
  });

  // ==========================================================================
  // Admin Routes (Clerk auth)
  // ==========================================================================

  describe('POST /admin/tasks', () => {
    it('creates tasks and returns 201 with task_ids array', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/admin/tasks')
        .send({
          org_id: 'org-001',
          agent_ids: ['agent-001'],
          test_uuid: 'test-uuid-001',
          test_name: 'Test',
          binary_name: 'test.exe',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.task_ids).toHaveLength(1);
    });

    it('returns 400 when org_id is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/admin/tasks')
        .send({
          agent_ids: ['agent-001'],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when agent_ids is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/admin/tasks')
        .send({
          org_id: 'org-001',
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when agent_ids is empty', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/admin/tasks')
        .send({
          org_id: 'org-001',
          agent_ids: [],
          test_uuid: 'uuid',
          test_name: 'name',
          binary_name: 'bin.exe',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/tasks', () => {
    it('returns paginated task list', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1' });
      insertTestTask(testDb, { id: 't2' });

      const res = await request(app).get('/admin/tasks');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.tasks).toHaveLength(2);
    });

    it('filters by status query param', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', status: 'pending' });
      insertTestTask(testDb, { id: 't2', status: 'completed' });

      const res = await request(app)
        .get('/admin/tasks')
        .query({ status: 'pending' });

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.tasks[0].id).toBe('t1');
    });

    it('filters by agent_id query param', async () => {
      const app = createApp();
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001' });
      insertTestTask(testDb, { id: 't2', agent_id: 'agent-002' });

      const res = await request(app)
        .get('/admin/tasks')
        .query({ agent_id: 'agent-001' });

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
    });
  });

  describe('GET /admin/tasks/:id', () => {
    it('returns task by ID', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 'task-001' });

      const res = await request(app).get('/admin/tasks/task-001');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('task-001');
    });

    it('returns 404 for nonexistent task', async () => {
      const app = createApp();

      const res = await request(app).get('/admin/tasks/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /admin/tasks/:id/cancel', () => {
    it('cancels a pending task', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', status: 'pending' });

      const res = await request(app).post('/admin/tasks/t1/cancel');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('expired');
    });

    it('returns 400 for completed task', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', status: 'completed' });

      const res = await request(app).post('/admin/tasks/t1/cancel');

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /admin/tasks/:id/notes', () => {
    it('updates notes with 200', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1' });

      const res = await request(app)
        .patch('/admin/tasks/t1/notes')
        .send({ content: 'Test note' });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Test note');
    });

    it('returns 400 for missing content', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1' });

      const res = await request(app)
        .patch('/admin/tasks/t1/notes')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-string content', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1' });

      const res = await request(app)
        .patch('/admin/tasks/t1/notes')
        .send({ content: 123 });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // Agent Routes (Agent key auth)
  // ==========================================================================

  describe('GET /agent/tasks', () => {
    it('returns 204 when no pending tasks', async () => {
      const app = createApp();

      const res = await request(app).get('/agent/tasks');

      expect(res.status).toBe(204);
    });

    it('returns 200 with task data when pending task exists', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 'task-001', agent_id: 'agent-001', status: 'pending' });

      const res = await request(app).get('/agent/tasks');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('task-001');
      expect(res.body.data.status).toBe('assigned');
    });
  });

  describe('PATCH /agent/tasks/:id/status', () => {
    it('updates status with valid transition', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      const res = await request(app)
        .patch('/agent/tasks/t1/status')
        .send({ status: 'downloading' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('downloading');
    });

    it('returns 400 when status field is missing', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      const res = await request(app)
        .patch('/agent/tasks/t1/status')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /agent/tasks/:id/result', () => {
    it('submits result for executing task', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const res = await request(app)
        .post('/agent/tasks/t1/result')
        .send({
          task_id: 't1',
          test_uuid: '00000000-0000-0000-0000-000000000000',
          exit_code: 0,
          stdout: 'Success',
          stderr: '',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          execution_duration_ms: 500,
          binary_sha256: 'abc123',
          hostname: 'test-host',
          os: 'linux',
          arch: 'amd64',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
    });

    it('returns 400 when exit_code is missing', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const res = await request(app)
        .post('/agent/tasks/t1/result')
        .send({ stdout: 'no exit code' });

      expect(res.status).toBe(400);
    });

    it('sets es_ingested=1 when synchronous ingestion succeeds', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't-ok', agent_id: 'agent-001', status: 'executing', type: 'execute_test' });

      const { ingestResult } = await import('../../../services/agent/results.service.js');
      vi.mocked(ingestResult).mockResolvedValueOnce(undefined);

      await request(app)
        .post('/agent/tasks/t-ok/result')
        .send({
          task_id: 't-ok', test_uuid: '00000000-0000-0000-0000-000000000000',
          exit_code: 0, stdout: '', stderr: '',
          started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
          execution_duration_ms: 1, binary_sha256: 'x', hostname: 'h', os: 'linux', arch: 'amd64',
        })
        .expect(200);

      const row = testDb.prepare('SELECT es_ingested, ingest_attempts FROM tasks WHERE id = ?').get('t-ok') as { es_ingested: number; ingest_attempts: number };
      expect(row.es_ingested).toBe(1);
      expect(row.ingest_attempts).toBe(1);
    });

    it('returns 200 and queues for retry when ingestion throws (durable in SQLite)', async () => {
      const app = createApp();
      insertTestTask(testDb, { id: 't-fail', agent_id: 'agent-001', status: 'executing', type: 'execute_test' });

      const { ingestResult } = await import('../../../services/agent/results.service.js');
      vi.mocked(ingestResult).mockRejectedValueOnce(new Error('ES bulk had 3 per-item errors: mapper_parsing_exception'));

      const res = await request(app)
        .post('/agent/tasks/t-fail/result')
        .send({
          task_id: 't-fail', test_uuid: '00000000-0000-0000-0000-000000000000',
          exit_code: 101, stdout: '', stderr: '',
          started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
          execution_duration_ms: 1, binary_sha256: 'x', hostname: 'h', os: 'linux', arch: 'amd64',
        });

      // Critical: agent sees 200 even when ES failed. Data is durable in
      // tasks.result; the retry worker will drain the backlog.
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');

      const row = testDb.prepare('SELECT es_ingested, ingest_attempts, result FROM tasks WHERE id = ?').get('t-fail') as { es_ingested: number; ingest_attempts: number; result: string };
      expect(row.es_ingested).toBe(0);
      expect(row.ingest_attempts).toBe(1);
      // Result is preserved so the worker can replay it
      expect(JSON.parse(row.result).exit_code).toBe(101);
    });
  });

  describe('POST /admin/ingestion/retry', () => {
    it('runs retryPendingIngestions and returns the report', async () => {
      const app = createApp();

      const { retryPendingIngestions } = await import('../../../services/agent/ingestionWorker.service.js');
      vi.mocked(retryPendingIngestions).mockResolvedValueOnce({
        attempted: 5,
        succeeded: 4,
        failed: 1,
        permanentlyFailed: 0,
      });

      const res = await request(app).post('/admin/ingestion/retry').send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { attempted: 5, succeeded: 4, failed: 1, permanentlyFailed: 0 },
      });
      expect(retryPendingIngestions).toHaveBeenCalledTimes(1);
    });

    it('reports zero-attempted when nothing is pending', async () => {
      const app = createApp();

      const { retryPendingIngestions } = await import('../../../services/agent/ingestionWorker.service.js');
      vi.mocked(retryPendingIngestions).mockResolvedValueOnce({
        attempted: 0,
        succeeded: 0,
        failed: 0,
        permanentlyFailed: 0,
      });

      const res = await request(app).post('/admin/ingestion/retry').send({});

      expect(res.status).toBe(200);
      expect(res.body.data.attempted).toBe(0);
    });
  });
});
