import { apiClient } from '@/hooks/useAuthenticatedApi';

export interface AnalyticsSettings {
  configured: boolean;
  connectionType?: 'cloud' | 'direct';
  indexPattern?: string;
  cloudId?: string;
  node?: string;
  /** '***' placeholder when a CA cert is saved; undefined otherwise. Real PEM is never echoed. */
  caCert?: string;
  tlsInsecureSkipVerify?: boolean;
  writeIndexPrefix?: string;
  writeIndexRollover?: 'none' | 'daily' | 'monthly';
}

export interface DefenseScore {
  /** null when no scored data exists (basis=latest with no pairs). */
  score: number | null;
  basis?: 'latest' | 'executions';
  /** Distinct test x endpoint pairs behind the score (basis=latest). */
  pairCount?: number;
  protectedCount: number;
  /** Documents where defender_detected:true AND is_protected:false. Populated by the dual-query introduced in Wave 5. */
  detectedCount?: number;
  unprotectedCount: number;
  totalExecutions: number;
  /** EDR-only (strict) score; null when there is nothing to score (basis=latest with no pairs). */
  realScore?: number | null;
  realProtectedCount?: number;
  realUnprotectedCount?: number;
  realTotalExecutions?: number;
  /** Combined score against the unfiltered (pre-risk-acceptance) base. Equals `score` when riskAcceptedCount === 0; null when there is nothing to score. */
  rawScore?: number | null;
  riskAcceptedCount?: number;
}

