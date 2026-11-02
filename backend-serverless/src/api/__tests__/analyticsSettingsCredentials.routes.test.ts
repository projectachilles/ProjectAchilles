import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * (Mirrors backend/src/api/__tests__/analyticsSettingsCredentials.routes.test.ts.)
 * The saved Elasticsearch credentials must never leave for a host the request
 * names. POST /settings/test and POST /settings merge blank credential fields
 * with the saved ones; that merge now happens only when the request targets
 * the saved cluster (same connection type, Cloud ID and node URL).
 *
 * Real clerk.middleware (requirePermission); @clerk/express, the settings
 * store and the Elasticsearch client are mocked. The client mock records the
 * settings it is built with: that is exactly what would be sent, and where.
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

vi.mock('../../middleware/urlValidation.js', () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(undefined),
}));

const SAVED_DIRECT = {
  configured: true,
  connectionType: 'direct',
  node: 'https://es.internal.example:9200',
  apiKey: 'SAVED-API-KEY',
  username: 'elastic',
  password: 'SAVED-PASSWORD',
  caCert: 'SAVED-CA',
  indexPattern: 'achilles-results-*',
};
const SAVED_CLOUD = {
  configured: true,
  connectionType: 'cloud',
  cloudId: 'saved-deployment:abc',
  apiKey: 'SAVED-API-KEY',
  indexPattern: 'achilles-results-*',
};

let saved: Record<string, unknown> = SAVED_DIRECT;
const mockSaveSettings = vi.fn();
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = async () => saved;
    saveSettings = mockSaveSettings;
  },
}));

const constructed: Array<Record<string, unknown>> = [];
vi.mock('../../services/analytics/elasticsearch.js', () => ({
  ElasticsearchService: class {
    constructor(settings: Record<string, unknown>) {
      constructed.push(settings);
    }
    testConnection = vi.fn().mockResolvedValue('8.17.0');
  },
}));

const mockListIndices = vi.fn().mockResolvedValue([]);
vi.mock('../../services/analytics/index-management.service.js', () => ({
  createResultsIndex: vi.fn().mockResolvedValue({ created: true }),
  listResultsIndices: (...args: unknown[]) => mockListIndices(...args),
}));

const { default: analyticsRoutes } = await import('../analytics.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function appAs(role: 'admin' | 'analyst' | 'explorer' = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { userId: 'user-1', sessionClaims: { metadata: { role } } };
    next();
  });
  app.use('/api/analytics', analyticsRoutes);
  app.use(errorHandler);
  return app;
}

const lastTest = () => constructed[constructed.length - 1];

beforeEach(() => {
  saved = SAVED_DIRECT;
  constructed.length = 0;
  mockSaveSettings.mockClear();
  mockListIndices.mockClear();
});

describe('POST /settings/test', () => {
  it('never sends the saved credentials to a node the request names', async () => {
    const res = await request(appAs()).post('/api/analytics/settings/test')
      .send({ connectionType: 'direct', node: 'https://attacker.example' });
    expect(res.status).toBe(200);
    expect(lastTest()).toMatchObject({ node: 'https://attacker.example', apiKey: '', username: '', password: '', caCert: '' });
  });

  it('never sends the saved API key with a Cloud ID the request names', async () => {
    saved = SAVED_CLOUD;
    await request(appAs()).post('/api/analytics/settings/test')
      .send({ connectionType: 'cloud', cloudId: 'attacker:xyz' });
    expect(lastTest()).toMatchObject({ cloudId: 'attacker:xyz', apiKey: '' });
  });

  it('reuses the saved credentials when the target is the saved cluster', async () => {
    await request(appAs()).post('/api/analytics/settings/test').send({ connectionType: 'direct' });
    expect(lastTest()).toMatchObject({ node: SAVED_DIRECT.node, apiKey: 'SAVED-API-KEY', password: 'SAVED-PASSWORD' });

    // The same node typed again (trailing slash, as in the form) is still the saved cluster.
    await request(appAs()).post('/api/analytics/settings/test')
      .send({ connectionType: 'direct', node: `${SAVED_DIRECT.node}/` });
    expect(lastTest()).toMatchObject({ apiKey: 'SAVED-API-KEY', password: 'SAVED-PASSWORD' });
  });

  it('uses credentials the request supplies for a new node', async () => {
    await request(appAs()).post('/api/analytics/settings/test')
      .send({ connectionType: 'direct', node: 'https://new-es.example', apiKey: 'NEW-KEY' });
    expect(lastTest()).toMatchObject({ node: 'https://new-es.example', apiKey: 'NEW-KEY', password: '' });
  });

  it('requires analytics:settings:write (read-only roles cannot test)', async () => {
    for (const role of ['explorer', 'analyst'] as const) {
      const res = await request(appAs(role)).post('/api/analytics/settings/test').send({ connectionType: 'direct' });
      expect(res.status).toBe(403);
    }
    expect(constructed).toEqual([]);
  });
});

describe('POST /settings', () => {
  it('does not carry the saved credentials over to a new node', async () => {
    const res = await request(appAs()).post('/api/analytics/settings')
      .send({ connectionType: 'direct', node: 'https://attacker.example' });
    expect(res.status).toBe(200);
    expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      node: 'https://attacker.example', apiKey: '', username: '', password: '', caCert: '',
    }));
  });

  it('keeps the saved credentials when only other fields change', async () => {
    await request(appAs()).post('/api/analytics/settings')
      .send({ connectionType: 'direct', writeIndexRollover: 'monthly' });
    expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      node: SAVED_DIRECT.node, apiKey: 'SAVED-API-KEY', password: 'SAVED-PASSWORD', writeIndexRollover: 'monthly',
    }));
  });
});

describe('GET /indices', () => {
  it('lists Achilles indices only', async () => {
    for (const pattern of ['*', '.security*', 'other-app-*', 'achilles-*,secrets']) {
      const res = await request(appAs()).get('/api/analytics/indices').query({ pattern });
      expect(res.status).toBe(400);
    }
    expect(mockListIndices).not.toHaveBeenCalled();
    for (const pattern of [undefined, 'achilles-results-*', 'archived-achilles*']) {
      const res = await request(appAs()).get('/api/analytics/indices').query(pattern ? { pattern } : {});
      expect(res.status).toBe(200);
    }
  });
});
