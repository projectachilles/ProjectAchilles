import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';
import '../../../__tests__/helpers/clerk-mock.js';

let testDb: Database.Database;

vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { adminAgentRouter } = await import('../heartbeat.routes.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

function appAs(auth: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { userId: 'user-1', ...auth };
    next();
  });
  app.use('/admin', adminAgentRouter);
  app.use(errorHandler);
  return app;
}

const tagsOf = (id: string) => JSON.parse((testDb.prepare('SELECT tags FROM agents WHERE id = ?').get(id) as { tags: string }).tags);

describe('agent tag routes', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'a1', org_id: 'org-1', tags: '["cs-falcon"]' });
    insertTestAgent(testDb, { id: 'a2', org_id: 'org-1', tags: '[]' });
    insertTestAgent(testDb, { id: 'b1', org_id: 'org-2', tags: '["cs-falcon","s1"]' });
  });

  it('GET /tags counts the caller org only', async () => {
    const res = await request(appAs({ orgId: 'org-1' })).get('/admin/tags');
    expect(res.status).toBe(200);
    expect(res.body.data.tags).toEqual([{ tag: 'cs-falcon', count: 1 }]);
  });

  it('POST /tags/bulk adds normalized tags to every selected agent', async () => {
    const res = await request(appAs({ orgId: 'org-1' }))
      .post('/admin/tags/bulk')
      .send({ agent_ids: ['a1', 'a2'], add: ['  Finance '] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);
    expect(tagsOf('a1')).toEqual(['cs-falcon', 'finance']);
    expect(tagsOf('a2')).toEqual(['finance']);
  });

  it('POST /tags/bulk removes a tag from every selected agent', async () => {
    await request(appAs()).post('/admin/tags/bulk').send({ agent_ids: ['a1', 'b1'], remove: ['cs-falcon'] });
    expect(tagsOf('a1')).toEqual([]);
    expect(tagsOf('b1')).toEqual(['s1']);
  });

  it('rejects a tag that breaks the rules', async () => {
    const res = await request(appAs()).post('/admin/tags/bulk').send({ agent_ids: ['a1'], add: ['two words'] });
    expect(res.status).toBe(400);
    expect(tagsOf('a1')).toEqual(['cs-falcon']);
  });

  it('refuses another org\'s agent and changes nothing', async () => {
    const res = await request(appAs({ orgId: 'org-1' })).post('/admin/tags/bulk').send({ agent_ids: ['a1', 'b1'], add: ['x'] });
    expect(res.status).toBe(404);
    expect(tagsOf('a1')).toEqual(['cs-falcon']);
    expect(tagsOf('b1')).toEqual(['cs-falcon', 's1']);
  });

  it('POST /agents/:id/tags normalizes too', async () => {
    const res = await request(appAs()).post('/admin/agents/a2/tags').send({ tag: 'CS-Falcon' });
    expect(res.status).toBe(200);
    expect(tagsOf('a2')).toEqual(['cs-falcon']);
  });
});
