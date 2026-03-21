import { apiClient } from '@/hooks/useAuthenticatedApi';

export interface AnalyticsSettings {
  configured: boolean;
  connectionType?: 'cloud' | 'direct';
  indexPattern?: string;
  cloudId?: string;
  node?: string;
}

export interface DefenseScore {
  score: number;
  protectedCount: number;
  unprotectedCount: number;
  totalExecutions: number;
  realScore?: number;
  realProtectedCount?: number;
  realUnprotectedCount?: number;
  realTotalExecutions?: number;
  riskAcceptedCount?: number;
}

export interface TrendDataPoint {
  timestamp: string;
  score: number;
  total: number;
  protected: number;
  realScore?: number;
  realTotal?: number;
  realProtected?: number;
}

export interface TestBreakdown {
  testUuid: string;
  testName: string;
  protectedCount: number;
  unprotectedCount: number;
  score: number;
}

export interface TechniqueBreakdown {
  technique: string;
  protectedCount: number;
  unprotectedCount: number;
  score: number;
}

export interface BreakdownItem {
  name: string;
  score: number;
  count: number;
  protected: number;
}

export interface OrgBreakdownItem {
  org: string;
  orgName: string;
  score: number;
  count: number;
  protected: number;
}

export interface Execution {
  timestamp: string;
  testUuid: string;
  testName: string;
  hostname: string;
  outcome: string;
  error: number;
  organization?: string;
}

export interface TestExecution {
  test_uuid: string;
  test_name: string;
  hostname: string;
  is_protected: boolean;
  org: string;
  timestamp: string;
  error_code?: number;
  error_name?: string;
}

export interface ErrorTypeBreakdown {
  name: string;
  code: number;
  count: number;
}

export interface TestCoverageItem {
  name: string;
  protected: number;
  unprotected: number;
}

export interface TechniqueDistributionItem {
  technique: string;
  protected: number;
  unprotected: number;
}

export interface HostTestMatrixCell {
  hostname: string;
  testName: string;
  count: number;
}

export interface OrganizationInfo {
  uuid: string;
  shortName: string;
  fullName: string;
}

// ============================================
// New Types for Enhanced Analytics
// ============================================

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type CategoryType = 'intel-driven' | 'mitre-top10' | 'cyber-hygiene' | 'phase-aligned';

