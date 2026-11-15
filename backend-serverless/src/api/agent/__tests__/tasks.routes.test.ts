import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { DbHelper } from '../../../services/agent/database.js';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import '../../../__tests__/helpers/clerk-mock.js';

let testDb: DbHelper;

vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return {
    ...actual,
    getDb: async () => testDb,
  };
});

// Mock Blob storage for createTasks dependency (reads build metadata from Blob)
const mockBlobReadText = vi.fn();
const mockBlobRead = vi.fn();

vi.mock('../../../services/storage.js', () => ({
  blobReadText: (...args: unknown[]) => mockBlobReadText(...args),
  blobRead: (...args: unknown[]) => mockBlobRead(...args),
}));

vi.mock('../../../services/agent/test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

// Mock results ingestion (fire-and-forget in POST /tasks/:id/result)
vi.mock('../../../services/agent/results.service.js', () => ({
  ingestResult: vi.fn().mockResolvedValue(undefined),
}));


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

  // Admin routes: Clerk auth is mocked by the clerk-mock helper import
  app.use('/admin', adminTasksRouter);
  app.use(errorHandler);
  return app;
}

function setupBlobMocks() {
  mockBlobReadText.mockImplementation((key: string) => {
    if (key.endsWith('build-meta.json')) {
      return Promise.resolve(JSON.stringify({ binary_name: 'test-binary.exe', filename: 'test-binary.exe' }));
    }
    return Promise.resolve(null);
  });
  mockBlobRead.mockResolvedValue(Buffer.from('fake-binary-content'));
}

const SECRET_TASK_PAYLOAD = JSON.stringify({
  test_uuid: 'secret-test-uuid',
  test_name: 'Credentialed Test',
  binary_name: 'secret-test.exe',
  binary_sha256: 'abc123',
  binary_size: 1024,
  execution_timeout: 300,
  arguments: [],
  metadata: {
    category: 'identity',
    subcategory: 'identity-tenant',
    techniques: [],
    tactics: [],
    threat_actor: '',
    target: [],
    complexity: '',
    tags: [],
    score: null,
    integrations: ['azure'],
  },
  env_vars: {
    AZURE_TENANT_ID: 'tenant-id',
    AZURE_CLIENT_ID: 'client-id',
    AZURE_CLIENT_SECRET: 'client-secret',
  },
});

function expectAdminPayloadRedacted(payload: Record<string, unknown>) {
  expect(payload).not.toHaveProperty('env_vars');
  expect(payload.test_name).toBe('Credentialed Test');
}

function expectAdminTaskRedacted(task: { payload: Record<string, unknown> }) {
  expectAdminPayloadRedacted(task.payload);
}

