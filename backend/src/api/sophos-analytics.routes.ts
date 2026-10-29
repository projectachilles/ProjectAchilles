// Sophos analytics routes — alerts, SIEM events, XDR detections, cross-
// correlation and Health Check posture, mirroring /api/analytics/sentinelone/*.
// Gated behind Clerk auth + analytics:dashboards:read, and 400 until Sophos is
// configured. Posture routes read the local ES snapshot only, never Sophos.

import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { SophosAnalyticsService } from '../services/sophos/analytics.service.js';
import {
  parseAlertSource,
  parseSeverityList,
  parseWindowQuery,
} from '../services/analytics/integration-window.js';
import { defaultCoverageWindow } from '../services/analytics/technique-coverage.js';
import { SophosPostureService, resolveActiveAchillesCert } from '../services/sophos/posture.service.js';
import { SettingsService as AnalyticsSettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';

const SOURCE_TYPES = new Set(['alert', 'siem_event', 'xdr_detection']);

/** Posture queries read the local ES snapshot only — never the Sophos API. */
function postureService(): SophosPostureService | null {
  const es = new AnalyticsSettingsService().getSettings();
  if (!es.configured) return null;
  // The query methods don't touch the Sophos client.
  return new SophosPostureService(createEsClient(es), {} as never);
}

const router = Router();

router.use(requireClerkAuth());

const analyticsService = new SophosAnalyticsService();

router.use((_req, _res, next) => {
  if (!new IntegrationsSettingsService().isSophosConfigured()) {
    next(new AppError('Sophos integration is not configured', 400));
    return;
  }
  next();
});

const READ = requirePermission('analytics:dashboards:read');

/** GET /api/analytics/sophos/alerts/summary — Alert counts by severity/status */
router.get('/alerts/summary', READ, asyncHandler(async (req, res) => {
  res.json(await analyticsService.getAlertSummary(parseWindowQuery(req.query)));
}));

/** GET /api/analytics/sophos/alerts — Paginated, filterable alerts list */
router.get('/alerts', READ, asyncHandler(async (req, res) => {
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
    sourceType: SOURCE_TYPES.has(String(req.query.sourceType)) ? String(req.query.sourceType) : undefined,
  });
  res.json(data);
}));

/** GET /api/analytics/sophos/alerts/trend — Alert creation trend */
router.get('/alerts/trend', READ, asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  res.json(await analyticsService.getAlertTrend(days, parseWindowQuery(req.query)));
}));

/** GET /api/analytics/sophos/correlation/scores — Defense Score over time; ztaScore carries the Health Check score */
router.get('/correlation/scores', READ, asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  res.json(await analyticsService.getScoreComparison(days));
}));

/** GET /api/analytics/sophos/correlation/techniques — MITRE technique overlap */
router.get('/correlation/techniques', READ, asyncHandler(async (_req, res) => {
  res.json(await analyticsService.getTechniqueOverlap());
}));

/** GET /api/analytics/sophos/correlation/technique-coverage — Evidence-based per-technique coverage */
router.get('/correlation/technique-coverage', READ, asyncHandler(async (req, res) => {
  const window = parseWindowQuery(req.query) ?? defaultCoverageWindow();
  res.json(await analyticsService.getTechniqueCoverage(window));
}));

/** GET /api/analytics/sophos/correlation/detection-rate — Per-technique detection rates */
router.get('/correlation/detection-rate', READ, asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const windowMinutes = parseInt(String(req.query.windowMinutes ?? '60'), 10);
  res.json(await analyticsService.getDetectionRate(days, windowMinutes));
}));

/** GET /api/analytics/sophos/correlation/alerts-for-test — Alerts correlated to a specific test execution */
router.get('/correlation/alerts-for-test', READ, asyncHandler(async (req, res) => {
  const techniques = String(req.query.techniques ?? '');
  const timestamp = String(req.query.timestamp ?? '');
  const windowMinutes = parseInt(String(req.query.windowMinutes ?? '30'), 10);
  const hostname = req.query.hostname ? String(req.query.hostname) : undefined;
  const binaryName = req.query.binaryName ? String(req.query.binaryName) : undefined;
  const bundleName = req.query.bundleName ? String(req.query.bundleName) : undefined;

  if (!techniques || !timestamp) {
    throw new AppError('techniques and timestamp are required', 400);
  }

  res.json(await analyticsService.getAlertsForTest(
    techniques.split(',').map((t) => t.trim()).filter(Boolean),
    timestamp,
    windowMinutes,
    hostname,
    binaryName,
    bundleName,
  ));
}));

// ---------------------------------------------------------------------------
// Posture (read from the local snapshot the posture pass writes)
// ---------------------------------------------------------------------------

/** GET /api/analytics/sophos/posture/health-check?days=30 — latest Health Check snapshot + trend */
router.get('/posture/health-check', READ, asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
  const svc = postureService();
  res.json(svc ? await svc.getHealthCheck(days) : { latest: null, trend: [] });
}));

/** GET /api/analytics/sophos/posture/endpoint-health — endpoint flag counts from the latest snapshot */
router.get('/posture/endpoint-health', READ, asyncHandler(async (_req, res) => {
  const svc = postureService();
  res.json(svc
    ? await svc.getEndpointHealth()
    : { total: 0, notSeen7d: 0, outOfDate: 0, tamperOff: 0, isolated: 0, healthBad: 0, healthSuspicious: 0, xdrInstalled: 0 });
}));

/** GET /api/analytics/sophos/posture/policies — policy deviations per policy */
router.get('/posture/policies', READ, asyncHandler(async (_req, res) => {
  const svc = postureService();
  res.json({ items: svc ? await svc.getPolicies() : [] });
}));

/** GET /api/analytics/sophos/posture/exclusion-gaps — missed tests covered by an exclusion or allow rule */
router.get('/posture/exclusion-gaps', READ, asyncHandler(async (req, res) => {
  const svc = postureService();
  if (!svc) {
    res.json({ critical: [], gaps: [], notes: [] });
    return;
  }
  const indexPattern = new AnalyticsSettingsService().getSettings().indexPattern;
  res.json(await svc.getExclusionGaps(indexPattern, parseWindowQuery(req.query), resolveActiveAchillesCert()));
}));

export default router;
