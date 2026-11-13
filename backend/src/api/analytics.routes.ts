import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { scopeResultsToCallerOrg } from '../middleware/orgScope.js';
import { requireInstallOperator } from '../middleware/installScope.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { validateUrlForSSRF } from '../middleware/urlValidation.js';
import { SettingsService } from '../services/analytics/settings.js';
import { ElasticsearchService } from '../services/analytics/elasticsearch.js';
import { createResultsIndex, listResultsIndices } from '../services/analytics/index-management.service.js';
import { resetClient as resetResultsClient } from '../services/agent/results.service.js';
import { resolvePostureWindow } from '../services/analytics/posture.js';
import { getTestFleet } from '../services/analytics/testFleet.js';
import { validate } from '../middleware/validation.js';
import { AnalyticsSettingsSchema, AnalyticsTestSchema, CreateIndexSchema, ArchiveByGroupKeysSchema, ArchiveByDateSchema } from '../schemas/analytics.schemas.js';
import type { AnalyticsQueryParams, ExtendedAnalyticsQueryParams, PaginatedExecutionsParams, ExecutionVerdict } from '../types/analytics.js';
import { EXECUTION_VERDICTS } from '../types/analytics.js';

const router = Router();

// Score definition: absent → 'executions' (API-key clients keep today's meaning).
function parseBasis(value: unknown): 'latest' | 'executions' | undefined {
  if (value === undefined) return undefined;
  if (value === 'latest' || value === 'executions') return value;
  throw new AppError('Invalid basis', 400);
}

/**
 * `scoringMode` query param. Omitted means any-stage, the rule the dashboard's
 * Defense Score uses (a multi-stage test on a host counts once, protected if
 * any stage is), so an API caller gets the number the console shows.
 * `all-stages` (every stage scored on its own) must be asked for.
 */
function parseScoringMode(value: unknown): 'all-stages' | 'any-stage' {
  if (value === undefined || value === '') return 'any-stage';
  if (value === 'all-stages' || value === 'any-stage') return value;
  throw new AppError('Invalid scoringMode', 400);
}

// Extract extended filter params from Express query object.
// Dashboard endpoints pass these through so filter bar affects all metrics.
function extractFilterParams(query: Record<string, any>): AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams> {
  return {
    org: query.org as string,
    from: query.from as string,
    to: query.to as string,
    tests: query.tests as string,
    techniques: query.techniques as string,
    hostnames: query.hostnames as string,
    categories: query.categories as string,
    severities: query.severities as string,
    threatActors: query.threatActors as string,
    tags: query.tags as string,
    errorNames: query.errorNames as string,
    errorCodes: query.errorCodes as string,
    bundleNames: query.bundleNames as string,
    result: query.result as 'all' | 'protected' | 'unprotected' | 'inconclusive',
    scoringMode: parseScoringMode(query.scoringMode),
    basis: parseBasis(query.basis),
  };
}

// Protect all analytics routes with Clerk authentication

/**
 * Saved credentials (API key, username/password, CA certificate) belong to the
 * saved cluster. A request reuses them only when it targets that same cluster:
 * same connection type and, when it names one, the same Cloud ID or node URL.
 * Otherwise anyone allowed to test or save settings could send the saved
 * credentials to a host of their choosing just by changing the target.
 */
function targetsSavedCluster(
  existing: { configured?: boolean; connectionType?: string; cloudId?: string; node?: string },
  requested: { connectionType?: string; cloudId?: string; node?: string },
): boolean {
  if (!existing.configured) return false;
  if (requested.connectionType && requested.connectionType !== existing.connectionType) return false;
  if (requested.cloudId && requested.cloudId !== existing.cloudId) return false;
  if (requested.node && normalizeNodeUrl(requested.node) !== normalizeNodeUrl(existing.node)) return false;
  return true;
}

/** Comparable form of a node URL: parsed and without trailing slashes. */
function normalizeNodeUrl(node: string | undefined): string {
  const raw = (node ?? '').trim();
  try {
    return stripTrailingSlashes(new URL(raw).toString());
  } catch {
    return stripTrailingSlashes(raw);
  }
}

/** Linear-time, unlike /\/+$/ (which backtracks on a long run of slashes). */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return value.slice(0, end);
}

/** /indices lists Achilles indices only (results and archives), never the whole cluster. */
const ACHILLES_INDEX_PATTERN = /^(archived-)?achilles[a-z0-9._*-]*$/;

