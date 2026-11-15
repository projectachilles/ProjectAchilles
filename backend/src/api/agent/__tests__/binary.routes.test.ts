import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;
vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// The file on disk is not what is under test: every build "exists".
const getBinaryInfo = vi.fn(async (testUuid: string, name: string) => ({
  path: `/builds/${testUuid}/${name}`, sha256: 'abc', size: 3, name,
}));
vi.mock('../../../services/agent/binary.service.js', () => ({
  getBinaryInfo: (...args: [string, string]) => getBinaryInfo(...args),
  streamBinary: (_path: string, _name: string, res: express.Response) => res.status(200).send('bin'),
}));

const binaryRouter = (await import('../binary.routes.js')).default;
const { errorHandler } = await import('../../../middleware/error.middleware.js');

const TEST_A = '11111111-1111-4111-8111-111111111111';
const TEST_B = '22222222-2222-4222-8222-222222222222';
const payloadFor = (testUuid: string) => JSON.stringify({ test_uuid: testUuid, test_name: 'T', binary_name: 'test.exe' });

function makeApp(agentId: string) {
  const app = express();
  // Stand-in for requireAgentAuth, which the parent router applies.
  app.use((req, _res, next) => {
    req.agent = { id: agentId, org_id: 'org-001', hostname: 'h', os: 'windows', arch: 'amd64', status: 'active' };
    next();
  });
  app.use(binaryRouter);
  app.use(errorHandler);
  return app;
}

const download = (agentId: string, testUuid: string) =>
  request(makeApp(agentId)).get('/binary/test.exe').query({ test_uuid: testUuid });

beforeEach(() => {
  testDb = createTestDatabase();
  getBinaryInfo.mockClear();
  insertTestAgent(testDb, { id: 'agent-001' });
  insertTestAgent(testDb, { id: 'agent-002' });
});

describe('GET /binary/:name (an agent downloads a test binary)', () => {
  it.each(['assigned', 'downloading', 'executing'])('serves the test of a task that is %s', async (status) => {
    insertTestTask(testDb, { agent_id: 'agent-001', status, payload: payloadFor(TEST_A) });

    const res = await download('agent-001', TEST_A);

    expect(res.status).toBe(200);
  });

  it('refuses a test the agent has no task for, with the same answer as a missing build', async () => {
    insertTestTask(testDb, { agent_id: 'agent-001', status: 'executing', payload: payloadFor(TEST_A) });

    const res = await download('agent-001', TEST_B);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Binary not found: test.exe');
    expect(getBinaryInfo).not.toHaveBeenCalled();
  });

  it("refuses a test that only another agent's task names", async () => {
    insertTestTask(testDb, { agent_id: 'agent-002', status: 'executing', payload: payloadFor(TEST_A) });

    expect((await download('agent-001', TEST_A)).status).toBe(404);
  });

  it.each(['pending', 'completed', 'failed', 'expired'])('refuses when the task is %s', async (status) => {
    insertTestTask(testDb, { agent_id: 'agent-001', status, payload: payloadFor(TEST_A) });

    expect((await download('agent-001', TEST_A)).status).toBe(404);
  });

  it('refuses when the only task for the agent is not a test run', async () => {
    insertTestTask(testDb, { agent_id: 'agent-001', status: 'executing', type: 'execute_command', payload: payloadFor(TEST_A) });

    expect((await download('agent-001', TEST_A)).status).toBe(404);
  });
});
