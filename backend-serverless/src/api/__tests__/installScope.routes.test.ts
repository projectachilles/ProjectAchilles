import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { DbHelper } from '../../services/agent/database.js';
import { createTestDatabase } from '../../__tests__/helpers/db.js';

/**
 * (Mirrors backend/src/api/__tests__/installScope.routes.test.ts.)
 * Install-wide configuration is changed only by callers without an
 * organization (#709): agent versions, the Elasticsearch connection and
 * index creation, and agent key auto-rotation. A user or API key in a Clerk
 * organization gets 403 before anything runs; reads stay open.
 *
 * Real clerk.middleware (requirePermission, getUserOrgId); @clerk/express,
 * the database and the stores these routes write to are mocked.
 */

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (req: any, res: any, next: any) => {
    if (req.auth?.userId) {
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
}));

let testDb: DbHelper;
vi.mock('../../services/agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/database.js')>();
  return { ...actual, getDb: async () => testDb };
});

const mockSaveAutoRotation = vi.fn();
vi.mock('../../services/agent/autoRotation.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agent/autoRotation.service.js')>();
  return {
    ...actual,
    getAutoRotationSettings: async () => ({ enabled: true, intervalDays: 90 }),
    saveAutoRotationSettings: async (...a: unknown[]) => mockSaveAutoRotation(...a),
  };
});

vi.mock('../../middleware/urlValidation.js', () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(undefined),
}));

const mockSaveSettings = vi.fn();
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = async () => ({ configured: true, connectionType: 'direct', node: 'https://es.example', indexPattern: 'achilles-results-*' });
    saveSettings = mockSaveSettings;
  },
}));

const mockCreateIndex = vi.fn().mockResolvedValue({ created: true });
vi.mock('../../services/analytics/index-management.service.js', () => ({
  createResultsIndex: (...a: unknown[]) => mockCreateIndex(...a),
  listResultsIndices: vi.fn().mockResolvedValue([]),
}));

const { requireClerkAuth, requireOrgAccess } = await import('../../middleware/clerk.middleware.js');
const { createAdminUpdateRouter } = await import('../agent/update.routes.js');
const { adminAgentRouter } = await import('../agent/heartbeat.routes.js');
const { default: analyticsRoutes } = await import('../analytics.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function appAs(orgId?: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = {
      userId: 'user-1',
      ...(orgId ? { orgId } : {}),
      sessionClaims: { metadata: { role: 'admin' } },
    };
    next();
  });
  app.use('/api/agent/admin', requireClerkAuth(), requireOrgAccess, createAdminUpdateRouter(null));
  app.use('/api/agent/admin', requireClerkAuth(), requireOrgAccess, adminAgentRouter);
  app.use('/api/analytics', analyticsRoutes);
  app.use(errorHandler);
  return app;
}

const SHARED = /shared by every organization in this install/;

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockSaveAutoRotation.mockClear();
  mockSaveSettings.mockClear();
  mockCreateIndex.mockClear();
});

afterEach(() => {
  delete process.env.REQUIRE_ORG_ISOLATION;
});

describe('a caller in an organization', () => {
  const app = () => appAs('org_a');

  it.each([
    ['POST', '/api/agent/admin/versions'],
    ['POST', '/api/agent/admin/versions/upload'],
    ['POST', '/api/agent/admin/versions/build'],
    ['DELETE', '/api/agent/admin/versions/0.7.2/windows/amd64'],
  ])('cannot change agent versions: %s %s', async (method, path) => {
    const res = method === 'POST' ? await request(app()).post(path).send({}) : await request(app()).delete(path);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(SHARED);
  });

  it('can still list agent versions', async () => {
    const res = await request(app()).get('/api/agent/admin/versions');
    expect(res.status).toBe(200);
  });

  it('cannot change the Elasticsearch connection or create an index', async () => {
    const save = await request(app()).post('/api/analytics/settings').send({ connectionType: 'direct', node: 'https://other.example' });
    expect(save.status).toBe(403);
    const index = await request(app()).post('/api/analytics/index/create').send({ index_name: 'achilles-results-x' });
    expect(index.status).toBe(403);
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockCreateIndex).not.toHaveBeenCalled();
  });

  it('cannot change key auto-rotation, but can read it', async () => {
    const put = await request(app()).put('/api/agent/admin/settings/auto-rotation').send({ enabled: false, intervalDays: 30 });
    expect(put.status).toBe(403);
    expect(mockSaveAutoRotation).not.toHaveBeenCalled();
    expect((await request(app()).get('/api/agent/admin/settings/auto-rotation')).status).toBe(200);
  });
});

describe('a caller without an organization (the install operator)', () => {
  it('passes the guard on every install-wide write', async () => {
    const app = appAs();
    // Past the guard, each route answers on its own terms (validation, no build service, unknown version).
    expect((await request(app).post('/api/agent/admin/versions').send({})).status).toBe(400);
    expect((await request(app).post('/api/agent/admin/versions/build').send({})).status).not.toBe(403);
    expect((await request(app).delete('/api/agent/admin/versions/0.7.2/windows/amd64')).status).toBe(404);
    expect((await request(app).post('/api/analytics/settings').send({ connectionType: 'direct', node: 'https://es.example' })).status).toBe(200);
    expect((await request(app).post('/api/analytics/index/create').send({ index_name: 'achilles-results-x' })).status).toBe(200);
    expect((await request(app).put('/api/agent/admin/settings/auto-rotation').send({ enabled: false, intervalDays: 30 })).status).toBe(200);
    expect(mockSaveAutoRotation).toHaveBeenCalledWith({ enabled: false, intervalDays: 30 });
  });

  it('keeps that access with REQUIRE_ORG_ISOLATION=true (this configuration belongs to no organization)', async () => {
    process.env.REQUIRE_ORG_ISOLATION = 'true';
    const res = await request(appAs()).put('/api/agent/admin/settings/auto-rotation').send({ enabled: true, intervalDays: 30 });
    expect(res.status).toBe(200);
  });
});
