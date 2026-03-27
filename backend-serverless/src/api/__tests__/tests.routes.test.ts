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
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock Blob storage
const mockBlobReadText = vi.fn().mockResolvedValue(null);
const mockBlobRead = vi.fn().mockResolvedValue(null);
const mockBlobWrite = vi.fn().mockResolvedValue('https://blob.test/key');
const mockBlobExists = vi.fn().mockResolvedValue(false);
const mockBlobDelete = vi.fn().mockResolvedValue(undefined);
const mockBlobHead = vi.fn().mockResolvedValue(null);
const mockBlobUrl = vi.fn().mockResolvedValue(null);
const mockBlobList = vi.fn().mockResolvedValue([]);

vi.mock('../../services/storage.js', () => ({
  blobReadText: (...args: unknown[]) => mockBlobReadText(...args),
  blobRead: (...args: unknown[]) => mockBlobRead(...args),
  blobWrite: (...args: unknown[]) => mockBlobWrite(...args),
  blobExists: (...args: unknown[]) => mockBlobExists(...args),
  blobDelete: (...args: unknown[]) => mockBlobDelete(...args),
  blobHead: (...args: unknown[]) => mockBlobHead(...args),
  blobUrl: (...args: unknown[]) => mockBlobUrl(...args),
  blobList: (...args: unknown[]) => mockBlobList(...args),
}));

// Mock @vercel/blob/client (server-side token generation)
const mockGenerateClientToken = vi.fn().mockResolvedValue('mock-client-token-abc123');
vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => mockGenerateClientToken(...args),
}));

// Mock TestsSettingsService
const mockGetPlatform = vi.fn().mockResolvedValue({ os: 'linux', arch: 'amd64' });
const mockSavePlatform = vi.fn();
const mockGetCertInfo = vi.fn().mockReturnValue(null);
const mockListCerts = vi.fn().mockReturnValue({ certificates: [], activeCertId: null });
const mockGenerateCert = vi.fn();

