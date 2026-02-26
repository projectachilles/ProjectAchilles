import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { SettingsService } from '../services/analytics/settings.js';
import { ElasticsearchService } from '../services/analytics/elasticsearch.js';
import { createResultsIndex, listResultsIndices } from '../services/analytics/index-management.service.js';
import { resetClient as resetResultsClient } from '../services/agent/results.service.js';
import type { AnalyticsQueryParams, PaginatedExecutionsParams } from '../types/analytics.js';

const router = Router();

// Protect all analytics routes with Clerk authentication
router.use(requireClerkAuth());

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
    // Mask sensitive fields
    cloudId: settings.cloudId ? '***' : undefined,
    node: settings.node,
  });
});

// POST /api/analytics/settings - Save settings
router.post('/settings', requirePermission('analytics:settings:write'), asyncHandler(async (req, res) => {
  const { connectionType, cloudId, apiKey, node, username, password, indexPattern } = req.body;

  if (!connectionType) {
    throw new AppError('Connection type is required', 400);
  }

  // Load existing settings to merge with new values
  // This allows updating settings without providing all credentials
  const existingSettings = settingsService.getSettings();

  // Merge: use new values if provided, otherwise keep existing ones
  const settingsToSave = {
    connectionType,
    cloudId: cloudId || existingSettings.cloudId,
    apiKey: apiKey || existingSettings.apiKey,
    node: node || existingSettings.node,
    username: username || existingSettings.username,
    password: password || existingSettings.password,
    indexPattern: indexPattern || existingSettings.indexPattern || 'achilles-results-*',
    configured: true,
  };

  settingsService.saveSettings(settingsToSave);

  // Reset ES service to use new settings
  esService = null;

  // Also reset the results ingestion client so it picks up the new credentials
  resetResultsClient();

  res.json({ success: true });
}));

// POST /api/analytics/settings/test - Test connection
router.post('/settings/test', requirePermission('analytics:settings:read'), asyncHandler(async (req, res) => {
  const { connectionType, cloudId, apiKey, node, username, password } = req.body;

  // Merge with existing settings so edit-mode tests work with blank credentials
  const existingSettings = settingsService.getSettings();

  try {
    const testService = new ElasticsearchService({
      connectionType: connectionType || existingSettings.connectionType,
      cloudId: cloudId || existingSettings.cloudId,
      apiKey: apiKey || existingSettings.apiKey,
      node: node || existingSettings.node,
      username: username || existingSettings.username,
      password: password || existingSettings.password,
      indexPattern: existingSettings.indexPattern || 'achilles-results-*',
      configured: true,
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
router.get('/defense-score', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getDefenseScore({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(result);
}));

// GET /api/analytics/defense-score/trend - Score over time
// Supports rolling window aggregation via windowDays param (1-90 days)
router.get('/defense-score/trend', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, interval, windowDays } = req.query;

  // Parse and clamp windowDays to 1-90 range
  const parsedWindowDays = windowDays ? parseInt(windowDays as string, 10) : undefined;
  const clampedWindowDays = parsedWindowDays
    ? Math.max(1, Math.min(90, parsedWindowDays))
    : undefined;

  // Use rolling window method when windowDays is provided, otherwise fall back to original
  if (clampedWindowDays) {
    const result = await es.getDefenseScoreTrendRolling({
      org: org as string,
      from: from as string,
      to: to as string,
      interval: (interval as string) || 'day',
      windowDays: clampedWindowDays,
    });
    res.json(result);
  } else {
    const result = await es.getDefenseScoreTrend({
      org: org as string,
      from: from as string,
      to: to as string,
      interval: (interval as string) || 'day',
    });
    res.json(result);
  }
}));

// GET /api/analytics/defense-score/by-test - Score by test
router.get('/defense-score/by-test', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, limit } = req.query;

  const result = await es.getDefenseScoreByTest({
    org: org as string,
    from: from as string,
    to: to as string,
    limit: limit ? parseInt(limit as string) : 10,
  });

  res.json(result);
}));

