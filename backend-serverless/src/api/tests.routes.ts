import { Router } from 'express';
import multer from 'multer';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { TestsSettingsService } from '../services/tests/settings.js';
import type { PlatformSettings } from '../types/tests.js';

const VALID_OS = ['windows', 'linux', 'darwin'] as const;
const VALID_ARCH = ['amd64', '386', 'arm64'] as const;
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createTestsRouter(options: { testsSourcePath: string }): Router {
  const router = Router();
  router.use(requireClerkAuth());

  const testsSettings = new TestsSettingsService();
  const certUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const CERT_ID_REGEX = /^cert-\d+$/;

  // Suppress unused variable warning — testsSourcePath reserved for future use
  void options;

  // ── Platform Settings ──────────────────────────────────────

  // GET /api/tests/platform
  router.get('/platform', requirePermission('settings:platform:read'), asyncHandler(async (_req, res) => {
    const platform = await testsSettings.getPlatformSettings();
    res.json({ success: true, data: platform });
  }));

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
      await testsSettings.savePlatformSettings({ os, arch } as PlatformSettings);
      res.json({ success: true });
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Failed to save platform settings', 400);
    }
  }));

  // ── Certificate Management ─────────────────────────────────

  // GET /api/tests/certificate
  router.get('/certificate', requirePermission('settings:certificates:read'), asyncHandler(async (_req, res) => {
    const info = await testsSettings.getCertificateInfo();
    res.json({ success: true, data: info });
  }));

  // POST /api/tests/certificate — cert generation not available on serverless
  router.post('/certificate', requirePermission('settings:certificates:create'), asyncHandler(async () => {
    throw new AppError('Certificate generation is not available on serverless. Upload a PFX certificate instead.', 503);
  }));

  // DELETE /api/tests/certificate
  router.delete('/certificate', requirePermission('settings:certificates:delete'), asyncHandler(async (_req, res) => {
    const activeCertId = await testsSettings.getActiveCertificateId();
    if (activeCertId) {
      await testsSettings.deleteCertificate(activeCertId);
    }
    res.json({ success: true });
  }));

  // ── Multi-Certificate Routes ────────────────────────────────

  function validateCertId(id: string): void {
    if (!CERT_ID_REGEX.test(id)) {
      throw new AppError('Invalid certificate ID format', 400);
    }
  }

  // GET /api/tests/certificates — List all certs + active ID
  router.get('/certificates', requirePermission('settings:certificates:read'), asyncHandler(async (_req, res) => {
    const data = await testsSettings.listCertificates();
    res.json({ success: true, data });
  }));

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

  // POST /api/tests/certificates/generate — Not available on serverless
  router.post('/certificates/generate', requirePermission('settings:certificates:create'), asyncHandler(async (_req, _res) => {
    throw new AppError('Certificate generation is not available on serverless. Upload a PFX certificate instead.', 503);
  }));

  // PUT /api/tests/certificates/:id/active — Set active cert
  router.put('/certificates/:id/active', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    validateCertId(req.params.id);
    try {
      await testsSettings.setActiveCertificateId(req.params.id);
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
      const info = await testsSettings.updateCertificateLabel(req.params.id, label);
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
      await testsSettings.deleteCertificate(req.params.id);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete certificate';
      throw new AppError(msg, 400);
    }
  }));

  // GET /api/tests/certificates/:id/download — Download cert PFX (redirect to Blob URL)
  router.get('/certificates/:id/download', requirePermission('settings:certificates:read'), asyncHandler(async (req, res) => {
    validateCertId(req.params.id);
    const result = await testsSettings.getCertDownloadUrl(req.params.id);
    if (!result) {
      throw new AppError('Certificate not found', 404);
    }
    res.redirect(302, result.url);
  }));

  // ── Build Routes (stubbed — not available on serverless) ───

  function validateUuid(uuid: string): void {
    if (!UUID_REGEX.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }
  }

  // GET /api/tests/builds/:uuid - Get build info
  router.get('/builds/:uuid', requirePermission('tests:builds:read'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Build system not available on serverless', 503);
  }));

  // POST /api/tests/builds/:uuid - Build & sign
  router.post('/builds/:uuid', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Build system not available on serverless', 503);
  }));

  // DELETE /api/tests/builds/:uuid - Delete build
  router.delete('/builds/:uuid', requirePermission('tests:builds:delete'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Build system not available on serverless', 503);
  }));

  // GET /api/tests/builds/:uuid/download - Download binary
  router.get('/builds/:uuid/download', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Build system not available on serverless', 503);
  }));

  // GET /api/tests/builds/:uuid/dependencies - Get embed dependencies
  router.get('/builds/:uuid/dependencies', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Build system not available on serverless', 503);
  }));

  // POST /api/tests/builds/:uuid/upload - Upload embed dependency file
  router.post('/builds/:uuid/upload', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Build system not available on serverless', 503);
  }));

  return router;
}