router.use(requireClerkAuth());

// A caller in an organization only queries (and archives) its own
// organization's results. The Elasticsearch connection and index management
// are install configuration, not results.
router.use(scopeResultsToCallerOrg(['/settings', '/settings/test', '/indices', '/index/create']));

// Initialize services
const settingsService = new SettingsService();
let esService: ElasticsearchService | null = null;

// Helper to get ES service (initializes if needed)
async function getEsService(): Promise<ElasticsearchService> {
  if (!esService) {
    const settings = settingsService.getSettings();
    if (!settings.configured) {
      throw new AppError('Elasticsearch not configured', 400);
    }
    esService = new ElasticsearchService(settings);
  }
  return esService;
}

// GET /api/analytics/settings - Get settings (masked)
router.get('/settings', requirePermission('analytics:settings:read'), (_req, res) => {
  const settings = settingsService.getSettings();
  res.json({
    configured: settings.configured,
    connectionType: settings.connectionType,
    indexPattern: settings.indexPattern,
    writeIndexPrefix: settings.writeIndexPrefix ?? 'achilles-results-',
    writeIndexRollover: settings.writeIndexRollover ?? 'none',
    // Mask sensitive fields
    cloudId: settings.cloudId ? '***' : undefined,
    node: settings.node,
    // Surface non-secret TLS state so the UI can reflect what's saved.
    // caCert is not echoed back as content — only its presence is signalled
    // via a placeholder so the textarea can show "leave blank to keep current".
    caCert: settings.caCert ? '***' : undefined,
    tlsInsecureSkipVerify: settings.tlsInsecureSkipVerify ?? false,
  });
});

// POST /api/analytics/settings - Save settings
router.post('/settings', requirePermission('analytics:settings:write'), requireInstallOperator, validate(AnalyticsSettingsSchema), asyncHandler(async (req, res) => {
  const { connectionType, cloudId, apiKey, node, username, password, indexPattern, caCert, tlsInsecureSkipVerify, writeIndexPrefix, writeIndexRollover } = req.body;

  // Load existing settings to merge with new values
  // This allows updating settings without providing all credentials
  const existingSettings = settingsService.getSettings();

  // Saved credentials are reused only against the saved cluster (targetsSavedCluster):
  // a different connection type, Cloud ID or node URL starts from empty credentials,
  // so they can never be sent to a host the request names.
  const isNewTarget = !targetsSavedCluster(existingSettings, { connectionType, cloudId, node });

  // For a new target, fall back to empty rather than the saved cluster's value.
  const fallback = <T>(prev: T | undefined): T | string => (isNewTarget ? '' : (prev ?? ''));

  // Validate self-hosted ES node URL against SSRF before saving
  const effectiveNode = node || (isNewTarget ? '' : existingSettings.node);
  if (connectionType === 'self-hosted' && effectiveNode) {
    await validateUrlForSSRF(effectiveNode);
  }

  // Merge: use new values if provided, otherwise keep existing ones (unless the target changed).
  const settingsToSave = {
    connectionType,
    cloudId: cloudId || fallback(existingSettings.cloudId),
    apiKey: apiKey || fallback(existingSettings.apiKey),
    node: effectiveNode,
    username: username || fallback(existingSettings.username),
    password: password || fallback(existingSettings.password),
    // indexPattern survives target changes — it's a query-shape concern, not a credential
    indexPattern: indexPattern || existingSettings.indexPattern || 'achilles-results-*',
    writeIndexPrefix: writeIndexPrefix ?? existingSettings.writeIndexPrefix ?? 'achilles-results-',
    writeIndexRollover: writeIndexRollover ?? existingSettings.writeIndexRollover ?? 'none',
    configured: true,
    // TLS overrides: caCert blank-string keeps existing (matches credential-merge semantics);
    // tlsInsecureSkipVerify is an explicit boolean so we accept the new value when defined.
    // Both are direct-mode-only, so for a new target they're cleared.
    caCert: caCert || fallback(existingSettings.caCert),
    tlsInsecureSkipVerify:
      typeof tlsInsecureSkipVerify === 'boolean'
        ? tlsInsecureSkipVerify
        : isNewTarget ? false : existingSettings.tlsInsecureSkipVerify,
  };

  settingsService.saveSettings(settingsToSave);

  // Reset ES service to use new settings
  esService = null;

  // Also reset the results ingestion client so it picks up the new credentials
  resetResultsClient();

  res.json({ success: true });
}));