// GET /api/analytics/defense-score/by-technique - Score by technique
router.get('/defense-score/by-technique', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getDefenseScoreByTechnique({
    org: org as string,
    from: from as string,
    to: to as string,
  });

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
router.get('/organizations', asyncHandler(async (_req, res) => {
  const es = await getEsService();
  const result = await es.getOrganizations();
  res.json(result);
}));

// GET /api/analytics/unique-hostnames - Count unique hostnames
router.get('/unique-hostnames', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const count = await es.getUniqueHostnames(req.query as AnalyticsQueryParams);
  res.json({ count });
}));

// GET /api/analytics/unique-tests - Count unique tests
router.get('/unique-tests', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const count = await es.getUniqueTests(req.query as AnalyticsQueryParams);
  res.json({ count });
}));

// GET /api/analytics/results-by-error-type - Error type breakdown
router.get('/results-by-error-type', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, tests, techniques } = req.query;

  const result = await es.getResultsByErrorType({
    org: org as string,
    from: from as string,
    to: to as string,
    tests: tests as string,
    techniques: techniques as string,
  });

  res.json(result);
}));

// GET /api/analytics/test-coverage - Protected vs unprotected per test
router.get('/test-coverage', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, tests, techniques } = req.query;

  const result = await es.getTestCoverage({
    org: org as string,
    from: from as string,
    to: to as string,
    tests: tests as string,
    techniques: techniques as string,
  });

  res.json(result);
}));

// GET /api/analytics/technique-distribution - Protected vs unprotected per technique
router.get('/technique-distribution', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, tests, techniques } = req.query;

  const result = await es.getTechniqueDistribution({
    org: org as string,
    from: from as string,
    to: to as string,
    tests: tests as string,
    techniques: techniques as string,
  });

  res.json(result);
}));

// GET /api/analytics/host-test-matrix - Host-test matrix for heatmap
router.get('/host-test-matrix', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, tests, techniques } = req.query;

  const result = await es.getHostTestMatrix({
    org: org as string,
    from: from as string,
    to: to as string,
    tests: tests as string,
    techniques: techniques as string,
  });

  res.json(result);
}));

// GET /api/analytics/available-tests - List all available tests
router.get('/available-tests', asyncHandler(async (_req, res) => {
  const es = await getEsService();
  const tests = await es.getAvailableTests();
  res.json(tests);
}));

// GET /api/analytics/available-techniques - List all available techniques
router.get('/available-techniques', asyncHandler(async (_req, res) => {
  const es = await getEsService();
  const techniques = await es.getAvailableTechniques();
  res.json(techniques);
}));

// GET /api/analytics/defense-score/by-org - Score by organization (optional)
router.get('/defense-score/by-org', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { from, to } = req.query;

  const result = await es.getDefenseScoreByOrg({
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
    errorNames, errorCodes, result,
    page, pageSize, sortField, sortOrder, grouped
  } = req.query;

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
    result: result as 'all' | 'protected' | 'unprotected' | 'inconclusive',
    page: page ? parseInt(page as string) : 1,
    pageSize: pageSize ? parseInt(pageSize as string) : 25,
    sortField: sortField as string,
    sortOrder: sortOrder as 'asc' | 'desc',
    grouped: grouped === 'true',
  };

  if (params.grouped) {
    const data = await es.getGroupedPaginatedExecutions(params);
    res.json(data);
  } else {
    const data = await es.getPaginatedExecutions(params);
    res.json(data);
  }
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

// GET /api/analytics/defense-score/by-severity - Score breakdown by severity
router.get('/defense-score/by-severity', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getDefenseScoreBySeverity({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(result);
}));

// GET /api/analytics/defense-score/by-category - Score breakdown by category
router.get('/defense-score/by-category', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getDefenseScoreByCategory({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(result);
}));

// GET /api/analytics/defense-score/by-category-subcategory - Score breakdown by category with subcategories
router.get('/defense-score/by-category-subcategory', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getDefenseScoreByCategoryWithSubcategories({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(result);
}));

// GET /api/analytics/threat-actor-coverage - Threat actor coverage metrics
router.get('/threat-actor-coverage', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getThreatActorCoverage({
    org: org as string,
    from: from as string,
    to: to as string,
  });

  res.json(result);
}));

