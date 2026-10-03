import { Router } from 'express';
import { requireClerkAuth, requirePermission, getUserOrgId, validateRequestOrgId } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { SettingsService } from '../services/analytics/settings.js';
import { SbReportService, parseSbReportWindow } from '../services/reports/sbReport.service.js';

const router = Router();

// Protect all report routes with Clerk authentication
router.use(requireClerkAuth());

const settingsService = new SettingsService();

// GET /api/reports/sb-pc-2026-001 - SB-PC-2026-001 compliance report (LockBit 3.0 bundle)
// Query params: from, to (ISO dates, required), org (UUID), org_code (SB entity
// code for meta.organization), bundle_uuid (f0rtika.bundle_id filter), vendor.
router.get('/sb-pc-2026-001', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  if (!settings.configured) {
    throw new AppError('Elasticsearch not configured', 400);
  }

  const { from, to } = parseSbReportWindow(req.query.from, req.query.to);

  // Org scoping: explicit ?org= wins, otherwise fall back to the JWT org claim.
  const org = (req.query.org as string | undefined) || getUserOrgId(req.auth);
  if (org) validateRequestOrgId(org, req.auth);

  const service = new SbReportService(settings);
  const report = await service.generateSbReport({
    from,
    to,
    org,
    orgCode: req.query.org_code as string | undefined,
    vendor: req.query.vendor as string | undefined,
    bundleUuid: req.query.bundle_uuid as string | undefined,
  });

  res.json(report);
}));

export default router;