describe('tasks routes', () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await insertTestAgent(testDb, { id: 'agent-001' });
    setupBlobMocks();
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
      await insertTestTask(testDb, { id: 't1' });
      await insertTestTask(testDb, { id: 't2' });

      const res = await request(app).get('/admin/tasks');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.tasks).toHaveLength(2);
    });

    it('filters by status query param', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1', status: 'pending' });
      await insertTestTask(testDb, { id: 't2', status: 'completed' });

      const res = await request(app)
        .get('/admin/tasks')
        .query({ status: 'pending' });

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.tasks[0].id).toBe('t1');
    });

    it('filters by agent_id query param', async () => {
      const app = createApp();
      await insertTestAgent(testDb, { id: 'agent-002' });
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001' });
      await insertTestTask(testDb, { id: 't2', agent_id: 'agent-002' });

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
      await insertTestTask(testDb, { id: 'task-001' });

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
      await insertTestTask(testDb, { id: 't1', status: 'pending' });

      const res = await request(app).post('/admin/tasks/t1/cancel');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('expired');
    });

    it('returns 400 for completed task', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1', status: 'completed' });

      const res = await request(app).post('/admin/tasks/t1/cancel');

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /admin/tasks/:id/notes', () => {
    it('updates notes with 200', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1' });

      const res = await request(app)
        .patch('/admin/tasks/t1/notes')
        .send({ content: 'Test note' });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Test note');
    });

    it('returns 400 for missing content', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1' });

      const res = await request(app)
        .patch('/admin/tasks/t1/notes')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-string content', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1' });

      const res = await request(app)
        .patch('/admin/tasks/t1/notes')
        .send({ content: 123 });

      expect(res.status).toBe(400);
    });
  });

  describe('admin task credential redaction', () => {
    it('redacts env_vars from every task response while preserving agent dispatch', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 'secret-detail', payload: SECRET_TASK_PAYLOAD });
      await insertTestTask(testDb, { id: 'secret-group', batch_id: 'secret-batch', payload: SECRET_TASK_PAYLOAD });
      await insertTestTask(testDb, { id: 'secret-cancel', payload: SECRET_TASK_PAYLOAD });
      await insertTestTask(testDb, { id: 'secret-notes', payload: SECRET_TASK_PAYLOAD });
      await insertTestTask(testDb, { id: 'secret-retry', status: 'failed', payload: SECRET_TASK_PAYLOAD });

      const list = await request(app).get('/admin/tasks');
      expect(list.status).toBe(200);
      for (const task of list.body.data.tasks) expectAdminTaskRedacted(task);

      const grouped = await request(app).get('/admin/tasks/grouped');
      expect(grouped.status).toBe(200);
      const group = grouped.body.data.groups.find((entry: { batch_id: string }) => entry.batch_id === 'secret-batch');
      expect(group).toBeDefined();
      expectAdminPayloadRedacted(group.payload);
      for (const task of group.tasks) expectAdminTaskRedacted(task);

      const detail = await request(app).get('/admin/tasks/secret-detail');
      expect(detail.status).toBe(200);
      expectAdminTaskRedacted(detail.body.data);

      const cancelled = await request(app).post('/admin/tasks/secret-cancel/cancel');
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.status).toBe('expired');
      expectAdminTaskRedacted(cancelled.body.data);

      const noted = await request(app)
        .patch('/admin/tasks/secret-notes/notes')
        .send({ content: 'Reviewed' });
      expect(noted.status).toBe(200);
      expect(noted.body.data.notes).toBe('Reviewed');
      expectAdminTaskRedacted(noted.body.data);

      const retried = await request(app).post('/admin/tasks/secret-retry/retry');
      expect(retried.status).toBe(201);
      expect(retried.body.data.status).toBe('pending');
      expectAdminTaskRedacted(retried.body.data);

      await insertTestTask(testDb, {
        id: 'secret-agent-dispatch',
        priority: 100,
        payload: SECRET_TASK_PAYLOAD,
      });
      const dispatched = await request(app).get('/agent/tasks');
      expect(dispatched.status).toBe(200);
      expect(dispatched.body.data.id).toBe('secret-agent-dispatch');
      expect(dispatched.body.data.payload.env_vars).toEqual({
        AZURE_TENANT_ID: 'tenant-id',
        AZURE_CLIENT_ID: 'client-id',
        AZURE_CLIENT_SECRET: 'client-secret',
      });
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
      await insertTestTask(testDb, { id: 'task-001', agent_id: 'agent-001', status: 'pending' });

      const res = await request(app).get('/agent/tasks');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('task-001');
      expect(res.body.data.status).toBe('assigned');
    });
  });

  describe('PATCH /agent/tasks/:id/status', () => {
    it('updates status with valid transition', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      const res = await request(app)
        .patch('/agent/tasks/t1/status')
        .send({ status: 'downloading' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('downloading');
    });

    it('returns 400 when status field is missing', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'assigned' });

      const res = await request(app)
        .patch('/agent/tasks/t1/status')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /agent/tasks/:id/result', () => {
    it('submits result for executing task', async () => {
      const app = createApp();
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const res = await request(app)
        .post('/agent/tasks/t1/result')
        .send({
          task_id: 't1',
          test_uuid: '00000000-0000-0000-0000-000000000001',
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
      await insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', status: 'executing' });

      const res = await request(app)
        .post('/agent/tasks/t1/result')
        .send({ stdout: 'no exit code' });

      expect(res.status).toBe(400);
    });
  });
});
