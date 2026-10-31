import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

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
  getUserOrgId: () => undefined,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  validateRequestOrgId: () => {},
}));

vi.mock('../../services/integrations/settings.js', () => ({
  IntegrationsSettingsService: class MockIntegrationsSettingsService {
    isDefenderConfigured = () => true;
  },
}));

const mockGetAlerts = vi.fn();
const mockGetAlertSummary = vi.fn();
const mockGetAlertTrend = vi.fn();
const mockGetTechniqueCoverage = vi.fn();
const mockGetControlCorrelations = vi.fn();
vi.mock('../../services/defender/analytics.service.js', () => ({
  DefenderAnalyticsService: class MockDefenderAnalyticsService {
    getAlerts = mockGetAlerts;
    getAlertSummary = mockGetAlertSummary;
    getAlertTrend = mockGetAlertTrend;
    getTechniqueCoverage = mockGetTechniqueCoverage;
    getControlCorrelations = mockGetControlCorrelations;
  },
}));

const { default: defenderRoutes } = await import('../defender.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics/defender', defenderRoutes);
  app.use(errorHandler);
  return app;
}

describe('Defender analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAlerts.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 });
    mockGetAlertSummary.mockResolvedValue({ total: 0 });
  });

  describe('GET /alerts', () => {
    it('returns 400 Invalid from/to for an unparsable window', async () => {
      const res = await request(createApp()).get('/api/analytics/defender/alerts?from=bad&to=2026-10-20T00:00:00Z');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid from/to' });
      expect(mockGetAlerts).not.toHaveBeenCalled();
    });

    it('returns 400 Invalid from/to when only from is given', async () => {
      const res = await request(createApp()).get('/api/analytics/defender/alerts?from=bad');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid from/to' });
    });

    it('passes source, a comma severity list and the window to the service', async () => {
      const res = await request(createApp()).get(
        '/api/analytics/defender/alerts?source=test&severity=high,critical'
          + '&from=2026-10-01T00:00:00.000Z&to=2026-10-20T00:00:00.000Z',
      );

      expect(res.status).toBe(200);
      expect(mockGetAlerts).toHaveBeenCalledWith(expect.objectContaining({
        source: 'test',
        severities: ['high', 'critical'],
        window: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' },
      }));
    });

    it('keeps a single severity working', async () => {
      await request(createApp()).get('/api/analytics/defender/alerts?severity=high');

      expect(mockGetAlerts).toHaveBeenCalledWith(expect.objectContaining({ severities: ['high'] }));
    });

    it('sends no source, severities or window when none are given', async () => {
      await request(createApp()).get('/api/analytics/defender/alerts?page=2');

      const params = mockGetAlerts.mock.calls[0][0];
      expect(params.page).toBe(2);
      expect(params.source).toBeUndefined();
      expect(params.severities).toBeUndefined();
      expect(params.window).toBeNull();
    });

    it('returns 400 for an unknown source', async () => {
      const res = await request(createApp()).get('/api/analytics/defender/alerts?source=bogus');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid source' });
    });
  });

  describe('GET /alerts/summary', () => {
    it('passes the window to the service', async () => {
      const res = await request(createApp()).get(
        '/api/analytics/defender/alerts/summary?from=2026-10-01T00:00:00.000Z&to=2026-10-20T00:00:00.000Z',
      );

      expect(res.status).toBe(200);
      expect(mockGetAlertSummary).toHaveBeenCalledWith({
        from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z',
      });
    });

    it('passes a null window when from/to are absent', async () => {
      await request(createApp()).get('/api/analytics/defender/alerts/summary');

      expect(mockGetAlertSummary).toHaveBeenCalledWith(null);
    });

    it('returns 400 Invalid from/to when from >= to', async () => {
      const res = await request(createApp()).get(
        '/api/analytics/defender/alerts/summary?from=2026-10-20T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
      );

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid from/to' });
    });
  });
  describe('GET /alerts/trend', () => {
    it('passes days and a null window when from/to are absent', async () => {
      await request(createApp()).get('/api/analytics/defender/alerts/trend?days=7');

      expect(mockGetAlertTrend).toHaveBeenCalledWith(7, null);
    });

    it('passes a valid window through', async () => {
      const res = await request(createApp()).get(
        '/api/analytics/defender/alerts/trend?from=2026-10-01T00:00:00.000Z&to=2026-10-20T00:00:00.000Z',
      );

      expect(res.status).toBe(200);
      expect(mockGetAlertTrend).toHaveBeenCalledWith(30, {
        from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z',
      });
    });

    it('returns 400 Invalid from/to for from=bad', async () => {
      const res = await request(createApp()).get('/api/analytics/defender/alerts/trend?from=bad&to=2026-10-20T00:00:00Z');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid from/to' });
      expect(mockGetAlertTrend).not.toHaveBeenCalled();
    });
  });

  describe('GET /controls/correlations', () => {
    const URL = '/api/analytics/defender/controls/correlations';

    it('passes every title (axios sends title[]=) and days to one service call', async () => {
      mockGetControlCorrelations.mockResolvedValueOnce([{ title: 'A', coveredTechniques: [], alertCount: 0 }]);
      const res = await request(createApp()).get(`${URL}?title[]=A&title[]=B%2C%20with%20comma&days=14`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ title: 'A', coveredTechniques: [], alertCount: 0 }]);
      expect(mockGetControlCorrelations).toHaveBeenCalledWith(['A', 'B, with comma'], 14);
    });

    it('accepts a single title and defaults days to 30', async () => {
      mockGetControlCorrelations.mockResolvedValueOnce([]);
      await request(createApp()).get(`${URL}?title=A`);
      expect(mockGetControlCorrelations).toHaveBeenCalledWith(['A'], 30);
    });

    it('returns 400 without a title', async () => {
      const res = await request(createApp()).get(URL);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'title is required' });
    });

    it('returns 400 for more than 20 titles, an over-long title or bad days', async () => {
      const many = Array.from({ length: 21 }, (_, i) => `title[]=c${i}`).join('&');
      for (const qs of [many, `title=${'x'.repeat(301)}`, 'title=A&days=0', 'title=A&days=abc', 'title[a]=x']) {
        const res = await request(createApp()).get(`${URL}?${qs}`);
        expect(res.status, qs.slice(0, 30)).toBe(400);
      }
      expect(mockGetControlCorrelations).not.toHaveBeenCalled();
    });
  });

  describe('GET /correlation/technique-coverage', () => {
    it('returns 200 and delegates with the given window', async () => {
      mockGetTechniqueCoverage.mockResolvedValue({ overall: { executions: 0 }, byTechnique: [] });
      const res = await request(createApp()).get(
        '/api/analytics/defender/correlation/technique-coverage?from=2026-09-20T00:00:00Z&to=2026-10-20T00:00:00Z',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ overall: { executions: 0 }, byTechnique: [] });
      // Bounds are normalised to toISOString() before reaching the service.
      expect(mockGetTechniqueCoverage).toHaveBeenCalledWith({
        from: '2026-09-20T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z',
      });
    });

    it('defaults to the last 30 days when from/to are absent', async () => {
      mockGetTechniqueCoverage.mockResolvedValue({ overall: {}, byTechnique: [] });
      const before = Date.now();
      const res = await request(createApp()).get('/api/analytics/defender/correlation/technique-coverage');
      const after = Date.now();

      expect(res.status).toBe(200);
      const window = mockGetTechniqueCoverage.mock.calls[0][0] as { from: string; to: string };
      const to = Date.parse(window.to);
      expect(to).toBeGreaterThanOrEqual(before);
      expect(to).toBeLessThanOrEqual(after);
      expect(to - Date.parse(window.from)).toBe(30 * 86_400_000);
    });

    it.each(['Oct%2020%202026', '2026%2F10%2F20', '2026-10-20%2010%3A00', '1', '2026-10-20T10%3A00%3A00'])(
      'returns 400 Invalid from/to for the non-strict-ISO from=%s without querying ES',
      async (from) => {
        const res = await request(createApp()).get(
          `/api/analytics/defender/correlation/technique-coverage?from=${from}&to=2026-10-21T00:00:00Z`,
        );

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ success: false, error: 'Invalid from/to' });
        expect(mockGetTechniqueCoverage).not.toHaveBeenCalled();
      },
    );

    it('returns 400 Invalid from/to for ?from=x', async () => {
      const res = await request(createApp()).get('/api/analytics/defender/correlation/technique-coverage?from=x');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Invalid from/to' });
      expect(mockGetTechniqueCoverage).not.toHaveBeenCalled();
    });
  });
});
