import { Router } from 'express';
import multer from 'multer';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { TestsSettingsService } from '../services/tests/settings.js';
import type { PlatformSettings, BuildMetadata } from '../types/tests.js';
import { blobReadText, blobWrite, blobExists, blobDelete, blobUrl, blobList } from '../services/storage.js';

const VALID_OS = ['windows', 'linux', 'darwin'] as const;
const VALID_ARCH = ['amd64', '386', 'arm64'] as const;
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createTestsRouter(options: { testsSourcePath: string }): Router {
  const router = Router();
  router.use(requireClerkAuth());

  const testsSettings = new TestsSettingsService();
  const certUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const CERT_ID_REGEX = /^cert-\d+$/;

  void options; // testsSourcePath not used in serverless build routes (Blob storage uses own key paths)

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

  // POST /api/tests/certificate — generate a self-signed certificate
  router.post('/certificate', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    const { commonName, organization, country, label, password } = req.body;
    if (typeof commonName !== 'string' || !commonName.trim()) {
      throw new AppError('commonName is required', 400);
    }
    if (typeof organization !== 'string' || !organization.trim()) {
      throw new AppError('organization is required', 400);
    }
    if (typeof country !== 'string' || !country.trim()) {
      throw new AppError('country is required', 400);
    }

    try {
      const info = await testsSettings.generateCertificate(
        { commonName: commonName.trim(), organization: organization.trim(), country: country.trim() },
        typeof label === 'string' ? label : undefined,
        typeof password === 'string' ? password : undefined,
      );
      res.json({ success: true, data: info });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate certificate';
      throw new AppError(msg, 400);
    }
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

  // POST /api/tests/certificates/generate — generate a self-signed certificate
  router.post('/certificates/generate', requirePermission('settings:certificates:create'), asyncHandler(async (req, res) => {
    const { commonName, organization, country, label, password } = req.body;
    if (typeof commonName !== 'string' || !commonName.trim()) {
      throw new AppError('commonName is required', 400);
    }
    if (typeof organization !== 'string' || !organization.trim()) {
      throw new AppError('organization is required', 400);
    }
    if (typeof country !== 'string' || !country.trim()) {
      throw new AppError('country is required', 400);
    }

    try {
      const info = await testsSettings.generateCertificate(
        { commonName: commonName.trim(), organization: organization.trim(), country: country.trim() },
        typeof label === 'string' ? label : undefined,
        typeof password === 'string' ? password : undefined,
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

  // ── Build Routes ─────────────────────────────────────────

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  function validateUuid(uuid: string): void {
    if (!UUID_REGEX.test(uuid)) {
      throw new AppError('Invalid UUID format', 400);
    }
  }

  // GET /api/tests/builds/:uuid - Get build info (from Blob)
  router.get('/builds/:uuid', requirePermission('tests:builds:read'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    const metaJson = await blobReadText(`builds/${req.params.uuid}/build-meta.json`);
    if (!metaJson) {
      res.json({ success: true, data: { exists: false } });
      return;
    }
    try {
      const meta: BuildMetadata = JSON.parse(metaJson);
      const binaryExists = await blobExists(`builds/${req.params.uuid}/${meta.filename}`);
      if (!binaryExists) {
        res.json({ success: true, data: { exists: false } });
        return;
      }
      res.json({
        success: true,
        data: {
          exists: true,
          platform: meta.platform,
          signed: meta.signed,
          fileSize: meta.fileSize,
          builtAt: meta.builtAt,
          filename: meta.filename,
          source: meta.source,
        },
      });
    } catch {
      res.json({ success: true, data: { exists: false } });
    }
  }));

  // POST /api/tests/builds/:uuid - Build & sign (not available on serverless)
  router.post('/builds/:uuid', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Go compilation not available on serverless — use Upload Binary instead', 503);
  }));

  // DELETE /api/tests/builds/:uuid - Delete build (from Blob)
  router.delete('/builds/:uuid', requirePermission('tests:builds:delete'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    // Delete all blobs under builds/<uuid>/
    const blobs = await blobList(`builds/${req.params.uuid}/`);
    for (const blob of blobs) {
      await blobDelete(blob.key);
    }
    res.json({ success: true });
  }));

  // GET /api/tests/builds/:uuid/download - Download binary (redirect to Blob URL)
  router.get('/builds/:uuid/download', requirePermission('tests:builds:create'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);
    const metaJson = await blobReadText(`builds/${req.params.uuid}/build-meta.json`);
    if (!metaJson) {
      throw new AppError('Build not found', 404);
    }
    const meta: BuildMetadata = JSON.parse(metaJson);
    const url = await blobUrl(`builds/${req.params.uuid}/${meta.filename}`);
    if (!url) {
      throw new AppError('Binary not found', 404);
    }
    res.redirect(302, url);
  }));

  // GET /api/tests/builds/:uuid/dependencies - Not available on serverless (no Go source analysis)
  router.get('/builds/:uuid/dependencies', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Embed dependency analysis not available on serverless', 503);
  }));

  // POST /api/tests/builds/:uuid/upload - Embed dependency upload (not available on serverless)
  router.post('/builds/:uuid/upload', requirePermission('tests:builds:create'), asyncHandler(async (req, _res) => {
    validateUuid(req.params.uuid);
    throw new AppError('Embed dependency upload not available on serverless', 503);
  }));

  // POST /api/tests/builds/:uuid/upload-binary - Upload pre-built test binary (to Blob)
  router.post('/builds/:uuid/upload-binary', requirePermission('tests:builds:create'), upload.single('file'), asyncHandler(async (req, res) => {
    validateUuid(req.params.uuid);

    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const buffer = req.file.buffer;
    if (buffer.length === 0) {
      throw new AppError('Empty file', 400);
    }

    // Windows PE header check: first two bytes must be "MZ" (0x4D 0x5A)
    if (buffer.length < 2 || buffer[0] !== 0x4D || buffer[1] !== 0x5A) {
      throw new AppError('File does not appear to be a valid Windows executable (missing MZ header)', 400);
    }

    const platform = await testsSettings.getPlatformSettings();
    const filename = platform.os === 'windows'
      ? `${req.params.uuid}.exe`
      : req.params.uuid;

    // Write binary and metadata to Blob
    await blobWrite(`builds/${req.params.uuid}/${filename}`, buffer);

    const meta: BuildMetadata = {
      platform: { os: platform.os, arch: platform.arch },
      builtAt: new Date().toISOString(),
      signed: false,
      fileSize: buffer.length,
      filename,
      source: 'uploaded',
    };
    await blobWrite(`builds/${req.params.uuid}/build-meta.json`, JSON.stringify(meta, null, 2));

    res.json({
      success: true,
      data: {
        exists: true,
        platform: meta.platform,
        signed: meta.signed,
        fileSize: meta.fileSize,
        builtAt: meta.builtAt,
        filename: meta.filename,
        source: 'uploaded',
      },
    });
  }));

  return router;
}