// POST /api/analytics/settings/test - Test connection
router.post('/settings/test', requirePermission('analytics:settings:write'), validate(AnalyticsTestSchema), asyncHandler(async (req, res) => {
  const { connectionType, cloudId, apiKey, node, username, password, caCert, tlsInsecureSkipVerify } = req.body;

  // Merge with existing settings so edit-mode tests work with blank credentials
  const existingSettings = settingsService.getSettings();

  // Same rule as the save handler: saved credentials only ever go to the saved
  // cluster, never to a node or Cloud ID the request supplies.
  const effectiveType = connectionType || existingSettings.connectionType;
  const isNewTarget = !targetsSavedCluster(existingSettings, { connectionType, cloudId, node });
  const fallback = <T>(prev: T | undefined): T | string => (isNewTarget ? '' : (prev ?? ''));

  try {
    // Validate self-hosted ES node URL against SSRF (cloud IDs are safe — they resolve to *.elastic-cloud.com)
    const effectiveNode = node || (isNewTarget ? '' : existingSettings.node);
    if (effectiveType === 'self-hosted' && effectiveNode) {
      await validateUrlForSSRF(effectiveNode);
    }

    const testService = new ElasticsearchService({
      connectionType: effectiveType,
      cloudId: cloudId || fallback(existingSettings.cloudId),
      apiKey: apiKey || fallback(existingSettings.apiKey),
      node: effectiveNode,
      username: username || fallback(existingSettings.username),
      password: password || fallback(existingSettings.password),
      indexPattern: existingSettings.indexPattern || 'achilles-results-*',
      configured: true,
      caCert: caCert || fallback(existingSettings.caCert),
      tlsInsecureSkipVerify:
        typeof tlsInsecureSkipVerify === 'boolean'
          ? tlsInsecureSkipVerify
          : isNewTarget ? false : existingSettings.tlsInsecureSkipVerify,
    });

    const version = await testService.testConnection();
    res.json({ success: true, version });
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    });
  }
}));

// All dashboard/query routes below require analytics:dashboards:read
router.use(requirePermission('analytics:dashboards:read'));

// GET /api/analytics/defense-score - Overall defense score
// basis=latest → latest-result posture (share of test × endpoint pairs whose
// latest conclusive result in the window is protected).
router.get('/defense-score', asyncHandler(async (req, res) => {
  const filterParams = extractFilterParams(req.query);
  const es = await getEsService();
  const result = filterParams.basis === 'latest'
    ? await es.getDefenseScoreLatest(filterParams, { withNoConclusive: req.query.withNoConclusive === 'true' })
    : await es.getDefenseScore(filterParams);
  res.json(result);
}));

// GET /api/analytics/defense-score/trend - Score over time
// Supports rolling window aggregation via windowDays param (1-90 days).
// basis=latest: each point is the tile's calculation as of that day; windowDays is ignored.
router.get('/defense-score/trend', asyncHandler(async (req, res) => {
  const filterParams = extractFilterParams(req.query);
  const es = await getEsService();
  const { interval, windowDays } = req.query;

  if (filterParams.basis === 'latest') {
    res.json(await es.getDefenseScoreTrendLatest(filterParams));
    return;
  }

  // Parse and clamp windowDays to 1-90 range
  const parsedWindowDays = windowDays ? parseInt(windowDays as string, 10) : undefined;
  const clampedWindowDays = parsedWindowDays
    ? Math.max(1, Math.min(90, parsedWindowDays))
    : undefined;

  // Use rolling window method when windowDays is provided, otherwise fall back to original
  if (clampedWindowDays) {
    const result = await es.getDefenseScoreTrendRolling({
      ...filterParams,
      interval: (interval as string) || 'day',
      windowDays: clampedWindowDays,
    });
    res.json(result);
  } else {
    const result = await es.getDefenseScoreTrend({
      ...filterParams,
      interval: (interval as string) || 'day',
      excludeCyberHygiene: req.query.excludeCyberHygiene === 'true',
    });
    res.json(result);
  }
}));

// GET /api/analytics/defense-score/by-test - Score by test
router.get('/defense-score/by-test', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { limit } = req.query;
  const result = await es.getDefenseScoreByTest({
    ...extractFilterParams(req.query),
    limit: limit ? parseInt(limit as string) : 10,
  });
  res.json(result);
}));