vi.mock('../../services/tests/settings.js', () => ({
  TestsSettingsService: class MockSettingsService {
    getPlatformSettings = mockGetPlatform;
    savePlatformSettings = mockSavePlatform;
    getCertificateInfo = mockGetCertInfo;
    deleteCertificate = vi.fn();
    listCertificates = mockListCerts;
    uploadCertificate = vi.fn();
    generateCertificate = mockGenerateCert;
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
      expect(res.body.error).toContain('Validation failed');
    });

    it('rejects invalid architecture', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/platform')
        .send({ os: 'linux', arch: 'mips' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });
  });

  describe('POST /api/tests/certificate', () => {
    it('generates certificate on success', async () => {
      const app = createApp();
      mockGenerateCert.mockResolvedValue({
        id: 'cert-1700000000000', exists: true, source: 'generated',
        label: undefined, subject: { commonName: 'Test', organization: 'Org', country: 'US' },
        fingerprint: 'AA:BB:CC:DD', expiry: '2031-01-01T00:00:00.000Z',
      });

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ commonName: 'Test', organization: 'Org', country: 'US' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.source).toBe('generated');
    });

    it('returns 400 when commonName is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ organization: 'Org', country: 'US' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when organization is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ commonName: 'Test', country: 'US' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('returns 400 when country is missing', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ commonName: 'Test', organization: 'Org' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });
  });

  describe('POST /api/tests/certificates/generate', () => {
    it('generates certificate via multi-cert endpoint', async () => {
      const app = createApp();
      mockGenerateCert.mockResolvedValue({
        id: 'cert-1700000000000', exists: true, source: 'generated',
        subject: { commonName: 'Test', organization: 'Org', country: 'US' },
        fingerprint: 'AA:BB:CC:DD', expiry: '2031-01-01T00:00:00.000Z',
      });

      const res = await request(app)
        .post('/api/tests/certificates/generate')
        .send({ commonName: 'Test', organization: 'Org', country: 'US' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for missing fields', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificates/generate')
        .send({ commonName: 'Test' });

      expect(res.status).toBe(400);
    });
  });

  describe('build UUID validation', () => {
    it('rejects invalid UUID format', async () => {
      const app = createApp();

      const res = await request(app).get('/api/tests/builds/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid UUID');
    });
  });

  describe('GET /api/tests/builds/:uuid', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetPlatform.mockResolvedValue({ os: 'windows', arch: 'amd64' });
    });

    it('returns { exists: false } when no metadata in Blob', async () => {
      mockBlobReadText.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get(`/api/tests/builds/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.data.exists).toBe(false);
    });

    it('returns build info when metadata and binary exist in Blob', async () => {
      const meta = {
        platform: { os: 'windows', arch: 'amd64' },
        builtAt: '2026-01-01T00:00:00.000Z',
        signed: false,
        fileSize: 1024,
        filename: `${VALID_UUID}.exe`,
        source: 'uploaded',
      };
      mockBlobReadText.mockResolvedValue(JSON.stringify(meta));
      mockBlobExists.mockResolvedValue(true);

      const app = createApp();
      const res = await request(app).get(`/api/tests/builds/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.data.exists).toBe(true);
      expect(res.body.data.source).toBe('uploaded');
      expect(res.body.data.platform).toEqual({ os: 'windows', arch: 'amd64' });
    });

    it('returns { exists: false } when metadata exists but binary missing', async () => {
      const meta = { filename: `${VALID_UUID}.exe` };
      mockBlobReadText.mockResolvedValue(JSON.stringify(meta));
      mockBlobExists.mockResolvedValue(false);

      const app = createApp();
      const res = await request(app).get(`/api/tests/builds/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.data.exists).toBe(false);
    });
  });

  describe('POST /api/tests/builds/:uuid (compile)', () => {
    it('returns 503 — Go compilation not available', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/tests/builds/12345678-1234-1234-1234-123456789abc');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not available on serverless');
    });
  });

  describe('DELETE /api/tests/builds/:uuid', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

    it('deletes all blobs under builds/<uuid>/', async () => {
      mockBlobList.mockResolvedValue([
        { key: `builds/${VALID_UUID}/build-meta.json`, url: 'u1', size: 100 },
        { key: `builds/${VALID_UUID}/${VALID_UUID}.exe`, url: 'u2', size: 2048 },
      ]);

      const app = createApp();
      const res = await request(app).delete(`/api/tests/builds/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockBlobDelete).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/tests/builds/:uuid/upload-binary', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetPlatform.mockResolvedValue({ os: 'windows', arch: 'amd64' });
    });

    it('returns 400 for invalid UUID', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/tests/builds/not-a-uuid/upload-binary')
        .attach('file', Buffer.from([0x4D, 0x5A, 0x00]), 'test.exe');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid UUID');
    });

    it('returns 400 when no file is uploaded', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-binary`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No file uploaded');
    });

    it('returns 400 for non-PE file (missing MZ header)', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
        .attach('file', Buffer.from('not a PE file'), 'test.exe');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('missing MZ header');
    });

    it('uploads binary and metadata to Blob on success', async () => {
      const app = createApp();
      const peBuffer = Buffer.concat([Buffer.from([0x4D, 0x5A]), Buffer.alloc(100, 0)]);

      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
        .attach('file', peBuffer, 'test.exe');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.exists).toBe(true);
      expect(res.body.data.source).toBe('uploaded');
      expect(res.body.data.signed).toBe(false);

      // Verify blobWrite was called for binary and metadata
      expect(mockBlobWrite).toHaveBeenCalledTimes(2);
      const writeKeys = mockBlobWrite.mock.calls.map((c: unknown[]) => c[0]);
      expect(writeKeys).toContain(`builds/${VALID_UUID}/${VALID_UUID}.exe`);
      expect(writeKeys).toContain(`builds/${VALID_UUID}/build-meta.json`);
    });
  });

  describe('POST /api/tests/builds/:uuid/upload-token', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns 400 for invalid UUID', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/tests/builds/not-a-uuid/upload-token')
        .send({ filename: 'test.exe' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid UUID');
    });

    it('returns 400 when filename is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-token`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('filename is required');
    });

    it('returns 400 when filename is not a string', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-token`)
        .send({ filename: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('filename is required');
    });

    it('returns token and pathname on success', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-token`)
        .send({ filename: `${VALID_UUID}.exe` });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBe('mock-client-token-abc123');
      expect(res.body.data.pathname).toBe(`builds/${VALID_UUID}/${VALID_UUID}.exe`);
      expect(mockGenerateClientToken).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: `builds/${VALID_UUID}/${VALID_UUID}.exe`,
          addRandomSuffix: false,
        }),
      );
    });
  });

  describe('POST /api/tests/builds/:uuid/upload-complete', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetPlatform.mockResolvedValue({ os: 'windows', arch: 'amd64' });
    });

    it('returns 400 for invalid UUID', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/tests/builds/not-a-uuid/upload-complete')
        .send({ filename: 'test.exe' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid UUID');
    });

    it('returns 400 when filename is missing', async () => {
      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-complete`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('filename is required');
    });

    it('returns 404 when blob does not exist', async () => {
      mockBlobHead.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-complete`)
        .send({ filename: `${VALID_UUID}.exe` });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Binary not found');
    });

    it('returns 400 and deletes blob when MZ header is invalid', async () => {
      mockBlobHead.mockResolvedValue({ size: 1024, url: 'https://blob.test/key' });
      mockBlobRead.mockResolvedValue(Buffer.from('not a PE file'));

      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-complete`)
        .send({ filename: `${VALID_UUID}.exe` });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('missing MZ header');
      expect(mockBlobDelete).toHaveBeenCalledWith(`builds/${VALID_UUID}/${VALID_UUID}.exe`);
    });

    it('returns 200 with BuildInfo on success', async () => {
      const peBuffer = Buffer.concat([Buffer.from([0x4D, 0x5A]), Buffer.alloc(100, 0)]);
      mockBlobHead.mockResolvedValue({ size: peBuffer.length, url: 'https://blob.test/key' });
      mockBlobRead.mockResolvedValue(peBuffer);

      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-complete`)
        .send({ filename: `${VALID_UUID}.exe` });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.exists).toBe(true);
      expect(res.body.data.source).toBe('uploaded');
      expect(res.body.data.signed).toBe(false);
      expect(res.body.data.platform).toEqual({ os: 'windows', arch: 'amd64' });
      expect(res.body.data.fileSize).toBe(peBuffer.length);

      // Verify build-meta.json was written
      expect(mockBlobWrite).toHaveBeenCalledWith(
        `builds/${VALID_UUID}/build-meta.json`,
        expect.stringContaining('"source": "uploaded"'),
      );
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
