import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/clerk.middleware.js', () => ({
  requireClerkAuth: () => (req: any, _res: any, next: any) => { req.auth = { userId: 'u1' }; next(); },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

let configured = true;
vi.mock('../../services/integrations/settings.js', () => ({
  IntegrationsSettingsService: class { isSentinelOneConfigured = () => configured; },
}));

const mocks = {
  getAlerts: vi.fn(),
  getAlertSummary: vi.fn(),
  getAlertTrend: vi.fn(),
  getTechniqueCoverage: vi.fn(),
  getScoreComparison: vi.fn(),
  getTechniqueOverlap: vi.fn(),
  getDetectionRate: vi.fn(),
  getAlertsForTest: vi.fn(),
};
vi.mock('../../services/sentinelone/analytics.service.js', () => ({
  SentinelOneAnalyticsService: class {
    getAlerts = mocks.getAlerts;
    getAlertSummary = mocks.getAlertSummary;
    getAlertTrend = mocks.getAlertTrend;
    getTechniqueCoverage = mocks.getTechniqueCoverage;
    getScoreComparison = mocks.getScoreComparison;
    getTechniqueOverlap = mocks.getTechniqueOverlap;
    getDetectionRate = mocks.getDetectionRate;
    getAlertsForTest = mocks.getAlertsForTest;
  },
}));

const posture = {
  getPolicies: vi.fn(),
  getAgentHealth: vi.fn(),
  getExclusionGaps: vi.fn(),
};
let esConfigured = true;
vi.mock('../../services/sentinelone/posture.service.js', () => ({
  SentinelOnePostureService: class {
    getPolicies = posture.getPolicies;
    getAgentHealth = posture.getAgentHealth;
    getExclusionGaps = posture.getExclusionGaps;
  },
}));
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class { getSettings = () => ({ configured: esConfigured, indexPattern: 'achilles-results-*' }); },
}));
vi.mock('../../services/analytics/client.js', () => ({ createEsClient: () => ({}) }));

const { default: routes } = await import('../sentinelone-analytics.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function app() {
  const a = express();
  a.use('/api/analytics/sentinelone', routes);
  a.use(errorHandler);
  return a;
}

describe('SentinelOne analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configured = true;
    for (const m of Object.values(mocks)) m.mockResolvedValue({ ok: true });
  });

  it('400s when SentinelOne is not configured', async () => {
    configured = false;
    const res = await request(app()).get('/api/analytics/sentinelone/alerts');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SentinelOne integration is not configured');
    expect(mocks.getAlerts).not.toHaveBeenCalled();
  });

  it('passes the alert feed filters through', async () => {
    const res = await request(app()).get('/api/analytics/sentinelone/alerts?page=2&severity=critical,high&source=test&from=2026-10-01&to=2026-10-22');
    expect(res.status).toBe(200);
    expect(mocks.getAlerts).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, source: 'test', severities: ['critical', 'high'],
      window: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' },
    }));
  });

  it.each([
    ['/alerts/summary', 'getAlertSummary'],
    ['/alerts/trend', 'getAlertTrend'],
    ['/correlation/scores', 'getScoreComparison'],
    ['/correlation/techniques', 'getTechniqueOverlap'],
    ['/correlation/technique-coverage', 'getTechniqueCoverage'],
    ['/correlation/detection-rate', 'getDetectionRate'],
  ] as const)('GET %s is served', async (path, method) => {
    const res = await request(app()).get(`/api/analytics/sentinelone${path}`);
    expect(res.status).toBe(200);
    expect(mocks[method]).toHaveBeenCalled();
  });

  it('alerts-for-test requires techniques and timestamp', async () => {
    expect((await request(app()).get('/api/analytics/sentinelone/correlation/alerts-for-test')).status).toBe(400);
    const ok = await request(app()).get('/api/analytics/sentinelone/correlation/alerts-for-test?techniques=T1003,T1059&timestamp=2026-10-20T10:00:00Z&hostname=WIN-01');
    expect(ok.status).toBe(200);
    expect(mocks.getAlertsForTest).toHaveBeenCalledWith(['T1003', 'T1059'], '2026-10-20T10:00:00Z', 30, 'WIN-01', undefined, undefined);
  });

  it('exposes no ZTA score route', async () => {
    expect((await request(app()).get('/api/analytics/sentinelone/zta-score')).status).toBe(404);
  });
});

describe('SentinelOne analytics — source type filter and posture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configured = true;
    esConfigured = true;
    for (const m of Object.values(mocks)) m.mockResolvedValue({ ok: true });
    posture.getPolicies.mockResolvedValue([{ level: 'site', mitigation_mode: 'protect' }]);
    posture.getAgentHealth.mockResolvedValue({ latest: { total: 3 }, trend: [] });
    posture.getExclusionGaps.mockResolvedValue({ flagged: [] });
  });

  it('whitelists sourceType', async () => {
    await request(app()).get('/api/analytics/sentinelone/alerts?sourceType=threats');
    expect(mocks.getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ sourceType: 'threats' }));
    await request(app()).get('/api/analytics/sentinelone/alerts?sourceType=cloud_detection_alerts');
    expect(mocks.getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ sourceType: 'cloud_detection_alerts' }));
    await request(app()).get('/api/analytics/sentinelone/alerts?sourceType=evil');
    expect(mocks.getAlerts.mock.calls.at(-1)![0].sourceType).toBeUndefined();
  });

  it('serves the posture snapshot endpoints', async () => {
    expect((await request(app()).get('/api/analytics/sentinelone/posture/policies')).body).toEqual({ items: [{ level: 'site', mitigation_mode: 'protect' }] });
    await request(app()).get('/api/analytics/sentinelone/posture/agent-health?days=9999');
    expect(posture.getAgentHealth).toHaveBeenCalledWith(365);
    await request(app()).get('/api/analytics/sentinelone/posture/exclusion-gaps?from=2026-10-01&to=2026-10-22');
    expect(posture.getExclusionGaps).toHaveBeenCalledWith('achilles-results-*', expect.objectContaining({ from: '2026-10-01T00:00:00.000Z' }));
  });

  it('returns empty posture when Elasticsearch is not configured', async () => {
    esConfigured = false;
    expect((await request(app()).get('/api/analytics/sentinelone/posture/policies')).body).toEqual({ items: [] });
    expect((await request(app()).get('/api/analytics/sentinelone/posture/agent-health')).body).toEqual({ latest: null, trend: [] });
    expect((await request(app()).get('/api/analytics/sentinelone/posture/exclusion-gaps')).body).toMatchObject({ flagged: [], exclusionsTotal: 0 });
  });
});
