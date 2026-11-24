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
    generateCertificate = vi.fn().mockResolvedValue({ commonName: 'test' });
    deleteCertificate = vi.fn();
    listCertificates = mockListCerts;
    uploadCertificate = vi.fn();
    setActiveCertificateId = vi.fn();
    updateCertificateLabel = vi.fn();
  },
}));

// Mock BuildService
class MockBuildError extends Error {}
class MockBuildSupersededError extends MockBuildError {
  constructor() { super('Build was superseded by another build of this test'); }
}
const mockUploadBinary = vi.fn();
const mockListBuiltUuids = vi.fn();
const mockStartBuild = vi.fn();
const mockGetBuildJob = vi.fn().mockReturnValue(undefined);
const mockIsBuilding = vi.fn().mockReturnValue(false);
// What another worker's build marker says; isBuildingAnywhere = in-memory job OR marker.
const mockMarkerSaysBuilding = vi.fn().mockReturnValue(false);
const mockGetBuildInfo = vi.fn();
const mockDeleteBuild = vi.fn();
const mockSaveUploadedFile = vi.fn();

vi.mock('../../services/tests/buildService.js', () => ({
  BuildService: class MockBuildService {
    getBuildInfo = mockGetBuildInfo;
    getDetectedPlatform = vi.fn().mockReturnValue(null);
    buildAndSign = vi.fn();
    startBuild = mockStartBuild;
    getBuildJob = mockGetBuildJob;
    isBuilding = mockIsBuilding;
    isBuildingAnywhere = (uuid: string) => mockIsBuilding(uuid) || mockMarkerSaysBuilding(uuid);
    deleteBuild = mockDeleteBuild;
    getBinaryPath = vi.fn();
    getEmbedDependencies = vi.fn();
    saveUploadedFile = mockSaveUploadedFile;
    uploadBinary = mockUploadBinary;
    listBuiltUuids = mockListBuiltUuids;
  },
  BuildError: MockBuildError,
  BuildSupersededError: MockBuildSupersededError,
}));