// GET /api/analytics/defense-score/by-technique - Score by technique
router.get('/defense-score/by-technique', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getDefenseScoreByTechnique(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/executions - Recent executions
router.get('/executions', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, limit } = req.query;

  const result = await es.getRecentExecutions({
    org: org as string,
    from: from as string,
    to: to as string,
    limit: limit ? parseInt(limit as string) : 50,
  });

  res.json(result);
}));

// GET /api/analytics/organizations - List organizations
router.get('/organizations', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getOrganizations(req.query.org as string | undefined);
  res.json(result);
}));

// GET /api/analytics/unique-hostnames - Count unique hostnames
router.get('/unique-hostnames', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const count = await es.getUniqueHostnames(extractFilterParams(req.query));
  res.json({ count });
}));

// GET /api/analytics/unique-tests - Count unique tests
router.get('/unique-tests', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const count = await es.getUniqueTests(extractFilterParams(req.query));
  res.json({ count });
}));

// GET /api/analytics/results-by-error-type - Error type breakdown
router.get('/results-by-error-type', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getResultsByErrorType(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/test-coverage - Protected vs unprotected per test
router.get('/test-coverage', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const filterParams = extractFilterParams(req.query);
  const result = filterParams.basis === 'latest'
    ? await es.getTestCoverageLatest(filterParams)
    : await es.getTestCoverage(filterParams);
  res.json(result);
}));

// GET /api/analytics/technique-distribution - Protected vs unprotected per technique
router.get('/technique-distribution', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const filterParams = extractFilterParams(req.query);
  const result = filterParams.basis === 'latest'
    ? await es.getTechniqueDistributionLatest(filterParams)
    : await es.getTechniqueDistribution(filterParams);
  res.json(result);
}));

// GET /api/analytics/host-test-matrix - Host-test matrix for heatmap
router.get('/host-test-matrix', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getHostTestMatrix(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/available-tests - List all available tests
router.get('/available-tests', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const tests = await es.getAvailableTests(req.query.org as string | undefined);
  res.json(tests);
}));

// GET /api/analytics/executed-test-uuids - List all test UUIDs that have been executed
router.get('/executed-test-uuids', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const uuids = await es.getExecutedTestUuids(req.query.org as string | undefined);
  res.json({ success: true, uuids });
}));

// GET /api/analytics/available-techniques - List all available techniques
router.get('/available-techniques', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const techniques = await es.getAvailableTechniques(req.query.org as string | undefined);
  res.json(techniques);
}));

// GET /api/analytics/defense-score/by-org - Score by organization (optional)
router.get('/defense-score/by-org', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  // For a caller in an organization, org is its own (scopeResultsToCallerOrg):
  // one bucket, never every organization's score.
  const result = await es.getDefenseScoreByOrg({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(result);
}));

// ============================================
// New Endpoints for Enhanced Analytics
// ============================================

// GET /api/analytics/executions/paginated - Paginated executions with extended filters
router.get('/executions/paginated', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const {
    org, from, to, tests, techniques,
    hostnames, categories, severities, threatActors, tags,
    errorNames, errorCodes, bundleNames, result,
    page, pageSize, sortField, sortOrder, grouped, verdict
  } = req.query;

  if (verdict !== undefined && !EXECUTION_VERDICTS.includes(verdict as ExecutionVerdict)) {
    throw new AppError('Invalid verdict', 400);
  }

  const params: PaginatedExecutionsParams = {
    org: org as string,
    from: from as string,
    to: to as string,
    tests: tests as string,
    techniques: techniques as string,
    hostnames: hostnames as string,
    categories: categories as string,
    severities: severities as string,
    threatActors: threatActors as string,
    tags: tags as string,
    errorNames: errorNames as string,
    errorCodes: errorCodes as string,
    bundleNames: bundleNames as string,
    result: result as 'all' | 'protected' | 'unprotected' | 'inconclusive',
    page: page ? parseInt(page as string) : 1,
    pageSize: pageSize ? parseInt(pageSize as string) : 25,
    sortField: sortField as string,
    sortOrder: sortOrder as 'asc' | 'desc',
    grouped: grouped === 'true',
    verdict: verdict as ExecutionVerdict | undefined,
  };

  if (params.grouped) {
    const data = await es.getGroupedPaginatedExecutions(params);
    res.json(data);
  } else {
    const data = await es.getPaginatedExecutions(params);
    res.json(data);
  }
}));

