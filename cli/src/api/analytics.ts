import { client } from './client.js';
import type {
  DefenseScore,
  ScoreTrendPoint,
  ScoreByTest,
  ScoreByTechnique,
  ScoreByHostname,
  PaginatedExecutions,
  ErrorRate,
  AnalyticsSettings,
  FilterOption,
} from './types.js';

/** Common filter params used by most analytics endpoints */
export interface AnalyticsFilterParams {
  org?: string;
  from?: string;
  to?: string;
  tests?: string;
  techniques?: string;
  hostnames?: string;
  categories?: string;
  severities?: string;
  tags?: string;
  threat_actors?: string;
  error_names?: string;
  error_codes?: string;
  bundle_names?: string;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AnalyticsSettings> {
  return client.get('/api/analytics/settings');
}

export async function saveSettings(settings: {
  connectionType: string;
  cloudId?: string;
  apiKey?: string;
  node?: string;
  username?: string;
  password?: string;
  indexPattern?: string;
}): Promise<void> {
  await client.post('/api/analytics/settings', { body: settings });
}

export async function testConnection(settings: Record<string, unknown>): Promise<{ success: boolean; version?: string }> {
  return client.post('/api/analytics/settings/test', { body: settings });
}

// ─── Defense Score ──────────────────────────────────────────────────────────

export async function getDefenseScore(params: AnalyticsFilterParams = {}): Promise<DefenseScore> {
  return client.get('/api/analytics/defense-score', { params: params as Record<string, string> });
}

export async function getScoreTrend(params: AnalyticsFilterParams & {
  interval?: string;
  windowDays?: number;
} = {}): Promise<ScoreTrendPoint[]> {
  return client.get('/api/analytics/defense-score/trend', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getScoreByTest(params: AnalyticsFilterParams & { limit?: number } = {}): Promise<ScoreByTest[]> {
  return client.get('/api/analytics/defense-score/by-test', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getScoreByTechnique(params: AnalyticsFilterParams = {}): Promise<ScoreByTechnique[]> {
  return client.get('/api/analytics/defense-score/by-technique', { params: params as Record<string, string> });
}

export async function getScoreByHostname(params: AnalyticsFilterParams & { limit?: number } = {}): Promise<ScoreByHostname[]> {
  return client.get('/api/analytics/defense-score/by-hostname', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getScoreBySeverity(params: AnalyticsFilterParams = {}): Promise<Array<{ severity: string; score: number; count: number; protected: number; unprotected: number }>> {
  return client.get('/api/analytics/defense-score/by-severity', { params: params as Record<string, string> });
}

export async function getScoreByCategory(params: AnalyticsFilterParams = {}): Promise<Array<{ category: string; score: number; count: number; protected: number; unprotected: number }>> {
  return client.get('/api/analytics/defense-score/by-category', { params: params as Record<string, string> });
}

export async function getScoreByCategorySubcategory(params: AnalyticsFilterParams = {}): Promise<Array<{ category: string; score: number; subcategories: Array<{ subcategory: string; score: number }> }>> {
  return client.get('/api/analytics/defense-score/by-category-subcategory', { params: params as Record<string, string> });
}

export async function getScoreByOrg(params: { from?: string; to?: string } = {}): Promise<Array<{ org: string; score: number; count: number; protected: number }>> {
  return client.get('/api/analytics/defense-score/by-org', { params });
}

// ─── Executions ─────────────────────────────────────────────────────────────

export async function getExecutions(params: AnalyticsFilterParams & { limit?: number } = {}): Promise<Array<{ timestamp: string; testUuid: string; testName: string; hostname: string; outcome: string; error?: string }>> {
  return client.get('/api/analytics/executions', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getExecutionsPaginated(params: AnalyticsFilterParams & {
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: string;
  grouped?: boolean;
} = {}): Promise<PaginatedExecutions> {
  return client.get('/api/analytics/executions/paginated', { params: params as Record<string, string | number | boolean | undefined> });
}

// ─── Error Rate ─────────────────────────────────────────────────────────────

export async function getErrorRate(params: AnalyticsFilterParams = {}): Promise<ErrorRate> {
  return client.get('/api/analytics/error-rate', { params: params as Record<string, string> });
}

export async function getErrorRateTrend(params: AnalyticsFilterParams & {
  interval?: string;
  windowDays?: number;
} = {}): Promise<Array<{ timestamp: string; errorRate: number; errorCount: number; conclusiveCount: number }>> {
  return client.get('/api/analytics/error-rate/trend', { params: params as Record<string, string | number | boolean | undefined> });
}

// ─── Coverage ───────────────────────────────────────────────────────────────

export async function getTestCoverage(params: AnalyticsFilterParams = {}): Promise<Array<{ name: string; protected: number; unprotected: number }>> {
  return client.get('/api/analytics/test-coverage', { params: params as Record<string, string> });
}

export async function getTechniqueDistribution(params: AnalyticsFilterParams = {}): Promise<Array<{ technique: string; protected: number; unprotected: number }>> {
  return client.get('/api/analytics/technique-distribution', { params: params as Record<string, string> });
}

export async function getHostTestMatrix(params: AnalyticsFilterParams = {}): Promise<Array<{ hostname: string; testName: string; count: number }>> {
  return client.get('/api/analytics/host-test-matrix', { params: params as Record<string, string> });
}

export async function getThreatActorCoverage(params: AnalyticsFilterParams = {}): Promise<Array<{ threatActor: string; coverage: number; testCount: number; protectedCount: number; totalExecutions: number }>> {
  return client.get('/api/analytics/threat-actor-coverage', { params: params as Record<string, string> });
}

// ─── Counts ─────────────────────────────────────────────────────────────────

export async function getUniqueHostnames(org?: string): Promise<{ count: number }> {
  return client.get('/api/analytics/unique-hostnames', { params: { org } });
}

export async function getUniqueTests(org?: string): Promise<{ count: number }> {
  return client.get('/api/analytics/unique-tests', { params: { org } });
}

export async function getCanonicalTestCount(params: { org?: string; days?: number } = {}): Promise<{ count: number; tests: string[]; days: number }> {
  return client.get('/api/analytics/canonical-test-count', { params: params as Record<string, string | number | boolean | undefined> });
}

// ─── Available Filters ──────────────────────────────────────────────────────

export async function getAvailableTests(): Promise<string[]> {
  return client.get('/api/analytics/available-tests');
}

export async function getAvailableHostnames(params: AnalyticsFilterParams = {}): Promise<FilterOption[]> {
  return client.get('/api/analytics/available-hostnames', { params: params as Record<string, string> });
}

export async function getAvailableTechniques(): Promise<string[]> {
  return client.get('/api/analytics/available-techniques');
}

export async function getAvailableCategories(params: AnalyticsFilterParams = {}): Promise<FilterOption[]> {
  return client.get('/api/analytics/available-categories', { params: params as Record<string, string> });
}

export async function getAvailableSeverities(params: AnalyticsFilterParams = {}): Promise<FilterOption[]> {
  return client.get('/api/analytics/available-severities', { params: params as Record<string, string> });
}
