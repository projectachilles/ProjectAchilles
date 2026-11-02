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
  getUserOrgId: (auth: any) => auth?.orgId,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
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
const mockGetErrorRateTrendRolling = vi.fn();
const mockGetDefenseScoreTrendRolling = vi.fn();
const mockGetDefenseScore = vi.fn();
const mockGetDefenseScoreTrend = vi.fn();
const mockGetDefenseScoreLatest = vi.fn();
const mockGetDefenseScoreTrendLatest = vi.fn();
const mockByCategoryLatest = vi.fn();
const mockByCategory = vi.fn();
const mockByHostnameLatest = vi.fn();
const mockByHostname = vi.fn();
const mockTechniqueLatest = vi.fn();
const mockTechnique = vi.fn();
const mockCoverageLatest = vi.fn();
const mockCoverage = vi.fn();
const mockThreatActorLatest = vi.fn();
const mockThreatActor = vi.fn();
const mockTechniqueOutcomes = vi.fn();
const mockChainDepth = vi.fn();
const mockTestResults = vi.fn();
vi.mock('../../services/analytics/elasticsearch.js', () => ({
  ElasticsearchService: class MockElasticsearchService {
    testConnection = mockTestConnection;
    getErrorRateTrendRolling = mockGetErrorRateTrendRolling;
    getDefenseScoreTrendRolling = mockGetDefenseScoreTrendRolling;
    getDefenseScore = mockGetDefenseScore;
    getDefenseScoreTrend = mockGetDefenseScoreTrend;
    getDefenseScoreLatest = mockGetDefenseScoreLatest;
    getDefenseScoreTrendLatest = mockGetDefenseScoreTrendLatest;
    getDefenseScoreByCategoryWithSubcategoriesLatest = mockByCategoryLatest;
    getDefenseScoreByCategoryWithSubcategories = mockByCategory;
    getDefenseScoreByHostnameLatest = mockByHostnameLatest;
    getDefenseScoreByHostname = mockByHostname;
    getTechniqueDistributionLatest = mockTechniqueLatest;
    getTechniqueDistribution = mockTechnique;
    getTestCoverageLatest = mockCoverageLatest;
    getTestCoverage = mockCoverage;
    getThreatActorCoverageLatest = mockThreatActorLatest;
    getThreatActorCoverage = mockThreatActor;
    getTechniqueOutcomes = mockTechniqueOutcomes;
    getChainDepth = mockChainDepth;
    getTestResults = mockTestResults;
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
      expect(res.body.error).toContain('Validation failed');
    });
  });

  describe('GET /api/analytics/error-rate/trend', () => {
    beforeEach(() => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });
      mockGetErrorRateTrendRolling.mockResolvedValue([]);
    });

    it('without windowDays uses the range length', async () => {
      const res = await request(createApp()).get('/api/analytics/error-rate/trend?from=now-30d');
      expect(res.status).toBe(200);
      expect(mockGetErrorRateTrendRolling).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 30 }));
    });

    it('derived window is clamped to 365 days', async () => {
      await request(createApp()).get('/api/analytics/error-rate/trend?from=now-2000d');
      expect(mockGetErrorRateTrendRolling).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 365 }));
    });

    it('honours an explicit windowDays', async () => {
      await request(createApp()).get('/api/analytics/error-rate/trend?from=now-30d&windowDays=7');
      expect(mockGetErrorRateTrendRolling).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 7 }));
    });

    it('clamps an explicit windowDays to 90', async () => {
      await request(createApp()).get('/api/analytics/error-rate/trend?from=now-30d&windowDays=200');
      expect(mockGetErrorRateTrendRolling).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 90 }));
    });
  });

  describe('breakdown basis dispatch', () => {
    beforeEach(() => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });
      for (const m of [mockByCategoryLatest, mockByCategory, mockByHostnameLatest, mockByHostname, mockTechniqueLatest, mockTechnique, mockCoverageLatest, mockCoverage, mockThreatActorLatest, mockThreatActor, mockTechniqueOutcomes, mockChainDepth]) {
        m.mockResolvedValue([]);
      }
    });
    const cases: [string, typeof mockCoverage, typeof mockCoverage][] = [
      ['/defense-score/by-category-subcategory', mockByCategoryLatest, mockByCategory],
      ['/defense-score/by-hostname', mockByHostnameLatest, mockByHostname],
      ['/technique-distribution', mockTechniqueLatest, mockTechnique],
      ['/test-coverage', mockCoverageLatest, mockCoverage],
      ['/threat-actor-coverage', mockThreatActorLatest, mockThreatActor],
    ];
    for (const [path, latest, executions] of cases) {
      it(`${path}: basis=latest -> latest method, default -> executions, bogus -> 400`, async () => {
        const l = await request(createApp()).get(`/api/analytics${path}?basis=latest&scoringMode=any-stage`);
        expect(l.status).toBe(200);
        expect(latest).toHaveBeenCalledWith(expect.objectContaining({ basis: 'latest', scoringMode: 'any-stage' }));
        expect(executions).not.toHaveBeenCalled();

        latest.mockClear();
        await request(createApp()).get(`/api/analytics${path}`);
        expect(executions).toHaveBeenCalledTimes(1);
        expect(latest).not.toHaveBeenCalled();

        const bad = await request(createApp()).get(`/api/analytics${path}?basis=bogus`);
        expect(bad.status).toBe(400);
      });
    }

    it('/technique-outcomes always uses the latest method and ignores basis', async () => {
      mockTechniqueOutcomes.mockResolvedValue([{ technique: 'T1059', protected: 1, detected: 0, unprotected: 0, lastTestedAt: '2025-01-01T00:00:00.000Z' }]);
      const res = await request(createApp()).get('/api/analytics/technique-outcomes?from=now-30d&org=o1&scoringMode=any-stage');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ technique: 'T1059', protected: 1, detected: 0, unprotected: 0, lastTestedAt: '2025-01-01T00:00:00.000Z' }]);
      expect(mockTechniqueOutcomes).toHaveBeenCalledWith(expect.objectContaining({ from: 'now-30d', org: 'o1' }));

      for (const basis of ['executions', 'bogus']) {
        const r = await request(createApp()).get(`/api/analytics/technique-outcomes?basis=${basis}`);
        expect(r.status).toBe(200);
      }
      expect(mockTechniqueOutcomes).toHaveBeenCalledTimes(3);
    });

    it('/test-results forwards the usual filters (not just org)', async () => {
      mockTestResults.mockResolvedValue([]);
      const res = await request(createApp()).get('/api/analytics/test-results?org=o1&threatActors=APT29&categories=intel-driven');
      expect(res.status).toBe(200);
      expect(mockTestResults).toHaveBeenCalledWith(expect.objectContaining({ org: 'o1', threatActors: 'APT29', categories: 'intel-driven' }));
    });

    it('/test-results returns the per-test fleet results for the org', async () => {
      const body = [{ testUuid: 'b1', pairCount: 2, protectedCount: 1, hostCount: 2, lastRunAt: '2025-01-12T00:00:00.000Z' }];
      mockTestResults.mockResolvedValue(body);
      const res = await request(createApp()).get('/api/analytics/test-results?org=o1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(mockTestResults).toHaveBeenCalledWith(expect.objectContaining({ org: 'o1' }));
    });

    it('/chain-depth always uses the latest chain-depth method and ignores basis', async () => {
      const body = { chains: 1, buckets: [], endToEnd: 1, endToEndAlerted: 0, endToEndBundleNames: ['Chain One'] };
      mockChainDepth.mockResolvedValue(body);
      const res = await request(createApp()).get('/api/analytics/chain-depth?from=now-30d&org=o1&threatActors=APT29&bundleNames=Chain%20One');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(mockChainDepth).toHaveBeenCalledWith(expect.objectContaining({ from: 'now-30d', org: 'o1', threatActors: 'APT29', bundleNames: 'Chain One' }));

      for (const basis of ['executions', 'bogus']) {
        const r = await request(createApp()).get(`/api/analytics/chain-depth?basis=${basis}`);
        expect(r.status).toBe(200);
      }
      expect(mockChainDepth).toHaveBeenCalledTimes(3);
    });
  });

  describe('basis dispatch', () => {
    beforeEach(() => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });
      mockGetDefenseScore.mockResolvedValue({ score: 70 });
      mockGetDefenseScoreLatest.mockResolvedValue({ score: 60, basis: 'latest' });
      mockGetDefenseScoreTrend.mockResolvedValue([]);
      mockGetDefenseScoreTrendRolling.mockResolvedValue([]);
      mockGetDefenseScoreTrendLatest.mockResolvedValue([]);
    });

    it('/defense-score with basis=bogus → 400', async () => {
      const res = await request(createApp()).get('/api/analytics/defense-score?basis=bogus');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid basis');
      expect(mockGetDefenseScore).not.toHaveBeenCalled();
      expect(mockGetDefenseScoreLatest).not.toHaveBeenCalled();
    });

    it('/defense-score/trend with basis=bogus → 400', async () => {
      const res = await request(createApp()).get('/api/analytics/defense-score/trend?basis=bogus');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid basis');
      expect(mockGetDefenseScoreTrend).not.toHaveBeenCalled();
      expect(mockGetDefenseScoreTrendRolling).not.toHaveBeenCalled();
      expect(mockGetDefenseScoreTrendLatest).not.toHaveBeenCalled();
    });

    it('/defense-score without basis calls the executions method', async () => {
      const res = await request(createApp()).get('/api/analytics/defense-score?from=now-7d');
      expect(res.status).toBe(200);
      expect(res.body.score).toBe(70);
      expect(mockGetDefenseScore).toHaveBeenCalledTimes(1);
      expect(mockGetDefenseScoreLatest).not.toHaveBeenCalled();
    });

    it('/defense-score with basis=executions calls the executions method', async () => {
      await request(createApp()).get('/api/analytics/defense-score?basis=executions');
      expect(mockGetDefenseScore).toHaveBeenCalledTimes(1);
      expect(mockGetDefenseScoreLatest).not.toHaveBeenCalled();
    });

    it('/defense-score with basis=latest calls getDefenseScoreLatest with the filter params', async () => {
      const res = await request(createApp()).get('/api/analytics/defense-score?basis=latest&from=now-30d&org=o1&scoringMode=any-stage');
      expect(res.status).toBe(200);
      expect(res.body.basis).toBe('latest');
      expect(mockGetDefenseScoreLatest).toHaveBeenCalledWith(expect.objectContaining({
        basis: 'latest', from: 'now-30d', org: 'o1', scoringMode: 'any-stage',
      }));
      expect(mockGetDefenseScore).not.toHaveBeenCalled();
    });

    it('/defense-score/trend without basis keeps the executions methods', async () => {
      await request(createApp()).get('/api/analytics/defense-score/trend?from=now-30d');
      expect(mockGetDefenseScoreTrend).toHaveBeenCalledTimes(1);
      await request(createApp()).get('/api/analytics/defense-score/trend?from=now-30d&windowDays=7');
      expect(mockGetDefenseScoreTrendRolling).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 7 }));
      expect(mockGetDefenseScoreTrendLatest).not.toHaveBeenCalled();
    });

    it('/defense-score/trend with basis=latest ignores windowDays', async () => {
      await request(createApp()).get('/api/analytics/defense-score/trend?basis=latest&from=now-30d&windowDays=7');
      expect(mockGetDefenseScoreTrendLatest).toHaveBeenCalledTimes(1);
      expect(mockGetDefenseScoreTrendLatest.mock.calls[0][0].windowDays).toBeUndefined();
      expect(mockGetDefenseScoreTrendRolling).not.toHaveBeenCalled();
      expect(mockGetDefenseScoreTrend).not.toHaveBeenCalled();
    });
  });
});