// GET /api/analytics/filter-options - Every filter-dropdown list in one ES query.
// Same lists as the ten /available-* endpoints (kept for other API clients);
// org/from/to scope the same eight lists those endpoints scope.
router.get('/filter-options', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;
  const options = await es.getFilterOptions({
    org: org as string,
    from: from as string,
    to: to as string,
  });
  res.json(options);
}));

// GET /api/analytics/available-hostnames - List available hostnames with counts
router.get('/available-hostnames', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const hostnames = await es.getAvailableHostnames({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(hostnames);
}));

// GET /api/analytics/available-categories - List available categories with counts
router.get('/available-categories', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const categories = await es.getAvailableCategories({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(categories);
}));

// GET /api/analytics/available-severities - List available severities with counts
router.get('/available-severities', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const severities = await es.getAvailableSeverities({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(severities);
}));

// GET /api/analytics/available-threat-actors - List available threat actors with counts
router.get('/available-threat-actors', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const threatActors = await es.getAvailableThreatActors({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(threatActors);
}));

// GET /api/analytics/available-tags - List available tags with counts
router.get('/available-tags', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const tags = await es.getAvailableTags({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(tags);
}));

// GET /api/analytics/available-error-names - List available error names with counts
router.get('/available-error-names', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const errorNames = await es.getAvailableErrorNames({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(errorNames);
}));

// GET /api/analytics/available-error-codes - List available error codes with counts
router.get('/available-error-codes', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const errorCodes = await es.getAvailableErrorCodes({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(errorCodes);
}));

// GET /api/analytics/available-bundle-names - List available bundle names with counts
router.get('/available-bundle-names', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const bundleNames = await es.getAvailableBundleNames({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(bundleNames);
}));

// GET /api/analytics/defense-score/by-severity - Score breakdown by severity
router.get('/defense-score/by-severity', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getDefenseScoreBySeverity(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/defense-score/by-category - Score breakdown by category
router.get('/defense-score/by-category', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getDefenseScoreByCategory(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/defense-score/by-category-subcategory - Score breakdown by category with subcategories
router.get('/defense-score/by-category-subcategory', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const filterParams = extractFilterParams(req.query);
  const result = filterParams.basis === 'latest'
    ? await es.getDefenseScoreByCategoryWithSubcategoriesLatest(filterParams)
    : await es.getDefenseScoreByCategoryWithSubcategories(filterParams);
  res.json(result);
}));

// GET /api/analytics/threat-actor-coverage - Threat actor coverage metrics
router.get('/threat-actor-coverage', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const filterParams = extractFilterParams(req.query);
  const result = filterParams.basis === 'latest'
    ? await es.getThreatActorCoverageLatest(filterParams)
    : await es.getThreatActorCoverage(filterParams);
  res.json(result);
}));

// GET /api/analytics/test-results - Per-test fleet results (last 90 days,
// latest pair per host) for the test library. Takes the usual filters; the
// window and scoring rule are fixed by the service.
router.get('/test-results', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getTestResults(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/test-results/:uuid/stages - One test's fleet results: the
// any-stage headline plus the per-stage split (same fixed window as above).
router.get('/test-results/:uuid/stages', asyncHandler(async (req, res) => {
  // Lower-cased: library UUIDs are, and the ES term match is case-sensitive.
  const uuid = String(req.params.uuid).toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uuid)) {
    throw new AppError('Invalid test UUID format', 400);
  }
  const es = await getEsService();
  const result = await getTestFleet(es, uuid, extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/technique-outcomes - Blocked / detected-only / got-through
// per technique. Always latest-result posture (per-stage pairs); basis is ignored.
router.get('/technique-outcomes', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { basis: _basis, ...query } = req.query;
  const result = await es.getTechniqueOutcomes(extractFilterParams(query));
  res.json(result);
}));

// GET /api/analytics/chain-depth - Stage each chain's latest run was blocked at
// (non-cyber-hygiene bundles). Always latest-result posture; basis is ignored.
router.get('/chain-depth', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { basis: _basis, ...query } = req.query;
  const result = await es.getChainDepth(extractFilterParams(query));
  res.json(result);
}));

// GET /api/analytics/outcome-breakdown - Protected / prevented / detected / silent
// split of the latest-basis pairs. Basis is ignored; outcome filters are ignored by the service.
router.get('/outcome-breakdown', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { basis: _basis, ...query } = req.query;
  const result = await es.getOutcomeBreakdown(extractFilterParams(query));
  res.json(result);
}));