export interface EnrichedTestExecution extends TestExecution {
  category?: CategoryType;
  subcategory?: string;
  severity?: SeverityLevel;
  techniques?: string[];
  tactics?: string[];
  target?: string;
  complexity?: 'low' | 'medium' | 'high';
  threat_actor?: string;
  tags?: string[];
  score?: number;
  // Bundle control fields (present when is_bundle_control === true)
  bundle_id?: string;
  bundle_name?: string;
  control_id?: string;
  control_validator?: string;
  is_bundle_control?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface SeverityBreakdownItem {
  severity: SeverityLevel;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

export interface CategoryBreakdownItem {
  category: CategoryType;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

export interface SubcategoryBreakdownItem {
  subcategory: string;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

export interface CategorySubcategoryBreakdownItem {
  category: CategoryType;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
  subcategories: SubcategoryBreakdownItem[];
}

export interface ThreatActorCoverageItem {
  threatActor: string;
  coverage: number;
  testCount: number;
  protectedCount: number;
  totalExecutions: number;
}

export interface DefenseScoreByHostItem {
  hostname: string;
  score: number;
  protected: number;
  unprotected: number;
  total: number;
}

export interface CanonicalTestCount {
  count: number;
  tests: string[];
  days: number;
}

export interface ErrorRateResponse {
  errorRate: number;
  errorCount: number;
  conclusiveCount: number;
  totalTestActivity: number;
}

export interface ErrorRateTrendDataPoint {
  timestamp: string;
  errorRate: number;      // percentage 0-100
  errorCount: number;     // rolling window error count
  conclusiveCount: number; // rolling window conclusive count
  total: number;          // errorCount + conclusiveCount
}

export interface ExtendedFilterParams {
  org?: string;
  from?: string;
  to?: string;
  tests?: string;
  techniques?: string;
  hostnames?: string;
  categories?: string;
  severities?: string;
  threatActors?: string;
  tags?: string;
  errorNames?: string;
  errorCodes?: string;
  bundleNames?: string;
  result?: 'all' | 'protected' | 'unprotected' | 'inconclusive';
  scoringMode?: 'all-stages' | 'any-stage';
}

export interface PaginatedExecutionsParams extends ExtendedFilterParams {
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  grouped?: boolean;
}

// Grouped execution result (one per collapsed display row)
export interface ExecutionGroup {
  groupKey: string;
  type: 'bundle' | 'standalone';
  representative: EnrichedTestExecution;
  members: EnrichedTestExecution[];
  protectedCount: number;
  unprotectedCount: number;
  totalCount: number;
}

// Response shape for grouped/collapsed pagination
export interface GroupedPaginatedResponse {
  groups: ExecutionGroup[];
  pagination: {
    page: number;
    pageSize: number;
    totalGroups: number;
    totalDocuments: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface IndexInfo {
  name: string;
  docsCount: number;
  storeSize: number;
  status: string;
}

export interface ArchiveResult {
  success: boolean;
  archived: number;
  errors: string[];
}

// ============================================
// Risk Acceptance Types
// ============================================

export interface RiskAcceptance {
  acceptance_id: string;
  test_name: string;
  control_id?: string;
  hostname?: string;
  justification: string;
  accepted_by: string;
  accepted_by_name: string;
  accepted_at: string;
  status: 'active' | 'revoked';
  revoked_at?: string;
  revoked_by?: string;
  revoked_by_name?: string;
  revocation_reason?: string;
}

export interface AcceptRiskRequest {
  test_name: string;
  control_id?: string;
  hostname?: string;
  justification: string;
}

export const analyticsApi = {
  // Settings
  async getSettings(): Promise<AnalyticsSettings> {
    try {
      const response = await apiClient.get('/analytics/settings');
      return response.data;
    } catch (error) {
      // If settings endpoint fails, return unconfigured state
      return { configured: false };
    }
  },

  async saveSettings(settings: {
    connectionType: 'cloud' | 'direct';
    cloudId?: string;
    apiKey?: string;
    node?: string;
    username?: string;
    password?: string;
    indexPattern?: string;
  }): Promise<{ success: boolean }> {
    const response = await apiClient.post('/analytics/settings', settings);
    return response.data;
  },

  async testConnection(settings: {
    connectionType: 'cloud' | 'direct';
    cloudId?: string;
    apiKey?: string;
    node?: string;
    username?: string;
    password?: string;
  }): Promise<{ success: boolean; version?: string; error?: string }> {
    const response = await apiClient.post('/analytics/settings/test', settings);
    return response.data;
  },

  // Analytics endpoints
  async getDefenseScore(params?: {
    org?: string;
    from?: string;
    to?: string;
  }): Promise<DefenseScore> {
    const response = await apiClient.get('/analytics/defense-score', { params });
    return response.data;
  },

  async getDefenseScoreTrend(params?: {
    org?: string;
    from?: string;
    to?: string;
    interval?: 'hour' | 'day' | 'week';
    windowDays?: number;
  }): Promise<TrendDataPoint[]> {
    const response = await apiClient.get('/analytics/defense-score/trend', { params });
    return response.data;
  },

  async getDefenseScoreByTest(params?: {
    org?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<TestBreakdown[]> {
    const response = await apiClient.get('/analytics/defense-score/by-test', { params });
    return response.data;
  },

  async getDefenseScoreByTechnique(params?: {
    org?: string;
    from?: string;
    to?: string;
  }): Promise<TechniqueBreakdown[]> {
    const response = await apiClient.get('/analytics/defense-score/by-technique', { params });
    return response.data;
  },

  async getRecentExecutions(params?: {
    org?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<TestExecution[]> {
    const response = await apiClient.get('/analytics/executions', { params });
    return response.data;
  },

  async getOrganizations(): Promise<(string | OrganizationInfo)[]> {
    const response = await apiClient.get('/analytics/organizations');
    return response.data;
  },

  async getUniqueHostnames(params?: { org?: string }): Promise<number> {
    const response = await apiClient.get('/analytics/unique-hostnames', { params });
    return response.data.count;
  },

  async getUniqueTests(params?: { org?: string }): Promise<number> {
    const response = await apiClient.get('/analytics/unique-tests', { params });
    return response.data.count;
  },

  // New endpoints for advanced visualizations
  async getResultsByErrorType(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<ErrorTypeBreakdown[]> {
    const response = await apiClient.get('/analytics/results-by-error-type', { params });
    return response.data;
  },

  async getTestCoverage(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<TestCoverageItem[]> {
    const response = await apiClient.get('/analytics/test-coverage', { params });
    return response.data;
  },

  async getTechniqueDistribution(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<TechniqueDistributionItem[]> {
    const response = await apiClient.get('/analytics/technique-distribution', { params });
    return response.data;
  },

  async getHostTestMatrix(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<HostTestMatrixCell[]> {
    const response = await apiClient.get('/analytics/host-test-matrix', { params });
    return response.data;
  },

  async getAvailableTests(): Promise<string[]> {
    const response = await apiClient.get('/analytics/available-tests');
    return response.data;
  },

  async getAvailableTechniques(): Promise<string[]> {
    const response = await apiClient.get('/analytics/available-techniques');
    return response.data;
  },

  async getExecutedTestUuids(): Promise<string[]> {
    const response = await apiClient.get('/analytics/executed-test-uuids');
    return response.data.uuids;
  },

  // ============================================
  // New Endpoints for Enhanced Analytics
  // ============================================

  async getPaginatedExecutions(params: PaginatedExecutionsParams): Promise<PaginatedResponse<EnrichedTestExecution>> {
    const response = await apiClient.get('/analytics/executions/paginated', { params });
    return response.data;
  },

  async getGroupedPaginatedExecutions(params: PaginatedExecutionsParams): Promise<GroupedPaginatedResponse> {
    const response = await apiClient.get('/analytics/executions/paginated', {
      params: { ...params, grouped: true },
    });
    return response.data;
  },

  async getAvailableHostnames(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-hostnames', { params });
    return response.data;
  },

  async getAvailableCategories(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-categories', { params });
    return response.data;
  },

  async getAvailableSeverities(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-severities', { params });
    return response.data;
  },

  async getAvailableThreatActors(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-threat-actors', { params });
    return response.data;
  },

  async getAvailableTags(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-tags', { params });
    return response.data;
  },

  async getAvailableErrorNames(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-error-names', { params });
    return response.data;
  },

  async getAvailableErrorCodes(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-error-codes', { params });
    return response.data;
  },

  async getAvailableBundleNames(params?: { org?: string; from?: string; to?: string }): Promise<FilterOption[]> {
    const response = await apiClient.get('/analytics/available-bundle-names', { params });
    return response.data;
  },

  async getDefenseScoreBySeverity(params?: { org?: string; from?: string; to?: string }): Promise<SeverityBreakdownItem[]> {
    const response = await apiClient.get('/analytics/defense-score/by-severity', { params });
    return response.data;
  },

  async getDefenseScoreByCategory(params?: { org?: string; from?: string; to?: string }): Promise<CategoryBreakdownItem[]> {
    const response = await apiClient.get('/analytics/defense-score/by-category', { params });
    return response.data;
  },

  async getDefenseScoreByCategorySubcategory(params?: { org?: string; from?: string; to?: string }): Promise<CategorySubcategoryBreakdownItem[]> {
    const response = await apiClient.get('/analytics/defense-score/by-category-subcategory', { params });
    return response.data;
  },

  async getThreatActorCoverage(params?: { org?: string; from?: string; to?: string }): Promise<ThreatActorCoverageItem[]> {
    const response = await apiClient.get('/analytics/threat-actor-coverage', { params });
    return response.data;
  },

  async getDefenseScoreByHostname(params?: { org?: string; from?: string; to?: string; limit?: number }): Promise<DefenseScoreByHostItem[]> {
    const response = await apiClient.get('/analytics/defense-score/by-hostname', { params });
    return response.data;
  },

  async getCanonicalTestCount(params?: { org?: string; days?: number }): Promise<CanonicalTestCount> {
    const response = await apiClient.get('/analytics/canonical-test-count', { params });
    return response.data;
  },

  async getErrorRate(params?: { org?: string; from?: string; to?: string }): Promise<ErrorRateResponse> {
    const response = await apiClient.get('/analytics/error-rate', { params });
    return response.data;
  },

  async getErrorRateTrend(params?: {
    org?: string;
    from?: string;
    to?: string;
    interval?: 'hour' | 'day' | 'week';
    windowDays?: number;
  }): Promise<ErrorRateTrendDataPoint[]> {
    const response = await apiClient.get('/analytics/error-rate/trend', { params });
    return response.data;
  },

  // Index management
  async listIndices(pattern?: string): Promise<IndexInfo[]> {
    const response = await apiClient.get('/analytics/indices', {
      params: pattern ? { pattern } : undefined,
    });
    return response.data.indices;
  },

  async createIndex(indexName: string): Promise<{ created: boolean; message: string }> {
    const response = await apiClient.post('/analytics/index/create', { index_name: indexName });
    return response.data;
  },

  // Archive operations
  async archiveExecutions(groupKeys: string[]): Promise<ArchiveResult> {
    const response = await apiClient.post('/analytics/executions/archive', { groupKeys });
    return response.data;
  },

  async archiveExecutionsByDate(before: string): Promise<ArchiveResult> {
    const response = await apiClient.post('/analytics/executions/archive-by-date', { before });
    return response.data;
  },

  // Risk acceptance operations
  async acceptRisk(request: AcceptRiskRequest): Promise<RiskAcceptance> {
    const response = await apiClient.post('/risk-acceptances', request);
    return response.data.data;
  },

  async revokeRisk(id: string, reason: string): Promise<RiskAcceptance> {
    const response = await apiClient.post(`/risk-acceptances/${id}/revoke`, { reason });
    return response.data.data;
  },

  async listAcceptances(filters?: {
    status?: 'active' | 'revoked';
    test_name?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: RiskAcceptance[]; total: number }> {
    const response = await apiClient.get('/risk-acceptances', { params: filters });
    return { data: response.data.data, total: response.data.total };
  },

  async lookupAcceptances(testNames: string[]): Promise<Record<string, RiskAcceptance[]>> {
    const response = await apiClient.post('/risk-acceptances/lookup', { test_names: testNames });
    return response.data.data;
  },
};