export interface TrendDataPoint {
  timestamp: string;
  score: number | null;
  total: number;
  protected: number;
  /** Pre-risk-acceptance "Actual" score; present only when exclusions are active. */
  realScore?: number | null;
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
  /** What the stage does (from bundle_results.json); absent on older documents. */
  control_description?: string;
  is_bundle_control?: boolean;
  // Populated by the Defender enrichment pass when an alert in
  // achilles-defender correlates to this doc via bundle UUID + hostname +
  // time window. Permanent (only flipped false→true). BUNDLE-LEVEL signal:
  // propagates across every stage of a bundle whenever any one stage's
  // binary appears in evidence. For per-stage truth use defender_stage_detected.
  defender_detected?: boolean;
  /**
   * True when an alert's evidence contains THIS stage's specific binary
   * (`<uuid>-<control_id>[-<variant>].exe`). Strictly per-stage. Drives
   * the per-stage "Detected" badge. May be undefined on old docs that
   * predate the stage-specific enrichment write — UI falls back to the
   * bundle flag in that case.
   */
  defender_stage_detected?: boolean;
  // Populated by the CrowdStrike enrichment pass when an alert in
  // achilles-crowdstrike correlates to this doc via bundle UUID + hostname +
  // time window. Same semantics as the defender_* flags above: the
  // bundle-level flag propagates across stages; the stage flag is strictly
  // per-stage.
  crowdstrike_detected?: boolean;
  crowdstrike_stage_detected?: boolean;
  /**
   * Set by the CrowdStrike enrichment pass when a correlated alert carried
   * vendor-confirmed prevention evidence (pattern_disposition_details:
   * quarantine / process killed / blocked). Subset of crowdstrike_detected —
   * drives the stronger "Prevented" result label.
   */
  crowdstrike_prevented?: boolean;
  /** Derived prevention action: 'quarantined' | 'process_killed' | 'blocked'. */
  crowdstrike_prevention_action?: string;
  /**
   * Set by the Defender enrichment pass when a correlated alert carried
   * vendor-confirmed prevention evidence (evidence remediationStatus:
   * prevented / blocked / remediated). Subset of defender_detected — drives
   * the same "Prevented" result label.
   */
  defender_prevented?: boolean;
  /** Derived prevention action (normalized, same vocabulary as CrowdStrike). */
  defender_prevention_action?: string;
  /** SentinelOne equivalents of the crowdstrike_* flags (SentinelOne enrichment pass, same rules). */
  sentinelone_detected?: boolean;
  sentinelone_stage_detected?: boolean;
  sentinelone_prevented?: boolean;
  sentinelone_prevention_action?: string;
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

export interface ThreatActorCoverageItem {
  threatActor: string;
  coverage: number;
  testCount: number;
  protectedCount: number;
  totalExecutions: number;
  /** basis=latest only: test x endpoint pairs. */
  pairCount?: number;
  /** basis=latest only: ISO time of the actor's most recent pair result. */
  lastTestedAt?: string;
}

/** Fleet result of one test (or bundle) over the last 90 days, latest pair per host. */
export interface TestResultItem {
  testUuid: string;
  pairCount: number;
  protectedCount: number;
  hostCount: number;
  lastRunAt: string;
}

/** Per-technique latest-result outcomes (per-stage test x endpoint pairs). */
export interface TechniqueOutcomeItem {
  technique: string;
  protected: number;
  detected: number;
  unprotected: number;
  lastTestedAt: string;
}

/** One "blocked at stage N" row of the chain-depth card; stage 4 = "4+". */
export interface ChainDepthBucket {
  stage: 1 | 2 | 3 | 4;
  blocked: number;
  alertedNotBlocked: number;
  bundleNames: string[];
}

/** How deep attack chains get: latest run per (org, bundle, host), non-cyber-hygiene bundles. */
export interface ChainDepthResponse {
  chains: number;
  buckets: ChainDepthBucket[];
  endToEnd: number;
  endToEndAlerted: number;
  endToEndBundleNames: string[];
  /** End-to-end chains where an EDR alerted; a bundle can also be in the undetected list. */
  endToEndAlertedBundleNames: string[];
  /** End-to-end chains with no alert. */
  endToEndUndetectedBundleNames: string[];
  /** Latest run had an errored / pre-execution-blocked stage: in no row. */
  inconclusive: number;
  /** Of inconclusive: latest run had a stage blocked before it ran (260); technique not evaluated. Absent on older backends. */
  blockedBeforeRun?: number;
  blockedBeforeRunBundleNames?: string[];
  /** Of inconclusive: latest run had a stage error (e.g. 999). Absent on older backends. */
  stageErrors?: number;
}

export interface ExecutionActivityDay {
  date: string;
  protected: number;
  unprotected: number;
  inconclusive: number;
}

export interface ExecutionActivityResponse {
  days: ExecutionActivityDay[];
  lastExecutionAt: string | null;
  executions7d: number;
  protectedPct7d: number | null;
  endpointsTested7d: number;
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
  errorRate: number | null; // percentage 0-100; null = no data
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
  defenderDetected?: boolean;
  crowdstrikeDetected?: boolean;
  crowdstrikePrevented?: boolean;
  defenderPrevented?: boolean;
  sentineloneDetected?: boolean;
  sentinelonePrevented?: boolean;
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

export type RiskScope = 'host' | 'global';

export interface RiskAcceptance {
  acceptance_id: string;
  test_name: string;
  control_id?: string;
  hostname?: string;
  scope?: RiskScope;
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
  scope?: RiskScope;
  justification: string;
}

export const analyticsApi = {
  // Settings
  async getSettings(): Promise<AnalyticsSettings> {
    const response = await apiClient.get('/analytics/settings');
    return response.data;
  },

  async saveSettings(settings: {
    connectionType: 'cloud' | 'direct';
    cloudId?: string;
    apiKey?: string;
    node?: string;
    username?: string;
    password?: string;
    indexPattern?: string;
    caCert?: string;
    tlsInsecureSkipVerify?: boolean;
    writeIndexPrefix?: string;
    writeIndexRollover?: 'none' | 'daily' | 'monthly';
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
    caCert?: string;
    tlsInsecureSkipVerify?: boolean;
  }): Promise<{ success: boolean; version?: string; error?: string }> {
    const response = await apiClient.post('/analytics/settings/test', settings);
    return response.data;
  },

  // Analytics endpoints
  async getDefenseScore(params?: {
    org?: string;
    from?: string;
    to?: string;
    scoringMode?: 'all-stages' | 'any-stage';
    basis?: 'latest' | 'executions';
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
    scoringMode?: 'all-stages' | 'any-stage';
    /** Attack-simulation-only scoping — drops cyber-hygiene + skipped stages. */
    excludeCyberHygiene?: boolean;
    basis?: 'latest' | 'executions';
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
    basis?: 'latest' | 'executions';
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
    basis?: 'latest' | 'executions';
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

  async getThreatActorCoverage(params?: {
    org?: string;
    from?: string;
    to?: string;
    scoringMode?: 'all-stages' | 'any-stage';
    basis?: 'latest' | 'executions';
  }): Promise<ThreatActorCoverageItem[]> {
    const response = await apiClient.get('/analytics/threat-actor-coverage', { params });
    return response.data;
  },

  /** Per-test fleet results (last 90 days, latest pair per host) for the test library. */
  async getTestResults(params?: ExtendedFilterParams): Promise<TestResultItem[]> {
    const response = await apiClient.get('/analytics/test-results', { params });
    return response.data;
  },

  async getTechniqueOutcomes(params?: { org?: string; from?: string; to?: string }): Promise<TechniqueOutcomeItem[]> {
    const response = await apiClient.get('/analytics/technique-outcomes', { params });
    return response.data;
  },

  /** Always latest-result posture; takes every filter-bar param. */
  async getChainDepth(params?: ExtendedFilterParams & { basis?: 'latest' | 'executions' }): Promise<ChainDepthResponse> {
    const response = await apiClient.get('/analytics/chain-depth', { params });
    return response.data;
  },

  async getExecutionActivity(params?: { org?: string; days?: number }): Promise<ExecutionActivityResponse> {
    const response = await apiClient.get('/analytics/execution-activity', { params });
    return response.data;
  },

  async getDefenseScoreByHostname(params?: {
    org?: string;
    from?: string;
    to?: string;
    limit?: number;
    scoringMode?: 'all-stages' | 'any-stage';
    basis?: 'latest' | 'executions';
  }): Promise<DefenseScoreByHostItem[]> {
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
