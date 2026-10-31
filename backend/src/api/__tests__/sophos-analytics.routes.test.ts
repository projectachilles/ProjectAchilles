import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/clerk.middleware.js', () => ({
  requireClerkAuth: () => (req: any, _res: any, next: any) => { req.auth = { userId: 'u1' }; next(); },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

let configured = true;
vi.mock('../../services/integrations/settings.js', () => ({
  IntegrationsSettingsService: class { isSophosConfigured = () => configured; },
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
  getAlertsForTests: vi.fn(),
};
vi.mock('../../services/sophos/analytics.service.js', () => ({
  SophosAnalyticsService: class {
    getAlerts = mocks.getAlerts;
    getAlertSummary = mocks.getAlertSummary;
    getAlertTrend = mocks.getAlertTrend;
    getTechniqueCoverage = mocks.getTechniqueCoverage;
    getScoreComparison = mocks.getScoreComparison;
    getTechniqueOverlap = mocks.getTechniqueOverlap;
    getDetectionRate = mocks.getDetectionRate;
    getAlertsForTest = mocks.getAlertsForTest;
    getAlertsForTests = mocks.getAlertsForTests;
  },
}));

const posture = {
  getHealthCheck: vi.fn(),
  getEndpointHealth: vi.fn(),
  getPolicies: vi.fn(),
  getExclusionGaps: vi.fn(),
};
let esConfigured = true;
vi.mock('../../services/sophos/posture.service.js', () => ({
  SophosPostureService: class {
    getHealthCheck = posture.getHealthCheck;
    getEndpointHealth = posture.getEndpointHealth;
    getPolicies = posture.getPolicies;
    getExclusionGaps = posture.getExclusionGaps;
  },
  resolveActiveAchillesCert: () => ({ subjectCn: 'F0RT1KA', sha256: 'ab' }),
}));
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class { getSettings = () => ({ configured: esConfigured, indexPattern: 'achilles-results-*' }); },
}));
vi.mock('../../services/analytics/client.js', () => ({ createEsClient: () => ({}) }));

const { default: routes } = await import('../sophos-analytics.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function app() {
  const a = express();
  a.use(express.json()); // as in server.ts
  a.use('/api/analytics/sophos', routes);
  a.use(errorHandler);
  return a;
}

const P = '/api/analytics/sophos';

