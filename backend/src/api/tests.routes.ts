import { Router } from 'express';
import multer from 'multer';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { TestsSettingsService } from '../services/tests/settings.js';
import { BuildService, BuildError } from '../services/tests/buildService.js';
import type { PlatformSettings } from '../types/tests.js';

const VALID_OS = ['windows', 'linux', 'darwin'] as const;
const VALID_ARCH = ['amd64', '386', 'arm64'] as const;
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createTestsRouter(options: { testsSourcePath: string }): Router {
  const router = Router();
  router.use(requireClerkAuth());

  const testsSettings = new TestsSettingsService();
  const buildService = new BuildService(testsSettings, options.testsSourcePath);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
  const certUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const CERT_ID_REGEX = /^cert-\d+$/;

  // ── Platform Settings ──────────────────────────────────────

  // GET /api/tests/platform
  router.get('/platform', requirePermission('settings:platform:read'), (_req, res) => {
    const platform = testsSettings.getPlatformSettings();
    res.json({ success: true, data: platform });
  });

  // POST /api/tests/platform
  router.post('/platform', requirePermission('settings:platform:write'), asyncHandler(async (req, res) => {
    const { os, arch } = req.body;

    if (!os || !VALID_OS.includes(os)) {
      throw new AppError(`Invalid OS. Must be one of: ${VALID_OS.join(', ')}`, 400);
    }
    if (!arch || !VALID_ARCH.includes(arch)) {
      throw new AppError(`Invalid architecture. Must be one of: ${VALID_ARCH.join(', ')}`, 400);
    }

    try {
      testsSettings.savePlatformSettings({ os, arch } as PlatformSettings);
      res.json({ success: true });
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to save platform settings', 400);
    }
  }));

  // ── Certificate Management ─────────────────────────────────

  // GET /api/tests/certificate
  router.get('/certificate', requirePermission('settings:certificates:read'), (_req, res) => {
    const info = testsSettings.getCertificateInfo();
    res.json({ success: true, data: info });
  });

  // POST /api/tests/certificate
  router.post('/certificate', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    const { commonName, organization, country } = req.body;

    if (!commonName || !organization || !country) {
      throw new AppError('commonName, organization, and country are required', 400);
    }

    if (country.length !== 2) {
      throw new AppError('Country must be a 2-letter ISO code', 400);
    }

    const info = await testsSettings.generateCertificate({ commonName, organization, country });
    res.json({ success: true, data: info });
  }));

  // DELETE /api/tests/certificate
  router.delete('/certificate', requirePermission('settings:certificates:delete'), (_req, res) => {
    testsSettings.deleteCertificate();
    res.json({ success: true });
  });

  // ── Multi-Certificate Routes ────────────────────────────────

  function validateCertId(id: string): void {
    if (!CERT_ID_REGEX.test(id)) {
      throw new AppError('Invalid certificate ID format', 400);
    }
  }

  // GET /api/tests/certificates — List all certs + active ID
  router.get('/certificates', requirePermission('settings:certificates:read'), (_req, res) => {
    const data = testsSettings.listCertificates();
    res.json({ success: true, data });
  });

  // POST /api/tests/certificates/upload — Upload a PFX certificate
  router.post('/certificates/upload', requirePermission('settings:certificates:create'), certUpload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const originalName = req.file.originalname.toLowerCase();
    if (!originalName.endsWith('.pfx') && !originalName.endsWith('.p12')) {
      throw new AppError('File must be a .pfx or .p12 certificate', 400);
    }

    // L8: PKCS#12 files are ASN.1 SEQUENCE — first byte must be 0x30
    if (req.file.buffer.length < 4 || req.file.buffer[0] !== 0x30) {
      throw new AppError('File does not appear to be a valid PKCS#12/PFX certificate', 400);
    }

    const password = req.body.password as string;
    if (!password) {
      throw new AppError('Password is required', 400);
    }

    const label = req.body.label as string | undefined;

    try {
      const info = await testsSettings.uploadCertificate(req.file.buffer, password, label || undefined);
      res.json({ success: true, data: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to upload certificate';
      throw new AppError(msg, 400);
    }
  }));

  // POST /api/tests/certificates/generate — Generate a self-signed cert
  router.post('/certificates/generate', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    const { commonName, organization, country, label, password } = req.body;

    if (!commonName || !organization || !country) {
      throw new AppError('commonName, organization, and country are required', 400);
    }

    if (country.length !== 2) {
      throw new AppError('Country must be a 2-letter ISO code', 400);
    }

    try {
      const info = await testsSettings.generateCertificate(
        { commonName, organization, country },
        label || undefined,
        password || undefined,
      );
      res.json({ success: true, data: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate certificate';
      throw new AppError(msg, 400);
    }
  }));

  // PUT /api/tests/certificates/:id/active — Set active cert
  router.put('/certificates/:id/active', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    validateCertId(req.params.id);
    try {
      testsSettings.setActiveCertificateId(req.params.id);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to set active certificate';
      throw new AppError(msg, 400);
    }
  }));

  // PATCH /api/tests/certificates/:id — Update label
  router.patch('/certificates/:id', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    validateCertId(req.params.id);
    const { label } = req.body;
    if (typeof label !== 'string') {
      throw new AppError('label must be a string', 400);
    }
    try {
      const info = testsSettings.updateCertificateLabel(req.params.id, label);
      res.json({ success: true, data: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update certificate';
      throw new AppError(msg, 400);
    }
  }));

  // DELETE /api/tests/certificates/:id — Delete cert by ID
  router.delete('/certificates/:id', requirePermission('settings:certificates:delete'), asyncHandler(async (req, res) => {
    validateCertId(req.params.id);
    try {
      testsSettings.deleteCertificate(req.params.id);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete certificate';
      throw new AppError(msg, 400);
    }
  }));

  // GET /api/tests/certificates/:id/download — Download cert PFX
  router.get('/certificates/:id/download', requirePermission('settings:certificates:read'), asyncHandler(async (req, res) => {
    validateCertId(req.params.id);
    const result = testsSettings.getCertDownloadPath(req.params.id);
    if (!result) {
      throw new AppError('Certificate not found', 404);
    }
    res.download(result.pfxPath, result.filename);
  }));

  // ── Build Routes ───────────────────────────────────────────

  function validateUuid(uuid: string): void {
    if (!UUID_REGEX.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }
  }

  // GET /api/tests/builds/:uuid - Get build info
  router.get('/builds/:uuid', requirePermission('tests:builds:read'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    const info = buildService.getBuildInfo(req.params.uuid);
    res.json({ success: true, data: info });
  }));

  // POST /api/tests/builds/:uuid - Build & sign
  router.post('/builds/:uuid', requirePermission('tests:builds:create'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    try {
      const info = await buildService.buildAndSign(req.params.uuid);
      res.json({ success: true, data: info });
    } catch (err) {
      if (err instanceof BuildError) {
        throw new AppError(err.message, 422);
      }
      throw err;
    }
  }));

  // DELETE /api/tests/builds/:uuid - Delete build
  router.delete('/builds/:uuid', requirePermission('tests:builds:delete'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    buildService.deleteBuild(req.params.uuid);
    res.json({ success: true });
  }));

  // GET /api/tests/builds/:uuid/download - Download binary
  router.get('/builds/:uuid/download', requirePermission('tests:builds:create'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    const binaryPath = buildService.getBinaryPath(req.params.uuid);
    if (!binaryPath) {
      throw new AppError('Build not found', 404);
    }
    res.download(binaryPath);
  }));

  // GET /api/tests/builds/:uuid/dependencies - Get embed dependencies
  router.get('/builds/:uuid/dependencies', requirePermission('tests:builds:create'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    const deps = buildService.getEmbedDependencies(req.params.uuid);
    res.json({ success: true, data: deps });
  }));

  // POST /api/tests/builds/:uuid/upload - Upload embed dependency file
  router.post('/builds/:uuid/upload', requirePermission('tests:builds:create'), upload.single('file'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);

    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const filename = req.body.filename as string;
    if (!filename) {
      throw new AppError('filename field is required', 400);
    }

    try {
      buildService.saveUploadedFile(req.params.uuid, filename, req.file.buffer);
      res.json({ success: true });
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to save file', 400);
    }
  }));

  // POST /api/tests/builds/:uuid/upload-binary - Upload pre-built test binary
  router.post('/builds/:uuid/upload-binary', requirePermission('tests:builds:create'), upload.single('file'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);

    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    try {
      const info = buildService.uploadBinary(req.params.uuid, req.file.buffer);
      res.json({ success: true, data: info });
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to upload binary', 400);
    }
  }));

  return router;
}
