import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  getUserOrgId: () => undefined,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  validateRequestOrgId: () => {},
}));

// Mock the settings service
const mockGetCrowdStrikeSettingsMasked = vi.fn();
const mockSaveCrowdStrikeSettings = vi.fn();
const mockDeleteCrowdStrikeSettings = vi.fn();
const mockIsCrowdStrikeConfigured = vi.fn();
const mockGetCrowdStrikeCredentials = vi.fn();
const mockIsEnvCrowdStrikeConfigured = vi.fn();
const mockGetCrowdStrikeAutoResolveMode = vi.fn();
const mockSetCrowdStrikeAutoResolveMode = vi.fn();

vi.mock('../../services/integrations/settings.js', () => ({
  IntegrationsSettingsService: class MockIntegrationsSettingsService {
    getAzureSettings = vi.fn().mockReturnValue(null);
    saveAzureSettings = vi.fn();
    isAzureConfigured = vi.fn().mockReturnValue(false);
    getAzureCredentials = vi.fn().mockReturnValue(null);
    isEnvConfigured = vi.fn().mockReturnValue(false);
    getDefenderSettings = vi.fn().mockReturnValue(null);
    saveDefenderSettings = vi.fn();
    deleteDefenderSettings = vi.fn();
    deleteAzureSettings = vi.fn();
    isDefenderConfigured = vi.fn().mockReturnValue(false);
    getDefenderCredentials = vi.fn().mockReturnValue(null);
    isEnvDefenderConfigured = vi.fn().mockReturnValue(false);
    getAutoResolveMode = vi.fn().mockReturnValue('disabled');
    setAutoResolveMode = vi.fn();
    getCrowdStrikeSettingsMasked = mockGetCrowdStrikeSettingsMasked;
    saveCrowdStrikeSettings = mockSaveCrowdStrikeSettings;
    deleteCrowdStrikeSettings = mockDeleteCrowdStrikeSettings;
    isCrowdStrikeConfigured = mockIsCrowdStrikeConfigured;
    getCrowdStrikeCredentials = mockGetCrowdStrikeCredentials;
    isEnvCrowdStrikeConfigured = mockIsEnvCrowdStrikeConfigured;
    getCrowdStrikeAutoResolveMode = mockGetCrowdStrikeAutoResolveMode;
    setCrowdStrikeAutoResolveMode = mockSetCrowdStrikeAutoResolveMode;
  },
}));

// Mock the analytics settings service — auto-resolve routes query ES.
// Default: unconfigured, which short-circuits ES queries to empty results.
const mockGetAnalyticsSettings = vi.fn();
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class MockAnalyticsSettingsService {
    getSettings = mockGetAnalyticsSettings;
  },
}));

const mockEsCount = vi.fn();
const mockEsSearch = vi.fn();
vi.mock('../../services/analytics/client.js', () => ({
  createEsClient: () => ({ count: mockEsCount, search: mockEsSearch }),
}));

// Mock both sync services — saving credentials kicks off a background sync,
// which must not reach Graph/Falcon/ES from tests.
const mockDefenderSyncAll = vi.fn();
vi.mock('../../services/defender/sync.service.js', () => ({
  DefenderSyncService: class MockDefenderSyncService {
    syncAll = mockDefenderSyncAll;
    getSyncStatus = () => ({ lastSyncResult: null });
  },
}));

const mockCrowdStrikeSyncAll = vi.fn();
const mockCrowdStrikeGetSyncStatus = vi.fn();
vi.mock('../../services/crowdstrike/sync.service.js', () => ({
  CrowdStrikeSyncService: class MockCrowdStrikeSyncService {
    syncAll = mockCrowdStrikeSyncAll;
    getSyncStatus = mockCrowdStrikeGetSyncStatus;
  },
}));

// Mock global fetch for the /crowdstrike/test endpoint (real FalconClient,
// stubbed HTTP).
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { default: integrationsRoutes } = await import('../integrations.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationsRoutes);
  app.use(errorHandler);
  return app;
}