// GET /api/analytics/defense-score/by-hostname - Score breakdown by hostname
router.get('/defense-score/by-hostname', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, limit } = req.query;

  const result = await es.getDefenseScoreByHostname({
    org: org as string,
    from: from as string,
    to: to as string,
    limit: limit ? parseInt(limit as string) : 50,
  });

  res.json(result);
}));

// GET /api/analytics/error-rate/trend - Error rate over time (rolling window)
router.get('/error-rate/trend', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, interval, windowDays } = req.query;

  const parsedWindowDays = windowDays ? parseInt(windowDays as string, 10) : undefined;
  const clampedWindowDays = parsedWindowDays
    ? Math.max(1, Math.min(90, parsedWindowDays))
    : undefined;

  const result = await es.getErrorRateTrendRolling({
    org: org as string,
    from: from as string,
    to: to as string,
    interval: (interval as string) || 'day',
    windowDays: clampedWindowDays || 7,
  });

  res.json(result);
}));

// GET /api/analytics/error-rate - Error rate (proportion of non-conclusive test activity)
router.get('/error-rate', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to } = req.query;

  const result = await es.getErrorRate({
    org: org as string,
    from: from as string,
    to: to as string,
  });

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

  const indices = await listResultsIndices(indexPattern);
  res.json({ success: true, indices });
}));

// POST /api/analytics/index/create - Create an ES index with the results mapping
router.post('/index/create', requirePermission('analytics:index:create'), asyncHandler(async (req, res) => {
  const { index_name } = req.body as { index_name?: string };

  if (!index_name || typeof index_name !== 'string') {
    throw new AppError('Missing required field: index_name', 400);
  }

  // Validate index name: lowercase, alphanumeric + hyphens only
  if (!/^[a-z0-9][a-z0-9-]*$/.test(index_name)) {
    throw new AppError(
      'Invalid index name. Must be lowercase, start with a letter or digit, and contain only letters, digits, and hyphens.',
      400,
    );
  }

  const result = await createResultsIndex(index_name);

  res.json({ success: true, ...result });
}));

// ============================================
// Archive Endpoints
// ============================================

// POST /api/analytics/executions/archive - Archive executions by group keys
router.post('/executions/archive', requirePermission('analytics:executions:archive'), asyncHandler(async (req, res) => {
  const { groupKeys } = req.body as { groupKeys?: string[] };

  if (!Array.isArray(groupKeys) || groupKeys.length === 0) {
    throw new AppError('groupKeys must be a non-empty array', 400);
  }
  if (groupKeys.length > 500) {
    throw new AppError('Maximum 500 group keys per request', 400);
  }
  for (const key of groupKeys) {
    if (typeof key !== 'string' || (!key.startsWith('bundle::') && !key.startsWith('standalone::'))) {
      throw new AppError(`Invalid group key: "${key}". Must start with "bundle::" or "standalone::"`, 400);
    }
  }

  const es = await getEsService();
  const result = await es.archiveByGroupKeys(groupKeys);
  res.json({ success: true, archived: result.archived, errors: result.errors });
}));

// POST /api/analytics/executions/archive-by-date - Archive executions before a date
router.post('/executions/archive-by-date', requirePermission('analytics:executions:archive'), asyncHandler(async (req, res) => {
  const { before } = req.body as { before?: string };

  if (!before || typeof before !== 'string') {
    throw new AppError('before must be a valid ISO date string', 400);
  }

  // Validate ISO date
  const date = new Date(before);
  if (isNaN(date.getTime())) {
    throw new AppError('before must be a valid ISO date string', 400);
  }

  const es = await getEsService();
  const result = await es.archiveByDateRange(before);
  res.json({ success: true, archived: result.archived, errors: result.errors });
}));

export default router;
