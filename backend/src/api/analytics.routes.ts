import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { SettingsService } from '../services/analytics/settings.js';
import { ElasticsearchService } from '../services/analytics/elasticsearch.js';
import type { AnalyticsQueryParams } from '../types/analytics.js';

const router = Router();

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
router.get('/settings', (_req, res) => {
  const settings = settingsService.getSettings();

  // Mask node URL to hide credentials
  let maskedNode: string | undefined;
  if (settings.node) {
    try {
      const url = new URL(settings.node);
      maskedNode = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
    } catch {
      // If URL parsing fails, mask the whole thing
      maskedNode = '***';
    }
  }

  res.json({
    configured: settings.configured,
    connectionType: settings.connectionType,
    indexPattern: settings.indexPattern,
    // Mask sensitive fields
    cloudId: settings.cloudId ? '***' : undefined,
    node: maskedNode,
  });
});

// POST /api/analytics/settings - Save settings
router.post('/settings', asyncHandler(async (req, res) => {
  const { connectionType, cloudId, apiKey, node, username, password, indexPattern } = req.body;

  if (!connectionType) {
    throw new AppError('Connection type is required', 400);
  }

  // Validate connectionType
  if (connectionType !== 'cloud' && connectionType !== 'direct') {
    throw new AppError('Connection type must be "cloud" or "direct"', 400);
  }

  // Validate index pattern format (alphanumeric, hyphens, underscores, asterisks, dots)
  if (indexPattern && !/^[\w\-\*\.]+$/.test(indexPattern)) {
    throw new AppError('Invalid index pattern format', 400);
  }

  // Validate node URL if provided
  if (node !== undefined && node !== null && node !== '') {
    if (typeof node !== 'string') {
      throw new AppError('Node URL must be a string', 400);
    }
    if (!node.startsWith('http://') && !node.startsWith('https://')) {
      throw new AppError('Node URL must start with http:// or https://', 400);
    }
    // Validate URL format
    try {
      new URL(node);
    } catch {
      throw new AppError('Invalid node URL format', 400);
    }
  }

  // Validate credential field lengths
  if (cloudId && cloudId.length > 500) {
    throw new AppError('Cloud ID too long', 400);
  }
  if (apiKey && apiKey.length > 1000) {
    throw new AppError('API key too long', 400);
  }
  if (username && username.length > 255) {
    throw new AppError('Username too long', 400);
  }
  if (password && password.length > 255) {
    throw new AppError('Password too long', 400);
  }

  // Load existing settings to merge with new values
  // This allows updating settings without providing all credentials
  const existingSettings = settingsService.getSettings();

  // Merge: use new values if provided (including explicit empty strings), otherwise keep existing ones
  // Use !== undefined to distinguish between intentionally clearing a value and not providing it
  const settingsToSave = {
    connectionType,
    cloudId: cloudId !== undefined ? cloudId : existingSettings.cloudId,
    apiKey: apiKey !== undefined ? apiKey : existingSettings.apiKey,
    node: node !== undefined ? node : existingSettings.node,
    username: username !== undefined ? username : existingSettings.username,
    password: password !== undefined ? password : existingSettings.password,
    indexPattern: indexPattern !== undefined ? indexPattern : (existingSettings.indexPattern || 'f0rtika-results-*'),
    configured: true,
  };

  settingsService.saveSettings(settingsToSave);

  // Reset ES service to use new settings
  esService = null;

  res.json({ success: true });
}));

// POST /api/analytics/settings/test - Test connection
router.post('/settings/test', asyncHandler(async (req, res) => {
  const { connectionType, cloudId, apiKey, node, username, password } = req.body;

  try {
    const testService = new ElasticsearchService({
      connectionType,
      cloudId,
      apiKey,
      node,
      username,
      password,
      indexPattern: 'f0rtika-results-*',
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
router.get('/defense-score/trend', asyncHandler(async (req, res) => {
  const es = await getEsService();
  const { org, from, to, interval } = req.query;

  const result = await es.getDefenseScoreTrend({
    org: org as string,
    from: from as string,
    to: to as string,
    interval: (interval as string) || 'day',
  });

  res.json(result);
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

export default router;
