import { Router } from 'express';
import { requireClerkAuth } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { TestsSettingsService } from '../services/tests/settings.js';
import type { PlatformSettings } from '../types/tests.js';

const router = Router();

// Protect all tests routes with Clerk authentication
router.use(requireClerkAuth());

const testsSettings = new TestsSettingsService();

const VALID_OS = ['windows', 'linux', 'darwin'] as const;
const VALID_ARCH = ['amd64', '386', 'arm64'] as const;

// GET /api/tests/platform - Get platform settings
router.get('/platform', (_req, res) => {
  const platform = testsSettings.getPlatformSettings();
  res.json({ success: true, data: platform });
});

// POST /api/tests/platform - Save platform settings
router.post('/platform', asyncHandler(async (req, res) => {
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

// GET /api/tests/certificate - Get certificate info
router.get('/certificate', (_req, res) => {
  const info = testsSettings.getCertificateInfo();
  res.json({ success: true, data: info });
});

// POST /api/tests/certificate - Generate certificate
router.post('/certificate', asyncHandler(async (req, res) => {
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

// DELETE /api/tests/certificate - Delete certificate
router.delete('/certificate', (_req, res) => {
  testsSettings.deleteCertificate();
  res.json({ success: true });
});

export default router;
