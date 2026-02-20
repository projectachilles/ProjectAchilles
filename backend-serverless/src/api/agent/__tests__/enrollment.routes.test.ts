import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { DbHelper } from '../../../services/agent/database.js';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';
import { mockClerkMiddleware } from '../../../__tests__/helpers/clerk-mock.js';

let testDb: DbHelper;

vi.mock('../../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/agent/database.js')>();
  return {
    ...actual,
    getDb: async () => testDb,
  };
});

mockClerkMiddleware();

const { agentEnrollmentRouter, adminEnrollmentRouter } = await import('../enrollment.routes.js');
const { createToken } = await import('../../../services/agent/enrollment.service.js');
const { errorHandler } = await import('../../../middleware/error.middleware.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/agent', agentEnrollmentRouter);
  app.use('/agent/admin', adminEnrollmentRouter);
  app.use(errorHandler);
  return app;
}

describe('enrollment routes', () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  describe('POST /agent/enroll', () => {
    it('returns 400 for missing fields', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/agent/enroll')
        .send({ token: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('returns 400 for invalid OS', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/agent/enroll')
        .send({
          token: 'test',
          hostname: 'host',
          os: 'macos',
          arch: 'amd64',
          agent_version: '1.0.0',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid os');
    });

    it('returns 400 for invalid arch', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/agent/enroll')
        .send({
          token: 'test',
          hostname: 'host',
          os: 'linux',
          arch: 'x86',
          agent_version: '1.0.0',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid arch');
    });

    it('returns 201 for valid enrollment', async () => {
      const app = createApp();
      const token = await createToken('org-001', 'user-001', 24, 5);

      const res = await request(app)
        .post('/agent/enroll')
        .send({
          token: token.token,
          hostname: 'test-host',
          os: 'linux',
          arch: 'amd64',
          agent_version: '1.0.0',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.agent_id).toBeDefined();
      expect(res.body.data.agent_key).toMatch(/^ak_/);
    });
  });

  describe('GET /agent/config', () => {
    it('returns server URL', async () => {
      const app = createApp();

      const res = await request(app).get('/agent/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.server_url).toBeDefined();
    });
  });

  describe('POST /agent/admin/tokens', () => {
    it('creates an enrollment token', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/agent/admin/tokens')
        .send({ org_id: 'org-001', ttl_hours: 48, max_uses: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.token).toMatch(/^acht_/);
      expect(res.body.data.max_uses).toBe(10);
    });

    it('returns 400 without org_id', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/agent/admin/tokens')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /agent/admin/tokens', () => {
    it('lists tokens for an org', async () => {
      const app = createApp();
      await createToken('org-001', 'user-001');

      const res = await request(app)
        .get('/agent/admin/tokens')
        .query({ org_id: 'org-001' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns 400 without org_id query', async () => {
      const app = createApp();

      const res = await request(app).get('/agent/admin/tokens');

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /agent/admin/tokens/:id', () => {
    it('revokes a token', async () => {
      const app = createApp();
      const token = await createToken('org-001', 'user-001');

      const res = await request(app).delete(`/agent/admin/tokens/${token.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Token revoked');
    });
  });
});
