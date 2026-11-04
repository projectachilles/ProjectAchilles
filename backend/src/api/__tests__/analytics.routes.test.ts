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

// Mock SSRF validation — tests use placeholder hostnames that don't resolve.
// Production behavior (DNS lookup, private-IP rejection) is exercised in the
// dedicated middleware tests for urlValidation.
vi.mock('../../middleware/urlValidation.js', () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(undefined),
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
const mockArchiveByGroupKeys = vi.fn();
const mockArchiveByDateRange = vi.fn();
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
const mockOutcomeBreakdown = vi.fn();
const mockTestResults = vi.fn();
vi.mock('../../services/analytics/elasticsearch.js', () => ({
  ElasticsearchService: class MockElasticsearchService {
    testConnection = mockTestConnection;
    archiveByGroupKeys = mockArchiveByGroupKeys;
    archiveByDateRange = mockArchiveByDateRange;
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
    getOutcomeBreakdown = mockOutcomeBreakdown;
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

    it('clears stale cloudId/apiKey when switching from cloud → self-hosted', async () => {
      // Existing config: cloud-mode for the OLD cluster
      mockGetSettings.mockReturnValue({
        configured: true,
        connectionType: 'cloud',
        cloudId: 'OLD_ENCRYPTED_CLOUD_ID',
        apiKey: 'OLD_API_KEY_FOR_CLOUD',
        node: '',
        username: '',
        password: '',
        indexPattern: 'achilles-*',
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/settings')
        .send({
          connectionType: 'self-hosted',
          node: 'https://new-cluster.example.com',
          apiKey: 'NEW_DIRECT_API_KEY',
        });

      expect(res.status).toBe(200);
      const saved = mockSaveSettings.mock.calls.at(-1)?.[0];
      // Mode switched: stale cloud creds must NOT carry over
      expect(saved.cloudId).toBe('');
      expect(saved.apiKey).toBe('NEW_DIRECT_API_KEY');
      expect(saved.node).toBe('https://new-cluster.example.com');
      expect(saved.connectionType).toBe('self-hosted');
    });

    it('preserves the saved apiKey for the same cluster, never for a new node (regression guard)', async () => {
      mockGetSettings.mockReturnValue({
        configured: true,
        connectionType: 'self-hosted',
        cloudId: '',
        apiKey: 'EXISTING_DIRECT_KEY',
        node: 'https://existing.example.com',
        username: '',
        password: '',
        indexPattern: 'achilles-*',
      });

      const app = createApp();
      // Same cluster (node blank = keep current), only the index pattern changes:
      // a blank apiKey keeps the saved one.
      const res = await request(app)
        .post('/api/analytics/settings')
        .send({
          connectionType: 'self-hosted',
          indexPattern: 'achilles-results-*',
        });

      expect(res.status).toBe(200);
      const saved = mockSaveSettings.mock.calls.at(-1)?.[0];
      expect(saved.apiKey).toBe('EXISTING_DIRECT_KEY');
      expect(saved.node).toBe('https://existing.example.com');

      // A new node is a new cluster: the saved key is not carried over to it.
      await request(app)
        .post('/api/analytics/settings')
        .send({ connectionType: 'self-hosted', node: 'https://updated.example.com' });
      const moved = mockSaveSettings.mock.calls.at(-1)?.[0];
      expect(moved.node).toBe('https://updated.example.com');
      expect(moved.apiKey).toBe('');
    });

    it('does not treat first-time setup as a mode switch', async () => {
      // No prior config — `configured: false` (or absent)
      mockGetSettings.mockReturnValue({});

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/settings')
        .send({
          connectionType: 'cloud',
          cloudId: 'first-cloud-id',
          apiKey: 'first-api-key',
        });

      expect(res.status).toBe(200);
      const saved = mockSaveSettings.mock.calls.at(-1)?.[0];
      expect(saved.cloudId).toBe('first-cloud-id');
      expect(saved.apiKey).toBe('first-api-key');
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

  describe('POST /api/analytics/executions/archive', () => {
    it('returns 400 when groupKeys is empty', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive')
        .send({ groupKeys: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when groupKeys is not an array', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive')
        .send({ groupKeys: 'not-an-array' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when a group key has invalid prefix', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive')
        .send({ groupKeys: ['invalid::foo::bar'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('calls service on valid input', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });
      mockArchiveByGroupKeys.mockResolvedValue({ archived: 3, errors: [] });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive')
        .send({ groupKeys: ['standalone::uuid-001::host-a', 'bundle::b1::host-b'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.archived).toBe(3);
      expect(mockArchiveByGroupKeys).toHaveBeenCalledWith(['standalone::uuid-001::host-a', 'bundle::b1::host-b'], undefined);
    });
  });

  describe('POST /api/analytics/executions/archive-by-date', () => {
    it('returns 400 when before is missing', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive-by-date')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when before is not a valid date', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive-by-date')
        .send({ before: 'not-a-date' });

      expect(res.status).toBe(400);
    });

    it('calls service on valid date', async () => {
      mockGetSettings.mockReturnValue({ configured: true, connectionType: 'direct', node: 'http://localhost:9200' });
      mockArchiveByDateRange.mockResolvedValue({ archived: 15, errors: [] });

      const app = createApp();
      const res = await request(app)
        .post('/api/analytics/executions/archive-by-date')
        .send({ before: '2025-01-01T00:00:00Z' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.archived).toBe(15);
      expect(mockArchiveByDateRange).toHaveBeenCalledWith('2025-01-01T00:00:00Z', undefined);
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

  describe('outcome breakdown', () => {
    it('/outcome-breakdown returns the service result and does not pass basis', async () => {
      const body = { pairCount: 3, protected: 1, prevented: 1, detected: 0, silent: 1, noConclusive: 0, riskAccepted: 0, windowLabel: 'Last 30 days' };
      mockOutcomeBreakdown.mockResolvedValue(body);
      const res = await request(createApp()).get('/api/analytics/outcome-breakdown?basis=executions&org=o1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      const arg = mockOutcomeBreakdown.mock.calls[0][0];
      expect(arg).toEqual(expect.objectContaining({ org: 'o1' }));
      expect(arg.basis).toBeUndefined();
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
