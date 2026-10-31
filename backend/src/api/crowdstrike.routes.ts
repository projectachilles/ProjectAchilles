// CrowdStrike analytics routes — ZTA score, alerts, and cross-correlation.
// All gated behind Clerk auth + analytics:dashboards:read permission.

import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { CrowdStrikeAnalyticsService } from '../services/crowdstrike/analytics.service.js';
import {
  parseAlertSource,
  parseSeverityList,
  parseWindowQuery,
} from '../services/analytics/integration-window.js';
import { defaultCoverageWindow } from '../services/analytics/technique-coverage.js';
import { parseAlertsForTestsBody } from '../services/alerts/alertsForTest.js';

const router = Router();

router.use(requireClerkAuth());

const settingsService = new IntegrationsSettingsService();
const analyticsService = new CrowdStrikeAnalyticsService();

/** Guard: return 400 if CrowdStrike is not configured. */
function requireCrowdStrikeConfigured() {
  return (_req: unknown, _res: unknown, next: (err?: unknown) => void) => {
    if (!settingsService.isCrowdStrikeConfigured()) {
      next(new AppError('CrowdStrike integration is not configured', 400));
      return;
    }
    next();
  };
}

router.use(requireCrowdStrikeConfigured());

// ---------------------------------------------------------------------------
// ZTA Score (Secure-Score equivalent)
// ---------------------------------------------------------------------------

/** GET /api/analytics/crowdstrike/zta-score — Latest org ZTA snapshot */
router.get('/zta-score', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getZtaScoreSummary();
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/zta-score/trend — Score history */
router.get('/zta-score/trend', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  const data = await analyticsService.getZtaScoreTrend(days);
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** GET /api/analytics/crowdstrike/alerts/summary — Alert counts by severity/status */
router.get('/alerts/summary', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const data = await analyticsService.getAlertSummary(parseWindowQuery(req.query));
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/alerts — Paginated, filterable alerts list */
router.get('/alerts', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const data = await analyticsService.getAlerts({
    page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
    pageSize: req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
    techniques: req.query.techniques
      ? String(req.query.techniques).split(',').map((t) => t.trim()).filter(Boolean)
      : undefined,
    sortField: req.query.sortField ? String(req.query.sortField) : undefined,
    sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
    source: parseAlertSource(req.query.source),
    severities: parseSeverityList(req.query.severity),
    window: parseWindowQuery(req.query),
  });
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/alerts/trend — Alert creation trend */
router.get('/alerts/trend', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const data = await analyticsService.getAlertTrend(days, parseWindowQuery(req.query));
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Cross-correlation
// ---------------------------------------------------------------------------

/** GET /api/analytics/crowdstrike/correlation/scores — Defense Score vs ZTA score over time */
router.get('/correlation/scores', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  const data = await analyticsService.getScoreComparison(days);
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/correlation/techniques — MITRE technique overlap */
router.get('/correlation/techniques', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getTechniqueOverlap();
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/correlation/technique-coverage — Evidence-based per-technique coverage (defaults to the last 30 days) */
router.get('/correlation/technique-coverage', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const window = parseWindowQuery(req.query) ?? defaultCoverageWindow();
  const data = await analyticsService.getTechniqueCoverage(window);
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/correlation/detection-rate — Per-technique detection rates */
router.get('/correlation/detection-rate', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const windowMinutes = parseInt(String(req.query.windowMinutes ?? '60'), 10);
  const data = await analyticsService.getDetectionRate(days, windowMinutes);
  res.json(data);
}));

/** GET /api/analytics/crowdstrike/correlation/alerts-for-test — Alerts correlated to a specific test execution */
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

/**
 * POST /api/analytics/crowdstrike/correlation/alerts-for-tests — the same lookup
 * for many executions at once (the stages of an Executions row), one msearch
 * per tier. Body: { items: [{ techniques, timestamp, windowMinutes?, hostname?,
 * binaryName?, bundleName? }] } (max 100). Returns { results } in input order,
 * null where a stage's search failed. Read-only, hence the read permission.
 */
router.post('/correlation/alerts-for-tests', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const items = parseAlertsForTestsBody(req.body);
  res.json({ results: await analyticsService.getAlertsForTests(items) });
}));

export default router;
