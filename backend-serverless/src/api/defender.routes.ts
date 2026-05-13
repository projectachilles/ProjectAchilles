// Defender analytics routes — Vercel serverless version.
// Secure Score, alerts, controls, and cross-correlation.

import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { DefenderAnalyticsService } from '../services/defender/analytics.service.js';

const router = Router();

router.use(requireClerkAuth());

const settingsService = new IntegrationsSettingsService();
const analyticsService = new DefenderAnalyticsService();

/** Guard: return 400 if Defender is not configured. */
function requireDefenderConfigured() {
  return asyncHandler(async (_req: unknown, _res: unknown, next: (err?: unknown) => void) => {
    const configured = await settingsService.isDefenderConfigured();
    if (!configured) {
      next(new AppError('Defender integration is not configured', 400));
      return;
    }
    next();
  });
}

router.use(requireDefenderConfigured());

// ---------------------------------------------------------------------------
// Secure Score
// ---------------------------------------------------------------------------

router.get('/secure-score', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getCurrentSecureScore();
  res.json(data);
}));

router.get('/secure-score/trend', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  const data = await analyticsService.getSecureScoreTrend(days);
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

router.get('/alerts/summary', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getAlertSummary();
  res.json(data);
}));

router.get('/alerts', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const data = await analyticsService.getAlerts({
    page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
    pageSize: req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined,
    severity: req.query.severity ? String(req.query.severity) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
    technique: req.query.technique ? String(req.query.technique) : undefined,
    sortField: req.query.sortField ? String(req.query.sortField) : undefined,
    sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
  });
  res.json(data);
}));

router.get('/alerts/trend', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const data = await analyticsService.getAlertTrend(days);
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

router.get('/controls', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const data = await analyticsService.getControlProfiles({
    category: req.query.category ? String(req.query.category) : undefined,
    deprecated: req.query.deprecated === 'true' ? true : req.query.deprecated === 'false' ? false : undefined,
  });
  res.json(data);
}));

router.get('/controls/by-category', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getControlsByCategory();
  res.json(data);
}));

router.get('/controls/correlation', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const controlTitle = req.query.controlTitle ? String(req.query.controlTitle) : '';
  const days = req.query.days ? parseInt(String(req.query.days), 10) : 30;
  if (!controlTitle) {
    throw new AppError('controlTitle is required', 400);
  }
  const data = await analyticsService.getControlCorrelation(controlTitle, days);
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Cross-correlation
// ---------------------------------------------------------------------------

router.get('/correlation/scores', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  const data = await analyticsService.getDefenseVsSecureScore(days);
  res.json(data);
}));

router.get('/correlation/techniques', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getTechniqueOverlap();
  res.json(data);
}));

/** GET /api/analytics/defender/correlation/detection-rate — Per-technique detection rates */
router.get('/correlation/detection-rate', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const windowMinutes = parseInt(String(req.query.windowMinutes ?? '60'), 10);
  const data = await analyticsService.getDetectionRate(days, windowMinutes);
  res.json(data);
}));

/** GET /api/analytics/defender/correlation/alerts-for-test — Alerts correlated to a specific test execution */
router.get('/correlation/alerts-for-test', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const techniques = String(req.query.techniques ?? '');
  const timestamp = String(req.query.timestamp ?? '');
  const windowMinutes = parseInt(String(req.query.windowMinutes ?? '30'), 10);
  const hostname = req.query.hostname ? String(req.query.hostname) : undefined;
  const binaryName = req.query.binaryName ? String(req.query.binaryName) : undefined;
  const bundleName = req.query.bundleName ? String(req.query.bundleName) : undefined;

  if (!techniques || !timestamp) {
    throw new AppError('techniques and timestamp are required', 400);
  }

  const data = await analyticsService.getAlertsForTest(
    techniques.split(',').map((t) => t.trim()).filter(Boolean),
    timestamp,
    windowMinutes,
    hostname,
    binaryName,
    bundleName,
  );
  res.json(data);
}));

export default router;