const VALID_CLIENT_ID = '0123456789abcdef0123456789abcdef';

// Helper: successful Falcon OAuth2 token response + combined alerts probe
function mockFalconTestSuccess() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ access_token: 'test-token', expires_in: 1799 }),
  });
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ meta: { pagination: {} }, resources: [], errors: [] }),
  });
}

describe('CrowdStrike integration routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCrowdStrikeSettingsMasked.mockReturnValue({ configured: false, env_configured: false });
    mockIsCrowdStrikeConfigured.mockReturnValue(false);
    mockGetCrowdStrikeCredentials.mockReturnValue(null);
    mockIsEnvCrowdStrikeConfigured.mockReturnValue(false);
    mockGetCrowdStrikeAutoResolveMode.mockReturnValue('disabled');
    mockGetAnalyticsSettings.mockReturnValue({ configured: false });
    mockCrowdStrikeSyncAll.mockResolvedValue({});
    mockCrowdStrikeGetSyncStatus.mockReturnValue({ lastSyncResult: null });
    mockDefenderSyncAll.mockResolvedValue({});
  });

  // ── Multi-tenant mode: the shared EDR config can't be changed by an org ──

  describe('REQUIRE_ORG_ISOLATION=true', () => {
    beforeEach(() => { process.env.REQUIRE_ORG_ISOLATION = 'true'; });
    afterEach(() => { delete process.env.REQUIRE_ORG_ISOLATION; });

    it('refuses writes to the deployment-wide CrowdStrike and Defender settings (403), reads still work', async () => {
      const app = createApp();
      const save = await request(app).post('/api/integrations/crowdstrike').send({ client_id: 'id', client_secret: 'secret-secret' });
      expect(save.status).toBe(403);
      expect(save.body.error).toMatch(/shared by every organization/);
      expect(mockSaveCrowdStrikeSettings).not.toHaveBeenCalled();
      expect((await request(app).delete('/api/integrations/crowdstrike')).status).toBe(403);
      expect((await request(app).put('/api/integrations/crowdstrike/auto-resolve/mode').send({ mode: 'enabled' })).status).toBe(403);
      expect((await request(app).delete('/api/integrations/defender')).status).toBe(403);
      expect((await request(app).get('/api/integrations/crowdstrike')).status).toBe(200);
    });
  });

  // ── GET /api/integrations/crowdstrike ──────────────────────────

  describe('GET /api/integrations/crowdstrike', () => {
    it('returns not-configured when no settings exist', async () => {
      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false, env_configured: false });
    });

    it('returns masked settings when configured', async () => {
      mockGetCrowdStrikeSettingsMasked.mockReturnValue({
        configured: true,
        base_url: 'https://api.us-2.crowdstrike.com',
        region: 'us-2',
        client_id: VALID_CLIENT_ID,
        label: 'My Falcon',
        client_secret_set: true,
        env_configured: false,
      });

      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.base_url).toBe('https://api.us-2.crowdstrike.com');
      expect(res.body.client_id).toBe(VALID_CLIENT_ID);
      expect(res.body.client_secret_set).toBe(true);
      // Should not expose the raw secret
      expect(res.body.client_secret).toBeUndefined();
    });
  });

  // ── POST /api/integrations/crowdstrike ─────────────────────────

  describe('POST /api/integrations/crowdstrike', () => {
    it('requires client_id and client_secret on initial setup', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike')
        .send({ client_id: VALID_CLIENT_ID });

      expect(res.status).toBe(400);
      expect(mockCrowdStrikeSyncAll).not.toHaveBeenCalled();
    });

    it('rejects a malformed client_id via schema validation', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike')
        .send({ client_id: 'not-hex', client_secret: 'secret' });

      expect(res.status).toBe(400);
      expect(mockSaveCrowdStrikeSettings).not.toHaveBeenCalled();
    });

    it('saves when all fields provided and kicks a background sync', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike')
        .send({
          region: 'us-2',
          client_id: VALID_CLIENT_ID,
          client_secret: 'my-secret',
          label: 'Test',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockSaveCrowdStrikeSettings).toHaveBeenCalledWith({
        region: 'us-2',
        client_id: VALID_CLIENT_ID,
        client_secret: 'my-secret',
        label: 'Test',
      });
      expect(mockCrowdStrikeSyncAll).toHaveBeenCalledTimes(1);
    });

    it('still responds 200 when the post-save sync rejects', async () => {
      mockCrowdStrikeSyncAll.mockRejectedValueOnce(new Error('falcon down'));

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike')
        .send({
          client_id: VALID_CLIENT_ID,
          client_secret: 'my-secret',
        });

      expect(res.status).toBe(200);
    });

    it('allows partial update on edit', async () => {
      mockIsCrowdStrikeConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike')
        .send({ label: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });

  // ── POST /api/integrations/crowdstrike/test ────────────────────

  describe('POST /api/integrations/crowdstrike/test', () => {
    it('returns error when credentials missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Missing credentials/);
    });

    it('returns success on valid OAuth2 token acquisition + alerts probe', async () => {
      mockFalconTestSuccess();

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({
          client_id: VALID_CLIENT_ID,
          client_secret: 'valid-secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/Successfully connected/);

      // Token endpoint on the default us-1 base URL, form-encoded
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://api.crowdstrike.com/oauth2/token');
      expect(tokenCall[1].method).toBe('POST');
      expect(tokenCall[1].body).toContain(`client_id=${VALID_CLIENT_ID}`);

      // Then the limit:1 combined alerts probe
      const probeCall = mockFetch.mock.calls[1];
      expect(probeCall[0]).toBe('https://api.crowdstrike.com/alerts/combined/alerts/v1');
    });

    it('uses the region-specific base URL when region is provided', async () => {
      mockFalconTestSuccess();

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({
          region: 'eu-1',
          client_id: VALID_CLIENT_ID,
          client_secret: 'valid-secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.eu-1.crowdstrike.com/oauth2/token');
    });

    it('ignores a base_url sent in the body — fetch target comes from the region map only (SSRF regression)', async () => {
      // CodeQL js/request-forgery fix: the schema carries no base_url field,
      // so a client-supplied URL is stripped by validation and never reaches
      // fetch. Pin that at the route level.
      mockFalconTestSuccess();

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({
          base_url: 'https://falcon-proxy.internal.example.com',
          region: 'eu-1',
          client_id: VALID_CLIENT_ID,
          client_secret: 'valid-secret',
        });

      expect(res.status).toBe(200);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.eu-1.crowdstrike.com/oauth2/token');
      for (const call of mockFetch.mock.calls) {
        expect(call[0] as string).not.toContain('falcon-proxy.internal.example.com');
      }
    });

    it('returns error on OAuth2 failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_description: 'Invalid client secret' }),
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({
          client_id: VALID_CLIENT_ID,
          client_secret: 'invalid-secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid client secret/);
    });

    it('falls back to stored credentials (stored region wins over us-1 default)', async () => {
      mockGetCrowdStrikeCredentials.mockReturnValue({
        region: 'us-2',
        client_id: VALID_CLIENT_ID,
        client_secret: 'stored-secret',
      });

      mockFalconTestSuccess();

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.us-2.crowdstrike.com/oauth2/token');
    });

    it('handles network error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/crowdstrike/test')
        .send({
          client_id: VALID_CLIENT_ID,
          client_secret: 'secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/fetch failed/);
    });
  });

  // ── DELETE /api/integrations/crowdstrike ─────────────────────────

  describe('DELETE /api/integrations/crowdstrike', () => {
    it('deletes settings successfully', async () => {
      const app = createApp();
      const res = await request(app).delete('/api/integrations/crowdstrike');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockDeleteCrowdStrikeSettings).toHaveBeenCalled();
    });

    it('returns 400 when env vars configured', async () => {
      mockIsEnvCrowdStrikeConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await request(app).delete('/api/integrations/crowdstrike');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/environment variables/);
      expect(mockDeleteCrowdStrikeSettings).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/integrations/crowdstrike/sync ────────────────────

  describe('POST /api/integrations/crowdstrike/sync', () => {
    it('returns 400 when not configured', async () => {
      const app = createApp();
      const res = await request(app).post('/api/integrations/crowdstrike/sync');

      expect(res.status).toBe(400);
      expect(mockCrowdStrikeSyncAll).not.toHaveBeenCalled();
    });

    it('triggers a full sync when configured', async () => {
      mockIsCrowdStrikeConfigured.mockReturnValue(true);
      mockCrowdStrikeSyncAll.mockResolvedValueOnce({ alerts: { synced: 3, errors: [] } });

      const app = createApp();
      const res = await request(app).post('/api/integrations/crowdstrike/sync');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockCrowdStrikeSyncAll).toHaveBeenCalledTimes(1);
    });
  });

  // ── GET /api/integrations/crowdstrike/sync/status ──────────────

  describe('GET /api/integrations/crowdstrike/sync/status', () => {
    it('returns the sync service status', async () => {
      mockCrowdStrikeGetSyncStatus.mockReturnValue({
        lastAlertSync: '2026-10-01T00:00:00Z',
        lastZtaSync: null,
        ztaStatus: 'not_licensed',
        lastSyncResult: null,
        lastAttemptAt: null,
        lastError: null,
      });

      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/sync/status');

      expect(res.status).toBe(200);
      expect(res.body.ztaStatus).toBe('not_licensed');
      expect(res.body.lastAlertSync).toBe('2026-10-01T00:00:00Z');
    });
  });

  // ── GET /api/integrations/crowdstrike/auto-resolve/status ───────

  describe('GET /api/integrations/crowdstrike/auto-resolve/status', () => {
    it("returns mode='disabled' with zero counts when ES not configured", async () => {
      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/auto-resolve/status');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe('disabled');
      expect(res.body.data.counts).toEqual({ last24h: 0, last7d: 0, last30d: 0 });
      // ES count should NOT have been called since analytics is unconfigured
      expect(mockEsCount).not.toHaveBeenCalled();
    });

    it('returns current mode and counts when ES configured', async () => {
      mockGetCrowdStrikeAutoResolveMode.mockReturnValue('dry_run');
      mockGetAnalyticsSettings.mockReturnValue({ configured: true, connectionType: 'node', node: 'http://es:9200' });
      mockEsCount.mockResolvedValueOnce({ count: 5 })  // last24h
        .mockResolvedValueOnce({ count: 20 })          // last7d
        .mockResolvedValueOnce({ count: 80 });         // last30d

      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/auto-resolve/status');

      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('dry_run');
      expect(res.body.data.counts).toEqual({ last24h: 5, last7d: 20, last30d: 80 });

      // Counts must target the crowdstrike index
      expect(mockEsCount.mock.calls[0][0].index).toBe('achilles-crowdstrike');
    });

    it('survives ES count errors gracefully (returns zero for failing window)', async () => {
      mockGetAnalyticsSettings.mockReturnValue({ configured: true, connectionType: 'node', node: 'http://es:9200' });
      mockEsCount.mockRejectedValue(new Error('index not found'));

      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/auto-resolve/status');

      expect(res.status).toBe(200);
      expect(res.body.data.counts).toEqual({ last24h: 0, last7d: 0, last30d: 0 });
    });
  });

  // ── PUT /api/integrations/crowdstrike/auto-resolve/mode ─────────

  describe('PUT /api/integrations/crowdstrike/auto-resolve/mode', () => {
    it("accepts 'dry_run' and calls setCrowdStrikeAutoResolveMode", async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/integrations/crowdstrike/auto-resolve/mode')
        .send({ mode: 'dry_run' });

      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('dry_run');
      expect(mockSetCrowdStrikeAutoResolveMode).toHaveBeenCalledWith('dry_run');
    });

    it("accepts 'enabled'", async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/integrations/crowdstrike/auto-resolve/mode')
        .send({ mode: 'enabled' });

      expect(res.status).toBe(200);
      expect(mockSetCrowdStrikeAutoResolveMode).toHaveBeenCalledWith('enabled');
    });

    it('rejects an invalid mode via schema validation', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/integrations/crowdstrike/auto-resolve/mode')
        .send({ mode: 'bogus' });

      expect(res.status).toBe(400);
      expect(mockSetCrowdStrikeAutoResolveMode).not.toHaveBeenCalled();
    });

    it('rejects a missing mode field', async () => {
      const app = createApp();
      const res = await request(app)
        .put('/api/integrations/crowdstrike/auto-resolve/mode')
        .send({});

      expect(res.status).toBe(400);
    });

    it('surfaces a 400 when the setter throws (e.g., CrowdStrike not configured)', async () => {
      mockSetCrowdStrikeAutoResolveMode.mockImplementation(() => {
        throw new Error('Cannot set auto_resolve_mode: CrowdStrike integration is not configured');
      });

      const app = createApp();
      const res = await request(app)
        .put('/api/integrations/crowdstrike/auto-resolve/mode')
        .send({ mode: 'enabled' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not configured/);
    });
  });

  // ── GET /api/integrations/crowdstrike/auto-resolve/receipts ─────

  describe('GET /api/integrations/crowdstrike/auto-resolve/receipts', () => {
    it('returns empty list when ES not configured', async () => {
      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/auto-resolve/receipts');

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(mockEsSearch).not.toHaveBeenCalled();
    });

    it('maps ES hits to receipt rows', async () => {
      mockGetAnalyticsSettings.mockReturnValue({ configured: true, connectionType: 'node', node: 'http://es:9200' });
      mockEsSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 2 },
          hits: [
            {
              _source: {
                alert_id: 'alert-1',
                alert_title: 'Suspicious process',
                severity: 'medium',
                f0rtika: {
                  auto_resolved_at: '2026-10-01T12:00:00Z',
                  auto_resolve_mode: 'enabled',
                  achilles_test_uuid: 'bundle-A',
                },
              },
            },
            {
              _source: {
                alert_id: 'alert-2',
                alert_title: 'Other',
                severity: 'low',
                f0rtika: {
                  auto_resolved_at: '2026-10-01T11:00:00Z',
                  auto_resolve_mode: 'dry_run',
                  achilles_test_uuid: 'bundle-B',
                  auto_resolve_error: 'not_found',
                },
              },
            },
          ],
        },
      });

      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/auto-resolve/receipts?limit=10');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items[0]).toMatchObject({
        alert_id: 'alert-1',
        auto_resolve_mode: 'enabled',
        achilles_test_uuid: 'bundle-A',
      });
      expect(res.body.data.items[1].auto_resolve_error).toBe('not_found');

      expect(mockEsSearch.mock.calls[0][0].index).toBe('achilles-crowdstrike');
    });

    it('clamps limit to max 100', async () => {
      mockGetAnalyticsSettings.mockReturnValue({ configured: true, connectionType: 'node', node: 'http://es:9200' });
      mockEsSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } });

      const app = createApp();
      await request(app).get('/api/integrations/crowdstrike/auto-resolve/receipts?limit=999');

      expect(mockEsSearch.mock.calls[0][0].size).toBe(100);
    });

    it('survives ES search failure and returns empty list', async () => {
      mockGetAnalyticsSettings.mockReturnValue({ configured: true, connectionType: 'node', node: 'http://es:9200' });
      mockEsSearch.mockRejectedValueOnce(new Error('cluster transient'));

      const app = createApp();
      const res = await request(app).get('/api/integrations/crowdstrike/auto-resolve/receipts');

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });
  });
});