// GET /api/analytics/defense-score/by-hostname - Score breakdown by hostname
router.get('/defense-score/by-hostname', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { limit } = req.query;
  const filterParams = {
    ...extractFilterParams(req.query),
    limit: limit ? parseInt(limit as string) : 50,
  };
  const result = filterParams.basis === 'latest'
    ? await es.getDefenseScoreByHostnameLatest(filterParams)
    : await es.getDefenseScoreByHostname(filterParams);
  res.json(result);
}));

// GET /api/analytics/error-rate/trend - Error rate over time (rolling window)
router.get('/error-rate/trend', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { interval, windowDays } = req.query;
  const filterParams = extractFilterParams(req.query);

  // Explicit windowDays keeps the 1-90 clamp; otherwise the window is the
  // range length (so the trend is not a 7-day rolling average of a longer range).
  const parsedWindowDays = windowDays ? parseInt(windowDays as string, 10) : undefined;
  let effectiveWindowDays: number;
  if (parsedWindowDays) {
    effectiveWindowDays = Math.max(1, Math.min(90, parsedWindowDays));
  } else {
    const { freshnessMs } = resolvePostureWindow(filterParams.from, filterParams.to, Date.now());
    effectiveWindowDays = Math.max(1, Math.min(365, Math.round(freshnessMs / 86_400_000)));
  }

  const result = await es.getErrorRateTrendRolling({
    ...filterParams,
    interval: (interval as string) || 'day',
    windowDays: effectiveWindowDays,
  });

  res.json(result);
}));

// GET /api/analytics/error-rate - Error rate (proportion of non-conclusive test activity)
router.get('/error-rate', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const result = await es.getErrorRate(extractFilterParams(req.query));
  res.json(result);
}));

// GET /api/analytics/execution-activity - Recent per-day execution counts for the cadence card
router.get('/execution-activity', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const parsed = parseInt(req.query.days as string, 10);
  const days = Number.isFinite(parsed) ? Math.max(1, Math.min(90, parsed)) : 14;
  const result = await es.getExecutionActivity({ org: req.query.org as string | undefined, days });
  res.json(result);
}));

// GET /api/analytics/canonical-test-count - Stable test count for coverage denominators
router.get('/canonical-test-count', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, days } = req.query;

  const result = await es.getCanonicalTestCount({
    org: org as string,
    days: days ? parseInt(days as string) : 90,
  });

  res.json(result);
}));

// GET /api/analytics/indices - List ES indices matching a pattern
router.get('/indices', asyncHandler(async (req, res) => {
  const { pattern } = req.query;

  // Always default to all results indices — the configured indexPattern scopes
  // analytics queries, not the management view.
  const indexPattern = (pattern as string | undefined) || 'achilles-results-*';
  if (typeof indexPattern !== 'string' || !ACHILLES_INDEX_PATTERN.test(indexPattern)) {
    throw new AppError('pattern must name Achilles indices (achilles-* or archived-achilles*)', 400);
  }

  const indices = await listResultsIndices(indexPattern);
  res.json({ success: true, indices });
}));

// POST /api/analytics/index/create - Create an ES index with the results mapping
router.post('/index/create', requirePermission('analytics:index:create'), requireInstallOperator, validate(CreateIndexSchema), asyncHandler(async (req, res) => {
  const { index_name } = req.body as { index_name: string };

  const result = await createResultsIndex(index_name);

  res.json({ success: true, ...result });
}));

// ============================================
// Archive Endpoints
// ============================================

// POST /api/analytics/executions/archive - Archive executions by group keys
router.post('/executions/archive', requirePermission('analytics:executions:archive'), validate(ArchiveByGroupKeysSchema), asyncHandler(async (req, res) => {
  const { groupKeys } = req.body as { groupKeys: string[] };

  const es = await getEsService();
  // Only the caller org's results when it has one (set by scopeResultsToCallerOrg).
  const result = await es.archiveByGroupKeys(groupKeys, req.query.org as string | undefined);
  res.json({ success: true, archived: result.archived, errors: result.errors });
}));

// POST /api/analytics/executions/archive-by-date - Archive executions before a date
router.post('/executions/archive-by-date', requirePermission('analytics:executions:archive'), validate(ArchiveByDateSchema), asyncHandler(async (req, res) => {
  const { before } = req.body as { before: string };

  const es = await getEsService();
  const result = await es.archiveByDateRange(before, req.query.org as string | undefined);
  res.json({ success: true, archived: result.archived, errors: result.errors });
}));

export default router;
