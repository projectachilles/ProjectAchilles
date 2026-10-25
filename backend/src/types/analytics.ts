// Analytics module types

// Elasticsearch settings stored in config file
export interface AnalyticsSettings {
  connectionType: 'cloud' | 'direct';
  cloudId?: string;
  node?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  indexPattern: string;
  /** Write-side base name; date suffix appended per rollover mode. Default 'achilles-results-'. */
  writeIndexPrefix?: string;
  /** Write-index rollover granularity. Default 'none' (single static write index). */
  writeIndexRollover?: 'none' | 'daily' | 'monthly';
  configured: boolean;
  /** PEM-encoded custom CA for trusting self-signed Elasticsearch certs (direct connections only). */
  caCert?: string;
  /** Disable TLS certificate validation. Insecure — local/lab use only. */
  tlsInsecureSkipVerify?: boolean;
}

// Defense score response
export interface DefenseScoreResponse {
  /** Combined score: (protected + detected) / total × 100. null = nothing to score (basis=latest with no pairs). */
  score: number | null;
  /** Documents where is_protected:true. */
  protectedCount: number;
  /** Documents where defender_detected:true AND is_protected:false. Mutually exclusive with protectedCount. */
  detectedCount: number;
  /** Documents where neither is_protected nor defender_detected. Mutually exclusive with the above. */
  unprotectedCount: number;
  totalExecutions: number;
  /** EDR-only (strict) score: protected / total × 100, computed on the same exclusion-filtered base as `score`. */
  realScore?: number | null;
  realProtectedCount?: number;
  realUnprotectedCount?: number;
  realTotalExecutions?: number;
  /** Combined score computed against the unfiltered (pre-risk-acceptance) base — i.e. what `score` would be if no acceptances were active. Equals `score` when `riskAcceptedCount === 0`. */
  rawScore?: number | null;
  riskAcceptedCount?: number;
  /** Which definition produced the numbers. Absent on legacy (executions) responses. */
  basis?: 'latest' | 'executions';
  /** basis=latest: number of test × endpoint pairs scored (also in totalExecutions). */
  pairCount?: number;
}

// Trend data point
export interface TrendDataPoint {
  timestamp: string;
  /** null = no data in the window (render as a gap, never as 0) */
  score: number | null;
  total: number;
  protected: number;
  realScore?: number | null;
  realTotal?: number;
  realProtected?: number;
}

// Breakdown item (for by-test, by-technique)
export interface BreakdownItem {
  name: string;
  score: number;
  count: number;
  protected: number;
}

// Test execution record
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

// Organization info
export interface OrganizationInfo {
  uuid: string;
  shortName: string;
  fullName: string;
}

// Query parameters for analytics endpoints
export interface AnalyticsQueryParams {
  org?: string;
  from?: string;
  to?: string;
  interval?: string;
  limit?: number;
  tests?: string;      // comma-separated test names/UUIDs
  techniques?: string; // comma-separated technique IDs
  windowDays?: number; // Rolling window size in days for trend aggregation
}

// Organization breakdown
export interface OrgBreakdownItem {
  org: string;
  orgName: string;
  score: number;
  count: number;
  protected: number;
}

// Error type breakdown (for donut chart)
export interface ErrorTypeBreakdown {
  name: string;
  code: number;
  count: number;
}

// Test coverage item (protected vs unprotected counts)
export interface TestCoverageItem {
  name: string;
  protected: number;
  unprotected: number;
}

// Technique distribution item (protected vs unprotected counts)
export interface TechniqueDistributionItem {
  technique: string;
  protected: number;
  unprotected: number;
}

// Host-test matrix cell (for heatmap)
export interface HostTestMatrixCell {
  hostname: string;
  testName: string;
  count: number;
}

// ============================================
// Enriched Types (for new fields)
// ============================================

// Severity levels
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

// Category types
export type CategoryType = 'intel-driven' | 'mitre-top10' | 'cyber-hygiene' | 'phase-aligned';