const { createTestsRouter } = await import('../tests.routes.js');
const { errorHandler, AppError } = await import('../../middleware/error.middleware.js');
const { BuildError, BuildSupersededError } = await import('../../services/tests/buildService.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tests', createTestsRouter({ testSourcePaths: ['/tmp/tests'], testsSourcePath: '/tmp/tests' }));
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
    it('rejects missing fields', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ commonName: 'Test' });

      expect(res.status).toBe(400);
    });

    it('rejects invalid country code', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/tests/certificate')
        .send({ commonName: 'Test', organization: 'Org', country: 'USA' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('2-letter');
    });
  });

  describe('build UUID validation', () => {
    it('rejects invalid UUID format', async () => {
      const app = createApp();

      const res = await request(app).get('/api/tests/builds/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid UUID');
    });

    it('accepts valid UUID', async () => {
      const app = createApp();
      // This will hit the mock buildService which returns undefined,
      // but won't error on UUID validation
      const res = await request(app)
        .get('/api/tests/builds/12345678-1234-1234-1234-123456789abc');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/tests/builds', () => {
    beforeEach(() => {
      mockListBuiltUuids.mockReset();
    });

    it('returns the list of built test UUIDs', async () => {
      mockListBuiltUuids.mockReturnValue([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ]);
      const app = createApp();
      const res = await request(app).get('/api/tests/builds');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: [
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ],
      });
    });

    it('returns an empty array when no test has a binary', async () => {
      mockListBuiltUuids.mockReturnValue([]);
      const app = createApp();
      const res = await request(app).get('/api/tests/builds');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
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

  describe('POST /api/tests/builds/:uuid/upload-binary', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

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

    it('calls uploadBinary on success', async () => {
      mockUploadBinary.mockReturnValue({
        exists: true,
        platform: { os: 'windows', arch: 'amd64' },
        signed: false,
        fileSize: 3,
        builtAt: '2026-01-01T00:00:00.000Z',
        filename: `${VALID_UUID}.exe`,
        source: 'uploaded',
      });

      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
        .attach('file', Buffer.from([0x4D, 0x5A, 0x00]), 'test.exe');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.source).toBe('uploaded');
      expect(mockUploadBinary).toHaveBeenCalled();
    });

    it('returns 400 when uploadBinary throws', async () => {
      mockUploadBinary.mockImplementation(() => {
        throw new Error('missing MZ header');
      });

      const app = createApp();
      const res = await request(app)
        .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
        .attach('file', Buffer.from('not-pe'), 'test.exe');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('missing MZ header');
    });
  });

  describe('build jobs', () => {
    const VALID_UUID = '12345678-1234-1234-1234-123456789abc';
    const RUNNING = { status: 'running', startedAt: '2026-10-14T00:00:00.000Z' };
    const BUILT = {
      exists: true,
      platform: { os: 'windows', arch: 'amd64' },
      signed: true,
      fileSize: 2048,
      builtAt: '2026-10-14T00:05:00.000Z',
      filename: `${VALID_UUID}.exe`,
      source: 'built',
    };

    beforeEach(() => {
      mockStartBuild.mockReset();
      mockGetBuildJob.mockReset().mockReturnValue(undefined);
      mockIsBuilding.mockReset().mockReturnValue(false);
      mockMarkerSaysBuilding.mockReset().mockReturnValue(false);
      mockGetBuildInfo.mockReset().mockReturnValue({ exists: false });
      mockDeleteBuild.mockReset();
      mockSaveUploadedFile.mockReset();
      mockUploadBinary.mockReset();
    });

    describe('POST /api/tests/builds/:uuid', () => {
      it('waits for the build and returns BuildInfo by default (unchanged contract)', async () => {
        mockStartBuild.mockImplementation(() => ({ job: RUNNING, promise: Promise.resolve(BUILT) }));

        const res = await request(createApp()).post(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: BUILT });
        expect(mockStartBuild).toHaveBeenCalledWith(VALID_UUID);
      });

      it('returns 422 with the build error message when a synchronous build fails', async () => {
        mockStartBuild.mockImplementation(() => ({
          job: RUNNING,
          promise: Promise.reject(new BuildError('go build: undefined: foo')),
        }));

        const res = await request(createApp()).post(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(422);
        expect(res.body.error).toBe('go build: undefined: foo');
      });

      it('returns 409 with the message when the build was superseded by another build of the test', async () => {
        mockStartBuild.mockImplementation(() => ({
          job: RUNNING,
          promise: Promise.reject(new BuildSupersededError()),
        }));

        const res = await request(createApp()).post(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ success: false, error: 'Build was superseded by another build of this test' });
      });

      it('returns 202 with the job immediately when async=true', async () => {
        // A promise that never settles proves the route does not wait for it.
        mockStartBuild.mockImplementation(() => ({ job: RUNNING, promise: new Promise(() => {}) }));

        const res = await request(createApp()).post(`/api/tests/builds/${VALID_UUID}?async=true`);

        expect(res.status).toBe(202);
        expect(res.body).toEqual({ success: true, data: { job: RUNNING } });
      });

      it('treats any other async value as synchronous', async () => {
        mockStartBuild.mockImplementation(() => ({ job: RUNNING, promise: Promise.resolve(BUILT) }));

        const res = await request(createApp()).post(`/api/tests/builds/${VALID_UUID}?async=1`);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(BUILT);
      });

      it('rejects an invalid UUID without starting a build', async () => {
        const res = await request(createApp()).post('/api/tests/builds/not-a-uuid?async=true');

        expect(res.status).toBe(400);
        expect(mockStartBuild).not.toHaveBeenCalled();
      });
    });

    describe('GET /api/tests/builds/:uuid', () => {
      it('includes the latest job when one exists', async () => {
        mockGetBuildJob.mockReturnValue(RUNNING);

        const res = await request(createApp()).get(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(200);
        expect(res.body.data.job).toEqual(RUNNING);
        expect(res.body.data.exists).toBe(false);
      });

      it('omits job when there is none', async () => {
        const res = await request(createApp()).get(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(200);
        expect(res.body.data).not.toHaveProperty('job');
      });
    });

    describe('conflicts while building', () => {
      beforeEach(() => {
        mockIsBuilding.mockReturnValue(true);
      });

      it('DELETE returns 409 and keeps the build', async () => {
        const res = await request(createApp()).delete(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('Build in progress for this test');
        expect(mockDeleteBuild).not.toHaveBeenCalled();
      });

      it('embed upload returns 409', async () => {
        const res = await request(createApp())
          .post(`/api/tests/builds/${VALID_UUID}/upload`)
          .field('filename', 'payload.exe')
          .attach('file', Buffer.from([0x4D, 0x5A]), 'payload.exe');

        expect(res.status).toBe(409);
        expect(mockSaveUploadedFile).not.toHaveBeenCalled();
      });

      it('binary upload returns 409', async () => {
        const res = await request(createApp())
          .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
          .attach('file', Buffer.from([0x4D, 0x5A, 0x00]), 'test.exe');

        expect(res.status).toBe(409);
        expect(mockUploadBinary).not.toHaveBeenCalled();
      });

      describe('when only another worker\'s build marker says a build is running', () => {
        beforeEach(() => {
          mockIsBuilding.mockReturnValue(false);
          mockMarkerSaysBuilding.mockReturnValue(true);
        });

        it('DELETE returns 409 and keeps the build', async () => {
          const res = await request(createApp()).delete(`/api/tests/builds/${VALID_UUID}`);

          expect(res.status).toBe(409);
          expect(res.body.error).toBe('Build in progress for this test');
          expect(mockDeleteBuild).not.toHaveBeenCalled();
        });

        it('embed upload returns 409', async () => {
          const res = await request(createApp())
            .post(`/api/tests/builds/${VALID_UUID}/upload`)
            .field('filename', 'payload.exe')
            .attach('file', Buffer.from([0x4D, 0x5A]), 'payload.exe');

          expect(res.status).toBe(409);
          expect(res.body.error).toBe('Build in progress for this test');
          expect(mockSaveUploadedFile).not.toHaveBeenCalled();
        });

        it('binary upload returns 409', async () => {
          const res = await request(createApp())
            .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
            .attach('file', Buffer.from([0x4D, 0x5A, 0x00]), 'test.exe');

          expect(res.status).toBe(409);
          expect(res.body.error).toBe('Build in progress for this test');
          expect(mockUploadBinary).not.toHaveBeenCalled();
        });
      });

      // The pre-check passed, then a build took the marker before the write
      // (the service's test folder lock refuses with the same 409).
      describe('when the service refuses under the test folder lock', () => {
        const conflict = () => { throw new AppError('Build in progress for this test', 409); };
        beforeEach(() => {
          mockIsBuilding.mockReturnValue(false);
        });

        it('DELETE returns 409 with the running-build message', async () => {
          mockDeleteBuild.mockImplementationOnce(conflict);
          const res = await request(createApp()).delete(`/api/tests/builds/${VALID_UUID}`);

          expect(res.status).toBe(409);
          expect(res.body).toEqual({ success: false, error: 'Build in progress for this test' });
        });

        it('embed upload returns 409 with the running-build message', async () => {
          mockSaveUploadedFile.mockImplementationOnce(conflict);
          const res = await request(createApp())
            .post(`/api/tests/builds/${VALID_UUID}/upload`)
            .field('filename', 'payload.exe')
            .attach('file', Buffer.from([0x4D, 0x5A]), 'payload.exe');

          expect(res.status).toBe(409);
          expect(res.body).toEqual({ success: false, error: 'Build in progress for this test' });
        });

        it('binary upload returns 409 with the running-build message', async () => {
          mockUploadBinary.mockImplementationOnce(conflict);
          const res = await request(createApp())
            .post(`/api/tests/builds/${VALID_UUID}/upload-binary`)
            .attach('file', Buffer.from([0x4D, 0x5A, 0x00]), 'test.exe');

          expect(res.status).toBe(409);
          expect(res.body).toEqual({ success: false, error: 'Build in progress for this test' });
        });

        it('other upload errors stay 400', async () => {
          mockSaveUploadedFile.mockImplementationOnce(() => { throw new Error('Invalid filename'); });
          const res = await request(createApp())
            .post(`/api/tests/builds/${VALID_UUID}/upload`)
            .field('filename', 'payload.exe')
            .attach('file', Buffer.from([0x4D, 0x5A]), 'payload.exe');

          expect(res.status).toBe(400);
          expect(res.body.error).toBe('Invalid filename');
        });
      });

      it('DELETE works again once the build is done', async () => {
        mockIsBuilding.mockReturnValue(false);

        const res = await request(createApp()).delete(`/api/tests/builds/${VALID_UUID}`);

        expect(res.status).toBe(200);
        expect(mockDeleteBuild).toHaveBeenCalledWith(VALID_UUID);
      });
    });
  });
});
