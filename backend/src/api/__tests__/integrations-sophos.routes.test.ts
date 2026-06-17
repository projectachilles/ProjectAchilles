// Tests for the Sophos branch of /api/integrations.
//
// Mirrors the Defender route tests, with two differences:
//   - No tenant_id input field (Sophos discovers tenant via whoami).
//   - The /test route hits TWO Sophos endpoints (token + whoami) before
//     returning success, so the fetch mock needs both responses set up.

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

// Mock settings service — only Sophos methods matter here; others are stubs.
const mockGetSophosSettings = vi.fn();
const mockSaveSophosSettings = vi.fn();
const mockDeleteSophosSettings = vi.fn();
const mockIsSophosConfigured = vi.fn();
const mockGetSophosCredentials = vi.fn();
const mockIsEnvSophosConfigured = vi.fn();

vi.mock('../../services/integrations/settings.js', () => ({
  IntegrationsSettingsService: class MockIntegrationsSettingsService {
    // Sophos
    getSophosSettings = mockGetSophosSettings;
    saveSophosSettings = mockSaveSophosSettings;
    deleteSophosSettings = mockDeleteSophosSettings;
    isSophosConfigured = mockIsSophosConfigured;
    getSophosCredentials = mockGetSophosCredentials;
    isEnvSophosConfigured = mockIsEnvSophosConfigured;
    // Stubs for the rest (the routes file imports the class but other routes
    // are exercised by other test files).
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
  },
}));

const mockGetAnalyticsSettings = vi.fn();
vi.mock('../../services/analytics/settings.js', () => ({
  SettingsService: class { getSettings = mockGetAnalyticsSettings; },
}));

vi.mock('../../services/analytics/client.js', () => ({
  createEsClient: () => ({ count: vi.fn(), search: vi.fn() }),
}));

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

describe('Sophos integration routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSophosSettings.mockReturnValue(null);
    mockIsSophosConfigured.mockReturnValue(false);
    mockGetSophosCredentials.mockReturnValue(null);
    mockIsEnvSophosConfigured.mockReturnValue(false);
    mockGetAnalyticsSettings.mockReturnValue({ configured: false });
  });

  // ── GET ───────────────────────────────────────────────────────────

  describe('GET /api/integrations/sophos', () => {
    it('returns not-configured when no settings exist', async () => {
      const res = await request(createApp()).get('/api/integrations/sophos');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
    });

    it('returns masked settings when configured', async () => {
      mockGetSophosSettings.mockReturnValue({
        configured: true,
        client_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
        client_secret: 'super-secret-value-1234',
        label: 'Acme EU01',
        tenant_id: 'tenant-uuid',
        data_region: 'https://api-eu01.central.sophos.com',
        tier: 'edr',
      });

      const res = await request(createApp()).get('/api/integrations/sophos');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.client_id).toBe('****ffff');
      expect(res.body.client_secret_set).toBe(true);
      // Discovered fields surfaced (UI shows "Connected to EU01, EDR tier")
      expect(res.body.tenant_id).toBe('tenant-uuid');
      expect(res.body.data_region).toBe('https://api-eu01.central.sophos.com');
      expect(res.body.tier).toBe('edr');
      expect(res.body.label).toBe('Acme EU01');
    });
  });

  // ── POST ──────────────────────────────────────────────────────────

  describe('POST /api/integrations/sophos', () => {
    it('saves credentials on initial setup', async () => {
      mockIsSophosConfigured.mockReturnValue(false);

      const res = await request(createApp())
        .post('/api/integrations/sophos')
        .send({ client_id: 'cid', client_secret: 'csec', label: 'My Sophos' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockSaveSophosSettings).toHaveBeenCalledWith({
        client_id: 'cid',
        client_secret: 'csec',
        label: 'My Sophos',
      });
    });

    it('rejects initial setup with missing client_id', async () => {
      mockIsSophosConfigured.mockReturnValue(false);

      const res = await request(createApp())
        .post('/api/integrations/sophos')
        .send({ client_secret: 'csec' });

      expect(res.status).toBe(400);
      expect(mockSaveSophosSettings).not.toHaveBeenCalled();
    });

    it('allows partial update when already configured', async () => {
      mockIsSophosConfigured.mockReturnValue(true);

      const res = await request(createApp())
        .post('/api/integrations/sophos')
        .send({ label: 'Renamed' });

      expect(res.status).toBe(200);
      expect(mockSaveSophosSettings).toHaveBeenCalledWith({ label: 'Renamed' });
    });
  });

  // ── DELETE ────────────────────────────────────────────────────────

  describe('DELETE /api/integrations/sophos', () => {
    it('deletes file-based settings', async () => {
      const res = await request(createApp()).delete('/api/integrations/sophos');
      expect(res.status).toBe(200);
      expect(mockDeleteSophosSettings).toHaveBeenCalled();
    });

    it('refuses to delete when env vars are set', async () => {
      mockIsEnvSophosConfigured.mockReturnValue(true);

      const res = await request(createApp()).delete('/api/integrations/sophos');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/SOPHOS_CLIENT_ID/);
      expect(mockDeleteSophosSettings).not.toHaveBeenCalled();
    });
  });

  // ── POST /test ────────────────────────────────────────────────────
  //
  // This route exercises both Sophos endpoints: token, then whoami.

  describe('POST /api/integrations/sophos/test', () => {
    it('returns missing-credentials when nothing provided and nothing stored', async () => {
      const res = await request(createApp())
        .post('/api/integrations/sophos/test')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Missing/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns success with discovered tenant/region/tier on valid credentials', async () => {
      // Token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-abc', expires_in: 3600 }),
      });
      // Whoami response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'discovered-tenant',
          idType: 'tenant',
          apiHosts: { dataRegion: 'https://api-us02.central.sophos.com' },
        }),
      });

      const res = await request(createApp())
        .post('/api/integrations/sophos/test')
        .send({ client_id: 'cid', client_secret: 'csec' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenant_id).toBe('discovered-tenant');
      expect(res.body.data_region).toBe('https://api-us02.central.sophos.com');
      expect(res.body.tier).toBe('basic');
    });

    it('falls back to stored credentials when body is empty', async () => {
      mockGetSophosCredentials.mockReturnValue({ client_id: 'stored-cid', client_secret: 'stored-csec' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 't1',
          idType: 'tenant',
          apiHosts: { dataRegion: 'https://api-eu01.central.sophos.com' },
        }),
      });

      const res = await request(createApp())
        .post('/api/integrations/sophos/test')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns auth-failure when Sophos rejects the credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"invalid_client","error_description":"Invalid client"}',
      });

      const res = await request(createApp())
        .post('/api/integrations/sophos/test')
        .send({ client_id: 'bad', client_secret: 'bad' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid client/);
    });

    it('returns a clear error when the credential is partner-tier', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'partner-id',
          idType: 'partner',
          apiHosts: { dataRegion: 'https://api-eu01.central.sophos.com' },
        }),
      });

      const res = await request(createApp())
        .post('/api/integrations/sophos/test')
        .send({ client_id: 'cid', client_secret: 'csec' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/tenant/i);
    });
  });
});