// Enriched test execution with new fields
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
  /** Set true by the enrichment pass when a Defender alert matches this doc's bundle UUID, hostname, and time window. */
  defender_detected?: boolean;
  /**
   * Set true by the enrichment pass when an alert's evidence contains
   * THIS stage's specific binary (`<uuid>-<control_id>[-<variant>].exe`).
   * Strictly per-stage; does not propagate across a bundle's stages.
   */
  defender_stage_detected?: boolean;
  /** Set true when a matched Defender alert carried a prevention-ish remediationStatus (vendor-confirmed prevention; subset of defender_detected). */
  defender_prevented?: boolean;
  /** The matched alert's derived prevention action (process_killed / blocked / quarantined). */
  defender_prevention_action?: string;
  /** Set true by the CrowdStrike enrichment pass when a Falcon alert matches this doc's bundle UUID, hostname, and time window. */
  crowdstrike_detected?: boolean;
  /** CrowdStrike per-stage equivalent of defender_stage_detected. */
  crowdstrike_stage_detected?: boolean;
  /** Set true when a matched CrowdStrike alert carried a prevention disposition (vendor-confirmed prevention; subset of crowdstrike_detected). */
  crowdstrike_prevented?: boolean;
  /** The matched alert's derived prevention action (quarantined / process_killed / blocked). */
  crowdstrike_prevention_action?: string;
  /** SentinelOne equivalents of the crowdstrike_* flags, written by the SentinelOne enrichment pass. */
  sentinelone_detected?: boolean;
  sentinelone_stage_detected?: boolean;
  sentinelone_prevented?: boolean;
  sentinelone_prevention_action?: string;
}

// Pagination support
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
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

// Extended query params with new filters
export interface ExtendedAnalyticsQueryParams extends AnalyticsQueryParams {
  hostnames?: string;      // comma-separated hostnames
  categories?: string;     // comma-separated categories
  severities?: string;     // comma-separated severity levels
  threatActors?: string;   // comma-separated threat actor names
  tags?: string;           // comma-separated tags
  errorNames?: string;     // comma-separated error names
  errorCodes?: string;     // comma-separated numeric error codes
  bundleNames?: string;    // comma-separated bundle names
  result?: 'all' | 'protected' | 'unprotected' | 'inconclusive';
  scoringMode?: 'all-stages' | 'any-stage'; // multi-stage bundle scoring strategy
  /**
   * Restrict the query to genuine attack simulations — drop cyber-hygiene
   * controls and skipped bundle stages. Used by the Defender tab's
   * test-volume trend so it matches the detection-rate scoping. The
   * Dashboard's Defense Score leaves it off.
   */
  excludeCyberHygiene?: boolean;
  /**
   * Score definition. 'executions' (default) = every conclusive execution in
   * the range; 'latest' = latest conclusive result per test × endpoint pair.
   */
  basis?: 'latest' | 'executions';
}

