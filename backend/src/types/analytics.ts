// Analytics module types
import type { EdrGroupRollup, EdrResultFlags } from '../services/outcomes/vendors.js';

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
/**
 * `EdrResultFlags` adds, for every vendor in the EDR registry
 * (services/outcomes/vendors.ts), the flags its enrichment pass writes:
 * `<key>_detected` (an alert matched this doc's bundle UUID, host and time
 * window; bundle-scoped), `<key>_stage_detected` (the alert names THIS stage's
 * own binary), `<key>_prevented` (the matched alert carried vendor-confirmed
 * prevention) and `<key>_prevention_action` (quarantined / process_killed /
 * blocked).
 */
export interface EnrichedTestExecution extends TestExecution, EdrResultFlags {
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
  /** The EDR killed the Achilles agent mid-run; the run is protected as a whole and its stages are unknown. */
  edr_terminated?: boolean;
  /** Vendors that killed the agent, earliest first ('defender' | 'crowdstrike' | 'sentinelone'). */
  edr_terminated_vendors?: string[];
  /** Alert ids that are the evidence for the kill. */
  edr_terminated_alert_ids?: string[];
  stages_unknown?: boolean;
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
/** `EdrGroupRollup`: per registry vendor, `<key>Detected` / `<key>Prevented` when any member is. */
export interface ExecutionGroup extends EdrGroupRollup {
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
  chains: number;                // chains counted (blocked + end to end + agent terminated)
  buckets: ChainDepthBucket[];   // always stages 1, 2, 3, 4 in order
  endToEnd: number;              // chains no stage blocked
  endToEndAlerted: number;       // of those, some stage was detected
  endToEndBundleNames: string[];
  endToEndAlertedBundleNames: string[];    // end-to-end chains where an EDR alerted
  endToEndUndetectedBundleNames: string[]; // end-to-end chains with no alert (a bundle can be in both)
  /** Chains whose latest run the EDR stopped by killing the agent: stages unknown, so in no bucket and not end to end. */
  agentTerminated: number;
  agentTerminatedBundleNames: string[];
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
