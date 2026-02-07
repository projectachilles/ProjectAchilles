import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock Clerk middleware
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/clerk.middleware.js', () => ({
  clerkAuth: (_req: any, _res: any, next: any) => next(),
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = { userId: 'test-user-001' };
    next();
  },
  getUserId: (auth: any) => auth?.userId || 'test-user-001',
  linkClerkSession: (_req: any, _res: any, next: any) => next(),
}));

// Mock the settings service
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class MockSettingsService {
    getSettings = mockGetSettings;
    saveSettings = mockSaveSettings;
  },
}));

// Mock the ES service
const mockTestConnection = vi.fn();
vi.mock('../../services/analytics/elasticsearch.js', () => ({
  ElasticsearchService: class MockElasticsearchService {
    testConnection = mockTestConnection;
  },
}));

// Mock index management
vi.mock('../../services/analytics/index-management.service.js', () => ({
  createResultsIndex: vi.fn().mockResolvedValue({ created: true }),
  listResultsIndices: vi.fn().mockResolvedValue([]),
}));

const { default: analyticsRoutes } = await import('../analytics.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);
  app.use(errorHandler);
  return app;
}

describe('analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({
      configured: false,
      connectionType: null,
      indexPattern: null,
    });
  });

  describe('GET /api/analytics/settings', () => {
    it('returns masked settings', async () => {
      mockGetSettings.mockReturnValue({
        configured: true,
        connectionType: 'cloud',
        indexPattern: 'achilles-results-*',
        cloudId: 'secret-cloud-id',
        node: undefined,
      });

      const app = createApp();
      const res = await request(app).get('/api/analytics/settings');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.cloudId).toBe('***'); // Masked
      expect(res.body.indexPattern).toBe('achilles-results-*');
    });

    it('returns unconfigured state', async () => {
      const app = createApp();
      const res = await request(app).get('/api/analytics/settings');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(false);
    });
  });

  describe('POST /api/analytics/settings', () => {
    it('saves settings', async () => {
      mockGetSettings.mockReturnValue({});

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/settings')
        .send({
          connectionType: 'cloud',
          cloudId: 'my-cloud-id',
          apiKey: 'my-api-key',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockSaveSettings).toHaveBeenCalled();
    });

    it('returns 400 without connectionType', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/settings')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/analytics/settings/test', () => {
    it('returns success on successful connection', async () => {
      mockGetSettings.mockReturnValue({});
      mockTestConnection.mockResolvedValue('8.11.0');

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/settings/test')
        .send({ connectionType: 'cloud', cloudId: 'id', apiKey: 'key' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe('8.11.0');
    });
  });

  describe('GET /api/analytics/defense-score', () => {
    it('returns 400 when ES is not configured', async () => {
      const app = createApp();
      const res = await request(app).get('/api/analytics/defense-score');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not configured');
    });
  });

  describe('POST /api/analytics/index/create', () => {
    it('returns 400 without index_name', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/index/create')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid index name', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/index/create')
        .send({ index_name: 'INVALID_Name!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid index name');
    });
  });
});
