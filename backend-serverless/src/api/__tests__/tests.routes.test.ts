import { describe, it, expect, vi } from 'vitest';
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
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock TestsSettingsService
const mockGetPlatform = vi.fn().mockReturnValue({ os: 'linux', arch: 'amd64' });
const mockSavePlatform = vi.fn();
const mockGetCertInfo = vi.fn().mockReturnValue(null);
const mockListCerts = vi.fn().mockReturnValue({ certificates: [], activeCertId: null });

vi.mock('../../services/tests/settings.js', () => ({
  TestsSettingsService: class MockSettingsService {
    getPlatformSettings = mockGetPlatform;
    savePlatformSettings = mockSavePlatform;
    getCertificateInfo = mockGetCertInfo;
    deleteCertificate = vi.fn();
    listCertificates = mockListCerts;
    uploadCertificate = vi.fn();
    setActiveCertificateId = vi.fn();
    updateCertificateLabel = vi.fn();
    getActiveCertificateId = vi.fn().mockResolvedValue(null);
    getCertDownloadUrl = vi.fn().mockResolvedValue(null);
  },
}));

const { createTestsRouter } = await import('../tests.routes.js');
const { errorHandler } = await import('../../middleware/error.middleware.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tests', createTestsRouter({ testsSourcePath: '/tmp/tests' }));
  app.use(errorHandler);
  return app;
}

describe('tests routes', () => {
  describe('GET /api/tests/platform', () => {
    it('returns platform settings', async () => {
      const app = createApp();
      const res = await request(app).get('/api/tests/platform');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ os: 'linux', arch: 'amd64' });
    });
  });

  describe('POST /api/tests/platform', () => {
    it('saves valid platform settings', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/platform')
        .send({ os: 'windows', arch: 'amd64' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockSavePlatform).toHaveBeenCalledWith({ os: 'windows', arch: 'amd64' });
    });

    it('rejects invalid OS', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/platform')
        .send({ os: 'freebsd', arch: 'amd64' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid OS');
    });

    it('rejects invalid architecture', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/platform')
        .send({ os: 'linux', arch: 'mips' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid architecture');
    });
  });

  describe('POST /api/tests/certificate', () => {
    it('returns 503 — cert generation not available on serverless', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ commonName: 'Test', organization: 'Org', country: 'US' });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not available on serverless');
    });
  });

  describe('build UUID validation', () => {
    it('rejects invalid UUID format', async () => {
      const app = createApp();

      const res = await request(app).get('/api/tests/builds/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid UUID');
    });

    it('returns 503 for valid UUID — builds not available on serverless', async () => {
      const app = createApp();
      const res = await request(app)
        .get('/api/tests/builds/12345678-1234-1234-1234-123456789abc');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not available on serverless');
    });
  });

  describe('certificate ID validation', () => {
    it('rejects invalid cert ID format', async () => {
      const app = createApp();

      const res = await request(app)
        .put('/api/tests/certificates/invalid/active');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid certificate ID');
    });
  });
});