// Combined query params for paginated executions
export interface PaginatedExecutionsParams extends ExtendedAnalyticsQueryParams, PaginationParams {
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
  /** True when a correlated Defender alert exists for this group's binary + hostname. */
  defenderDetected?: boolean;
  /** True when a matched Defender alert carried a prevention-ish remediationStatus for any member of this group. */
  defenderPrevented?: boolean;
  /** True when a correlated CrowdStrike alert exists for this group's binary + hostname. */
  crowdstrikeDetected?: boolean;
  /** True when a matched CrowdStrike alert carried a prevention disposition for any member of this group. */
  crowdstrikePrevented?: boolean;
  /** True when a correlated SentinelOne alert exists for this group's binary + hostname. */
  sentineloneDetected?: boolean;
  /** True when a matched SentinelOne alert carried a prevention action for any member of this group. */
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

// Filter option with count
export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

// Severity breakdown item
export interface SeverityBreakdownItem {
  severity: SeverityLevel;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

// Category breakdown item
export interface CategoryBreakdownItem {
  category: CategoryType;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

// Subcategory breakdown item (within a category)
export interface SubcategoryBreakdownItem {
  subcategory: string;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

// Category with nested subcategories
export interface CategorySubcategoryBreakdownItem {
  category: CategoryType;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
  subcategories: SubcategoryBreakdownItem[];
}

// Threat actor coverage item
export interface ThreatActorCoverageItem {
  threatActor: string;
  coverage: number;
  testCount: number;
  protectedCount: number;
  totalExecutions: number;
  /** basis=latest only: test x endpoint pairs (equals totalExecutions there). */
  pairCount?: number;
  /** basis=latest only: ISO time of the actor's most recent pair result. */
  lastTestedAt?: string;
}

// Fleet result of one test (or bundle) over the last 90 days, latest pair per host
export interface TestResultItem {
  testUuid: string; // test UUID, or bundle UUID for bundles / cyber-hygiene controls
  pairCount: number;
  protectedCount: number; // combined rule (blocked or detected)
  hostCount: number;
  lastRunAt: string; // ISO time of the newest pair
}

// Per-technique latest-result outcomes (per-stage test x endpoint pairs)
export interface TechniqueOutcomeItem {
  technique: string;
  protected: number; // strict: is_protected (blocked)
  detected: number; // combined-only: Defender/CrowdStrike detected, not blocked
  unprotected: number; // got through
  lastTestedAt: string; // ISO time of the technique's most recent pair result
}

// How deep attack chains get (basis=latest, any-stage bundle pairs). One
// chain = the latest run of a non-cyber-hygiene bundle on a host.
export interface ChainDepthBucket {
  stage: 1 | 2 | 3 | 4;          // stage the chain was blocked at; 4 = "4+"
  blocked: number;               // chains blocked at this stage
  alertedNotBlocked: number;     // of those, an earlier stage was detected but not blocked
  bundleNames: string[];         // distinct bundle names in this bucket, sorted
}

export interface ChainDepthResponse {
  chains: number;                // chains counted (blocked + end to end)
  buckets: ChainDepthBucket[];   // always stages 1, 2, 3, 4 in order
  endToEnd: number;              // chains no stage blocked
  endToEndAlerted: number;       // of those, some stage was detected
  endToEndBundleNames: string[];
  endToEndAlertedBundleNames: string[];    // end-to-end chains where an EDR alerted
  endToEndUndetectedBundleNames: string[]; // end-to-end chains with no alert (a bundle can be in both)
  inconclusive: number;          // chains whose latest run had an errored / pre-execution-blocked stage; in no bucket
  /** Of those, chains whose latest run had a stage blocked before it ran (260): the technique was not evaluated. */
  blockedBeforeRun: number;
  blockedBeforeRunBundleNames: string[];
  /** Of those, chains whose latest run had a stage error (e.g. 999). inconclusive = blockedBeforeRun + stageErrors. */
  stageErrors: number;
}

// Defense score by hostname item
export interface DefenseScoreByHostItem {
  hostname: string;
  score: number;
  protected: number;
  unprotected: number;
  total: number;
}

// Error rate response
export interface ErrorRateResponse {
  errorRate: number;          // percentage (0-100)
  errorCount: number;         // docs with codes [0=NormalExit, 1=BinaryNotRecognized, 259=StillActive, 999=UnexpectedTestError]
  conclusiveCount: number;    // docs with codes [101=Unprotected, 105=FileQuarantinedOnExtraction, 126=ExecutionPrevented, 127=QuarantinedOnExecution]
  totalTestActivity: number;  // errorCount + conclusiveCount (excludes code 200=NoOutput)
}

// Execution activity (dashboard "Testing cadence" card)
export interface ExecutionActivityDay {
  date: string;          // UTC day, YYYY-MM-DD
  protected: number;     // conclusive and (is_protected | defender_detected | crowdstrike_detected)
  unprotected: number;   // exit code 101 and not detected
  inconclusive: number;  // non-conclusive exit codes
}

export interface ExecutionActivityResponse {
  days: ExecutionActivityDay[];    // one per UTC day, oldest first, zero-filled
  lastExecutionAt: string | null;  // newest result for the org, all-time (not window-bound)
  executions7d: number;            // all result docs, last 7 days
  protectedPct7d: number | null;   // combined-protected / conclusive, last 7 days
  endpointsTested7d: number;       // distinct hostnames, last 7 days
}

// Error rate trend data point (rolling window)
export interface ErrorRateTrendDataPoint {
  timestamp: string;
  errorRate: number | null; // percentage 0-100; null = no test activity in the window
  errorCount: number;     // rolling window error count
  conclusiveCount: number; // rolling window conclusive count
  total: number;          // errorCount + conclusiveCount
}

// Canonical test count response (for stable coverage denominators)
export interface CanonicalTestCountResponse {
  count: number;
  tests: string[];
  days: number;
}
