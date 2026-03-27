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
  getUserOrgId: () => undefined,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  validateRequestOrgId: () => {},
}));

// Mock the settings service
const mockGetDefenderSettings = vi.fn();
const mockSaveDefenderSettings = vi.fn();
const mockDeleteDefenderSettings = vi.fn();
const mockIsDefenderConfigured = vi.fn();
const mockGetDefenderCredentials = vi.fn();
const mockIsEnvDefenderConfigured = vi.fn();

vi.mock('../../services/integrations/settings.js', () => ({
  IntegrationsSettingsService: class MockIntegrationsSettingsService {
    getAzureSettings = vi.fn().mockReturnValue(null);
    saveAzureSettings = vi.fn();
    isAzureConfigured = vi.fn().mockReturnValue(false);
    getAzureCredentials = vi.fn().mockReturnValue(null);
    isEnvConfigured = vi.fn().mockReturnValue(false);
    getDefenderSettings = mockGetDefenderSettings;
    saveDefenderSettings = mockSaveDefenderSettings;
    deleteDefenderSettings = mockDeleteDefenderSettings;
    deleteAzureSettings = vi.fn();
    isDefenderConfigured = mockIsDefenderConfigured;
    getDefenderCredentials = mockGetDefenderCredentials;
    isEnvDefenderConfigured = mockIsEnvDefenderConfigured;
  },
}));

// Mock global fetch for the /test endpoint
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

describe('Defender integration routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefenderSettings.mockReturnValue(null);
    mockIsDefenderConfigured.mockReturnValue(false);
    mockGetDefenderCredentials.mockReturnValue(null);
    mockIsEnvDefenderConfigured.mockReturnValue(false);
  });

  // ── GET /api/integrations/defender ───────────────────────────

  describe('GET /api/integrations/defender', () => {
    it('returns not-configured when no settings exist', async () => {
      const app = createApp();
      const res = await request(app).get('/api/integrations/defender');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
    });

    it('returns masked settings when configured', async () => {
      mockGetDefenderSettings.mockReturnValue({
        configured: true,
        tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
        client_id: '11112222-3333-4444-5555-666677778888',
        client_secret: 'super-secret-value-1234',
        label: 'My Defender',
      });

      const app = createApp();
      const res = await request(app).get('/api/integrations/defender');

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.tenant_id).toBe('****ffff');
      expect(res.body.client_id).toBe('****8888');
      expect(res.body.client_secret_set).toBe(true);
      expect(res.body.label).toBe('My Defender');
      // Should not expose raw values
      expect(res.body.client_secret).toBeUndefined();
    });
  });

  // ── POST /api/integrations/defender ──────────────────────────

  describe('POST /api/integrations/defender', () => {
    it('requires all three fields on initial setup', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender')
        .send({ tenant_id: 'tid' });

      expect(res.status).toBe(400);
    });

    it('saves when all fields provided', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender')
        .send({
          tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
          client_id: '11112222-3333-4444-5555-666677778888',
          client_secret: 'my-secret',
          label: 'Test',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockSaveDefenderSettings).toHaveBeenCalledWith({
        tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
        client_id: '11112222-3333-4444-5555-666677778888',
        client_secret: 'my-secret',
        label: 'Test',
      });
    });

    it('allows partial update on edit', async () => {
      mockIsDefenderConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender')
        .send({ label: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });

  // ── POST /api/integrations/defender/test ─────────────────────

  describe('POST /api/integrations/defender/test', () => {
    it('returns error when credentials missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Missing credentials/);
    });

    it('validates tenant_id format', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({
          tenant_id: 'not-a-uuid',
          client_id: '11112222-3333-4444-5555-666677778888',
          client_secret: 'secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/tenant_id/);
    });

    it('validates client_id format', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({
          tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
          client_id: 'not-a-uuid',
          client_secret: 'secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/client_id/);
    });

    it('returns success on valid OAuth2 token acquisition', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({
          tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
          client_id: '11112222-3333-4444-5555-666677778888',
          client_secret: 'valid-secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/Successfully acquired token/);

      // Verify fetch called with correct endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/aaaabbbb-cccc-dddd-eeee-ffffffffffff/oauth2/v2.0/token',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns error on OAuth2 failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_description: 'AADSTS7000215: Invalid client secret' }),
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({
          tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
          client_id: '11112222-3333-4444-5555-666677778888',
          client_secret: 'invalid-secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid client secret/);
    });

    it('falls back to stored credentials', async () => {
      mockGetDefenderCredentials.mockReturnValue({
        tenant_id: 'aabbccdd-1111-2222-3333-444455556666',
        client_id: 'eeff0011-2233-4455-6677-8899aabbccdd',
        client_secret: 'stored-secret',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token' }),
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('handles network error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      const app = createApp();
      const res = await request(app)
        .post('/api/integrations/defender/test')
        .send({
          tenant_id: 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
          client_id: '11112222-3333-4444-5555-666677778888',
          client_secret: 'secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/fetch failed/);
    });
  });

  // ── DELETE /api/integrations/defender ──────────────────────────

  describe('DELETE /api/integrations/defender', () => {
    it('deletes settings successfully', async () => {
      const app = createApp();
      const res = await request(app).delete('/api/integrations/defender');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockDeleteDefenderSettings).toHaveBeenCalled();
    });

    it('returns 400 when env vars configured', async () => {
      mockIsEnvDefenderConfigured.mockReturnValue(true);

      const app = createApp();
      const res = await request(app).delete('/api/integrations/defender');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/environment variables/);
      expect(mockDeleteDefenderSettings).not.toHaveBeenCalled();
    });
  });
});
