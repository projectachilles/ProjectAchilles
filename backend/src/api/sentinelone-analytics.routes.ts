// SentinelOne analytics routes — alerts and cross-correlation, mirroring
// /api/analytics/crowdstrike/* (minus the ZTA score, which has no
// SentinelOne equivalent). Gated behind Clerk auth +
// analytics:dashboards:read, and 400 until SentinelOne is configured.

import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { IntegrationsSettingsService } from '../services/integrations/settings.js';
import { SentinelOneAnalyticsService } from '../services/sentinelone/analytics.service.js';
import {
  parseAlertSource,
  parseSeverityList,
  parseWindowQuery,
} from '../services/analytics/integration-window.js';
import { defaultCoverageWindow } from '../services/analytics/technique-coverage.js';
import { SentinelOnePostureService } from '../services/sentinelone/posture.service.js';
import { SettingsService as AnalyticsSettingsService } from '../services/analytics/settings.js';
import { createEsClient } from '../services/analytics/client.js';

const SOURCE_TYPES = new Set(['threats', 'cloud_detection_alerts']);

/** Posture queries read the local ES snapshot only — never the S1 API. */
function postureService(): SentinelOnePostureService | null {
  const es = new AnalyticsSettingsService().getSettings();
  if (!es.configured) return null;
  // The query methods don't touch the S1 client.
  return new SentinelOnePostureService(createEsClient(es), {} as never);
}

const router = Router();

router.use(requireClerkAuth());

const analyticsService = new SentinelOneAnalyticsService();

router.use((_req, _res, next) => {
  if (!new IntegrationsSettingsService().isSentinelOneConfigured()) {
    next(new AppError('SentinelOne integration is not configured', 400));
    return;
  }
  next();
});

const READ = requirePermission('analytics:dashboards:read');

/** GET /api/analytics/sentinelone/alerts/summary — Alert counts by severity/status */
router.get('/alerts/summary', READ, asyncHandler(async (req, res) => {
  res.json(await analyticsService.getAlertSummary(parseWindowQuery(req.query)));
}));

/** GET /api/analytics/sentinelone/alerts — Paginated, filterable alerts list */
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

/** GET /api/analytics/sentinelone/alerts/trend — Alert creation trend */
router.get('/alerts/trend', READ, asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  res.json(await analyticsService.getAlertTrend(days, parseWindowQuery(req.query)));
}));

/** GET /api/analytics/sentinelone/correlation/scores — Defense Score over time (ztaScore always null) */
router.get('/correlation/scores', READ, asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '90'), 10);
  res.json(await analyticsService.getScoreComparison(days));
}));

/** GET /api/analytics/sentinelone/correlation/techniques — MITRE technique overlap */
router.get('/correlation/techniques', READ, asyncHandler(async (_req, res) => {
  res.json(await analyticsService.getTechniqueOverlap());
}));

/** GET /api/analytics/sentinelone/correlation/technique-coverage — Evidence-based per-technique coverage */
router.get('/correlation/technique-coverage', READ, asyncHandler(async (req, res) => {
  const window = parseWindowQuery(req.query) ?? defaultCoverageWindow();
  res.json(await analyticsService.getTechniqueCoverage(window));
}));

/** GET /api/analytics/sentinelone/correlation/detection-rate — Per-technique detection rates */
router.get('/correlation/detection-rate', READ, asyncHandler(async (req, res) => {
  const days = parseInt(String(req.query.days ?? '30'), 10);
  const windowMinutes = parseInt(String(req.query.windowMinutes ?? '60'), 10);
  res.json(await analyticsService.getDetectionRate(days, windowMinutes));
}));

/** GET /api/analytics/sentinelone/correlation/alerts-for-test — Alerts correlated to a specific test execution */
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
// Posture (read from the local snapshot the posture pass writes; no score)
// ---------------------------------------------------------------------------

/** GET /api/analytics/sentinelone/posture/policies — protection policy per account / site / group */
router.get('/posture/policies', READ, asyncHandler(async (_req, res) => {
  const svc = postureService();
  res.json({ items: svc ? await svc.getPolicies() : [] });
}));

/** GET /api/analytics/sentinelone/posture/agent-health?days=30 — latest /agents/count snapshot + trend */
router.get('/posture/agent-health', READ, asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
  const svc = postureService();
  res.json(svc ? await svc.getAgentHealth(days) : { latest: null, trend: [] });
}));

/** GET /api/analytics/sentinelone/posture/exclusion-gaps — missed tests covered by an exclusion */
router.get('/posture/exclusion-gaps', READ, asyncHandler(async (req, res) => {
  const svc = postureService();
  if (!svc) {
    res.json({ exclusionsTotal: 0, byType: {}, unmatchable: 0, s1Agents: 0, missedOnS1Hosts: 0, missedOnOtherHosts: 0, flagged: [] });
    return;
  }
  const indexPattern = new AnalyticsSettingsService().getSettings().indexPattern;
  res.json(await svc.getExclusionGaps(indexPattern, parseWindowQuery(req.query)));
}));

export default router;