describe('Sophos analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configured = true;
    esConfigured = true;
    for (const m of [...Object.values(mocks), ...Object.values(posture)]) m.mockResolvedValue({ ok: true });
  });

  it('analytics routes 400 when unconfigured', async () => {
    configured = false;
    for (const path of ['/alerts', '/alerts/summary', '/posture/health-check', '/posture/endpoint-health']) {
      const res = await request(app()).get(`${P}${path}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Sophos integration is not configured');
    }
    expect(mocks.getAlerts).not.toHaveBeenCalled();
    expect(posture.getHealthCheck).not.toHaveBeenCalled();
  });

  it('passes the alert feed filters through and accepts only the three sourceTypes', async () => {
    const res = await request(app()).get(`${P}/alerts?page=2&severity=critical,high&source=test&sourceType=xdr_detection&from=2026-10-01&to=2026-10-22`);
    expect(res.status).toBe(200);
    expect(mocks.getAlerts).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, source: 'test', severities: ['critical', 'high'], sourceType: 'xdr_detection',
      window: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' },
    }));
    for (const ok of ['alert', 'siem_event', 'xdr_detection']) {
      mocks.getAlerts.mockClear();
      await request(app()).get(`${P}/alerts?sourceType=${ok}`);
      expect(mocks.getAlerts.mock.calls[0][0].sourceType).toBe(ok);
    }
    mocks.getAlerts.mockClear();
    await request(app()).get(`${P}/alerts?sourceType=threats`);
    expect(mocks.getAlerts.mock.calls[0][0].sourceType).toBeUndefined();
  });

  it.each([
    ['/alerts/summary', 'getAlertSummary'],
    ['/alerts/trend', 'getAlertTrend'],
    ['/correlation/scores', 'getScoreComparison'],
    ['/correlation/techniques', 'getTechniqueOverlap'],
    ['/correlation/technique-coverage', 'getTechniqueCoverage'],
    ['/correlation/detection-rate', 'getDetectionRate'],
  ] as const)('GET %s is served', async (path, method) => {
    const res = await request(app()).get(`${P}${path}`);
    expect(res.status).toBe(200);
    expect(mocks[method]).toHaveBeenCalled();
  });

  it('technique-coverage defaults to a coverage window', async () => {
    await request(app()).get(`${P}/correlation/technique-coverage`);
    expect(mocks.getTechniqueCoverage.mock.calls[0][0]).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });

  it('alerts-for-test needs techniques and timestamp', async () => {
    expect((await request(app()).get(`${P}/correlation/alerts-for-test`)).status).toBe(400);
    const ok = await request(app()).get(`${P}/correlation/alerts-for-test?techniques=T1059,T1486&timestamp=2026-10-20T10:00:00Z&hostname=H1`);
    expect(ok.status).toBe(200);
    expect(mocks.getAlertsForTest.mock.calls[0].slice(0, 2)).toEqual([['T1059', 'T1486'], '2026-10-20T10:00:00Z']);
  });

  it('POST alerts-for-tests answers every stage in one call, in order', async () => {
    mocks.getAlertsForTests.mockResolvedValue([{ alerts: [], matchedTechniques: [], total: 0 }, null]);
    const items = [
      { techniques: ['T1059'], timestamp: '2026-10-20T10:00:00Z', hostname: 'H1', binaryName: 'u.exe' },
      { techniques: ['T1486'], timestamp: '2026-10-20T10:05:00Z', hostname: 'H1', binaryName: 'u.exe' },
    ];
    const res = await request(app()).post(`${P}/correlation/alerts-for-tests`).send({ items });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ alerts: [], matchedTechniques: [], total: 0 }, null]);
    expect(mocks.getAlertsForTests).toHaveBeenCalledTimes(1);
    expect(mocks.getAlertsForTests.mock.calls[0][0]).toMatchObject([{ techniques: ['T1059'], windowMinutes: 30 }, { techniques: ['T1486'] }]);

    expect((await request(app()).post(`${P}/correlation/alerts-for-tests`).send({ items: [] })).status).toBe(400);
  });

  it('POST alerts-for-tests answers the good stages when one stage is malformed', async () => {
    mocks.getAlertsForTests.mockReset();
    mocks.getAlertsForTests.mockResolvedValue([{ alerts: [], matchedTechniques: ['T1059'], total: 0 }]);
    const res = await request(app()).post(`${P}/correlation/alerts-for-tests`).send({
      items: [
        { techniques: [], timestamp: '2026-10-20T10:00:00Z' },
        { techniques: ['T1059'], timestamp: '2026-10-20T10:05:00Z', hostname: 'H1' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([null, { alerts: [], matchedTechniques: ['T1059'], total: 0 }]);
    expect(res.body.errors).toEqual(['techniques and timestamp are required', null]);
    expect(mocks.getAlertsForTests.mock.calls[0][0]).toHaveLength(1);
  });

  it('GET /posture/health-check returns latest + trend', async () => {
    const body = { latest: { headline: 80, categories: [], items: {} }, trend: [{ date: '2026-10-27', score: 80 }] };
    posture.getHealthCheck.mockResolvedValue(body);
    const res = await request(app()).get(`${P}/posture/health-check?days=14`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(posture.getHealthCheck).toHaveBeenCalledWith(14);
    posture.getHealthCheck.mockClear();
    await request(app()).get(`${P}/posture/health-check?days=9999`);
    expect(posture.getHealthCheck).toHaveBeenCalledWith(365);
  });

  it('serves endpoint-health and policies', async () => {
    posture.getPolicies.mockResolvedValue([{ id: 'p' }]);
    expect((await request(app()).get(`${P}/posture/endpoint-health`)).status).toBe(200);
    expect((await request(app()).get(`${P}/posture/policies`)).body).toEqual({ items: [{ id: 'p' }] });
  });

  it('exclusion-gaps passes the results index pattern, window and active cert', async () => {
    await request(app()).get(`${P}/posture/exclusion-gaps?from=2026-10-01&to=2026-10-22`);
    expect(posture.getExclusionGaps).toHaveBeenCalledWith(
      'achilles-results-*',
      { from: '2026-10-01T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' },
      { subjectCn: 'F0RT1KA', sha256: 'ab' },
    );
  });

  it('posture routes answer empty when Elasticsearch is not configured', async () => {
    esConfigured = false;
    expect((await request(app()).get(`${P}/posture/health-check`)).body).toEqual({ latest: null, trend: [] });
    expect((await request(app()).get(`${P}/posture/policies`)).body).toEqual({ items: [] });
    expect((await request(app()).get(`${P}/posture/exclusion-gaps`)).body).toEqual({ critical: [], gaps: [], notes: [] });
    expect((await request(app()).get(`${P}/posture/endpoint-health`)).body).toMatchObject({ total: 0 });
  });
});
