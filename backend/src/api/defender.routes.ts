// Defender analytics routes — Secure Score, alerts, controls, and cross-correlation.
// All gated behind Clerk auth + integrations:read permission.

import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { DefenderAnalyticsService } from '../services/defender/analytics.service.js';
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
const analyticsService = new DefenderAnalyticsService();

/** Guard: return 400 if Defender is not configured. */
function requireDefenderConfigured() {
  return (_req: unknown, _res: unknown, next: (err?: unknown) => void) => {
    if (!settingsService.isDefenderConfigured()) {
      next(new AppError('Defender integration is not configured', 400));
      return;
    }
    next();
  };
}

router.use(requireDefenderConfigured());

// ---------------------------------------------------------------------------
// Secure Score
// ---------------------------------------------------------------------------

/** GET /api/analytics/defender/secure-score — Current score + category breakdown */
router.get('/secure-score', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getCurrentSecureScore();
  res.json(data);
}));

/** GET /api/analytics/defender/secure-score/trend — Score history */
router.get('/secure-score/trend', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  const data = await analyticsService.getSecureScoreTrend(days);
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** GET /api/analytics/defender/alerts/summary — Alert counts by severity/status */
router.get('/alerts/summary', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const data = await analyticsService.getAlertSummary(parseWindowQuery(req.query));
  res.json(data);
}));

/** GET /api/analytics/defender/alerts — Paginated, filterable alerts list */
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

/** GET /api/analytics/defender/alerts/trend — Alert creation trend */
router.get('/alerts/trend', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const data = await analyticsService.getAlertTrend(days, parseWindowQuery(req.query));
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** GET /api/analytics/defender/controls — Filterable control profiles */
router.get('/controls', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const data = await analyticsService.getControlProfiles({
    category: req.query.category ? String(req.query.category) : undefined,
    deprecated: req.query.deprecated === 'true' ? true : req.query.deprecated === 'false' ? false : undefined,
  });
  res.json(data);
}));

/** GET /api/analytics/defender/controls/by-category — Controls grouped by category */
router.get('/controls/by-category', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getControlsByCategory();
  res.json(data);
}));

/** GET /api/analytics/defender/controls/correlation?controlTitle=...&days=30
 *  Returns { coveredTechniques, alertCount } for a Secure Score control by title.
 *  Empty result if no curated mapping pattern matches the title (see
 *  services/defender/control-correlation.service.ts). */
router.get('/controls/correlation', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const controlTitle = req.query.controlTitle ? String(req.query.controlTitle) : '';
  const days = req.query.days ? parseInt(String(req.query.days), 10) : 30;
  if (!controlTitle) {
    throw new AppError('controlTitle is required', 400);
  }
  const data = await analyticsService.getControlCorrelation(controlTitle, days);
  res.json(data);
}));

const MAX_CORRELATION_TITLES = 20;
const MAX_CONTROL_TITLE_LENGTH = 300;

/** GET /controls/correlations?title[]=…&title[]=…&days=30 — getControlCorrelation for several controls in one query. */
router.get('/controls/correlations', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const raw = req.query.title;
  // A single value arrives as a string, repeated ones (title[]=) as an array; anything else is malformed.
  const titles = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : raw === undefined ? [] : null;
  if (titles === null || titles.some((t) => typeof t !== 'string')) throw new AppError('Invalid title', 400);
  if (titles.length === 0) throw new AppError('title is required', 400);
  if (titles.length > MAX_CORRELATION_TITLES) throw new AppError(`At most ${MAX_CORRELATION_TITLES} titles`, 400);
  if ((titles as string[]).some((t) => t.length === 0 || t.length > MAX_CONTROL_TITLE_LENGTH)) {
    throw new AppError('Invalid title', 400);
  }
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError('Invalid days', 400);
  res.json(await analyticsService.getControlCorrelations(titles as string[], days));
}));

// ---------------------------------------------------------------------------
// Cross-correlation
// ---------------------------------------------------------------------------

/** GET /api/analytics/defender/correlation/scores — Defense Score vs Secure Score over time */
router.get('/correlation/scores', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  const data = await analyticsService.getDefenseVsSecureScore(days);
  res.json(data);
}));

/** GET /api/analytics/defender/correlation/techniques — MITRE technique overlap */
router.get('/correlation/techniques', requirePermission('analytics:dashboards:read'), asyncHandler(async (_req, res) => {
  const data = await analyticsService.getTechniqueOverlap();
  res.json(data);
}));

/** GET /api/analytics/defender/correlation/technique-coverage — Evidence-based per-technique coverage (defaults to the last 30 days) */
router.get('/correlation/technique-coverage', requirePermission('analytics:dashboards:read'), asyncHandler(async (req, res) => {
  const window = parseWindowQuery(req.query) ?? defaultCoverageWindow();
  const data = await analyticsService.getTechniqueCoverage(window);
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

/**
 * POST /api/analytics/defender/correlation/alerts-for-tests — the same lookup
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
