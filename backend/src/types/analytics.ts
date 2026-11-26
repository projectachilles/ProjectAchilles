// Analytics module types
import type { EdrGroupRollup, EdrResultFlags } from '../services/outcomes/vendors.js';
import type { CurrentTestVersion, ResultVersionState } from './testVersion.js';

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
  /** basis=latest with withNoConclusive=true: pairs with results in the window but no conclusive one (0 under outcome filters). */
  noConclusiveCount?: number;
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
  /** Version of the test the result came from; absent on results from before version tracking. */
  test_version?: ResultTestVersion;
  /** Set only when the route could read the library's current versions. */
  version_state?: ResultVersionState;
}

export interface ResultTestVersion {
  commit?: string;
  commit_date?: string;
  fingerprint?: string;
  built_at: string;
  /** Absent when the stored document does not say. */
  build_source?: 'built' | 'uploaded';
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

/** What the service returns; the route sends `cells` as the body and `truncated` as a header. */
export interface HostTestMatrixResult {
  cells: HostTestMatrixCell[];
  /** The page cap was reached: some host x test cells are missing. */
  truncated: boolean;
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
  /** When the run started (`routing.run_started_at`); absent on older results. */
  run_started_at?: string;
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
  /** The test explicitly marked this control as not applicable; meaningful with exit code 0. */
  skipped?: boolean;
  /** The EDR killed the Achilles agent mid-run; the run is protected as a whole and its stages are unknown. */
  edr_terminated?: boolean;
  /** Vendors that killed the agent, earliest first ('defender' | 'crowdstrike' | 'sentinelone'). */
  edr_terminated_vendors?: string[];
  /** Alert ids that are the evidence for the kill. */
  edr_terminated_alert_ids?: string[];
  stages_unknown?: boolean;
  /**
   * An EDR blocked the test at launch (the agent reported exit 260) and the
   * EDR's own prevention alert proves it: protected as a whole, no stage ran.
   */
  edr_launch_blocked?: boolean;
  /** Vendors whose alert proves the launch block, earliest first. */
  launch_block_vendors?: string[];
  /** Ids of the proving alert docs. */
  launch_block_alert_ids?: string[];
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
/** Executions-list outcome filter (the Outcome breakdown card's slices); not the shared `result` filter. */
export type ExecutionVerdict = 'protected' | 'prevented' | 'detected' | 'silent';
export const EXECUTION_VERDICTS: readonly ExecutionVerdict[] = ['protected', 'prevented', 'detected', 'silent'];

export interface PaginatedExecutionsParams extends ExtendedAnalyticsQueryParams, PaginationParams {
  grouped?: boolean;
  verdict?: ExecutionVerdict;
  /** Filter by how the stored test version relates to the library's current one. */
  versionState?: ResultVersionState;
  /** Current version of each test (uuid -> fingerprint and library commit), built by the route; labels rows and backs `versionState`. */
  currentFingerprints?: Map<string, CurrentTestVersion>;
  /** Only this test: its id, or a bundle's id (matches its stages and controls). `tests` matches by name. */
  testUuid?: string;
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

/** A group of chains on the Stage coverage card: how many, and their distinct bundle names (sorted). */
export interface StageCoverageGroup {
  count: number;
  bundleNames: string[];
}

/**
 * Stages caught in each attack chain's latest run (basis=latest). Same chains
 * as chain depth, minus runs with no stages (EDR killed the agent, or blocked
 * the test at launch). The four groups add up to `chains`.
 */
export interface StageCoverageResponse {
  chains: number;
  /** Of those, protected under the Defense Score's any-stage rule. */
  chainsProtected: number;
  /** Stages with a conclusive result. stagesRan = blocked + detected + through. */
  stagesRan: number;
  blocked: number;
  /** Stages an EDR alert named itself, not blocked. */
  detected: number;
  through: number;
  /** (blocked + detected) / stagesRan as a percentage; null when no stage ran. */
  coverage: number | null;
  /** Ran every stage, exactly one caught. */
  singleStage: StageCoverageGroup;
  /** One stage caught, other stages skipped or errored after the block: the rest of the chain was not tested. */
  depthNotTested: StageCoverageGroup;
  /** Two or more stages caught. */
  layered: StageCoverageGroup;
  /** No stage caught on its own evidence. */
  noneCaught: StageCoverageGroup;
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

// Execution activity (dashboard "Testing cadence" card). Counts are test runs:
// one standalone result or one bundle run (see getExecutionActivity).
export interface ExecutionActivityDay {
  date: string;          // UTC day, YYYY-MM-DD
  protected: number;     // runs blocked or detected (attack bundle: any stage; cyber-hygiene: every control)
  unprotected: number;   // runs with a conclusive result and no block/detection
  inconclusive: number;  // runs with no conclusive result
}

export interface ExecutionActivityResponse {
  days: ExecutionActivityDay[];    // one per UTC day, oldest first, zero-filled
  lastExecutionAt: string | null;  // newest result for the org, all-time (not window-bound)
  executions7d: number;            // test runs, last 7 days (name kept for API compatibility)
  protectedPct7d: number | null;   // protected runs / conclusive runs, last 7 days
  endpointsTested7d: number;       // distinct hostnames, last 7 days
  truncated?: true;                // present when the bundle-run page cap was reached: counts are a lower bound
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

/** Latest-basis outcome split of non-cyber-hygiene pairs (GET /analytics/outcome-breakdown). */
export interface OutcomeBreakdownResponse {
  pairCount: number;
  protected: number;      // strict: the test itself was blocked
  prevented: number;      // detected and an EDR prevented it
  detected: number;       // detected only
  silent: number;         // nothing stopped or flagged it
  noConclusive: number;   // pairs with docs but no conclusive result in the window
  riskAccepted: number;   // pairs hidden by risk acceptance
  windowLabel: string;
}

// ── Coverage matrix (GET /analytics/coverage-matrix) ───────────────────────
// The latest result per test and host: the Defense Score's latest-basis,
// any-stage pairs, drawn one cell per pair instead of summed.

/** What a cell shows. "Caught" is protected + detected. */
export type MatrixVerdict = 'protected' | 'detected' | 'unprotected' | 'no_verdict' | 'risk_accepted';

export const MATRIX_VERDICTS: readonly MatrixVerdict[] = ['protected', 'detected', 'unprotected', 'no_verdict', 'risk_accepted'];

/** A cyber-hygiene bundle on one host (or summed): its controls' latest results. */
export interface MatrixRatio {
  /** Controls whose latest conclusive result is compliant. */
  compliant: number;
  /** Controls with a conclusive result. */
  evaluated: number;
  /** Controls that ran and never had a conclusive result in the window. */
  notAssessed: number;
  /** Controls hidden by a risk acceptance. */
  accepted: number;
}

export interface MatrixCell {
  /** Index into `hosts` (rows = tests) or into `tests` (rows = hosts). */
  i: number;
  /** Absent on a cell that has `ratio`. */
  verdict?: MatrixVerdict;
  /** A cyber-hygiene bundle's controls on this host. */
  ratio?: MatrixRatio;
  /** Time of the result shown; for a ratio, of its newest control result. */
  at: string;
  /** Attack cells: the pair's earlier conclusive verdicts, one per day, newest first, at most 6. */
  earlier?: MatrixVerdict[];
}

/** Cells of a row (or column) by what they show; a ratio cell is counted in none of the verdicts. */
export interface MatrixCounts {
  protected: number;
  detected: number;
  unprotected: number;
  noVerdict: number;
  riskAccepted: number;
  /** rows = tests: hosts on the axis with no cell for this test. On a host: tests with no cell for it. */
  neverRun: number;
}

export interface MatrixHost {
  /** `<organization id>|<hostname>`: one hostname in two organizations is two hosts. */
  key: string;
  hostname: string;
  org: string | null;
  counts: MatrixCounts;
  /** Sum of this host's cyber-hygiene bundle cells. */
  ratio: MatrixRatio;
}

export interface MatrixTest {
  /** The test or bundle UUID. */
  key: string;
  testUuid: string;
  name: string;
  /** A standalone test, a multi-stage attack chain, or a cyber-hygiene bundle (ratio cells). */
  kind: 'test' | 'chain' | 'controls';
  category?: string;
  counts: MatrixCounts;
  /** kind 'controls': sum over the hosts. */
  ratio?: MatrixRatio;
}

export interface CoverageMatrixTestsResponse {
  rows: 'tests';
  windowLabel: string;
  /**
   * Every host with a result in the window, most exposed first; the same order
   * in every row. Empty when `cellsIncluded` is false: page through rows = hosts.
   */
  hosts: MatrixHost[];
  /** Hosts with a result in the window, also when `hosts` is not sent. */
  hostCount: number;
  /** `cells` is null when `cellsIncluded` is false. */
  tests: (MatrixTest & { cells: MatrixCell[] | null })[];
  testCount: number;
  /** False above the host limit: the counts are complete, the cells are left out. */
  cellsIncluded: boolean;
  /** True when more tests exist than are listed. */
  truncated: boolean;
}

export interface CoverageMatrixHostsResponse {
  rows: 'hosts';
  windowLabel: string;
  tests: MatrixTest[];
  testCount: number;
  /** One page of hosts, in the order of rows = tests. */
  hosts: (MatrixHost & { cells: MatrixCell[] })[];
  /** Hosts matching the request, over all pages. */
  hostCount: number;
  page: number;
  pageSize: number;
  truncated: boolean;
}

// Score movement (GET /api/analytics/score-movement)

/** Where a failure in play came from, decided at its first failing moment. */
export type MovementOrigin = 'open_at_start' | 'older_retested' | 'regression' | 'new_test' | 'first_on_endpoint';
/** What became of a failure in play by the end of the period. */
export type MovementOutcome = 'fixed' | 'still_failing' | 'not_retested' | 'left_untested';

/** One test on one endpoint in a score movement list. */
export interface MovementRow {
  testUuid: string;
  /** Bundle name for a bundle pair. */
  testName: string;
  controlId?: string;
  hostname: string;
  /** Absent on newStopped rows. */
  origin?: MovementOrigin;
  /** First result of the failing run the row describes (ISO); null when openBeforePeriod or never failing. */
  failingSince: string | null;
  /** That failing run includes the result before the period, so its true start was not read. */
  openBeforePeriod?: true;
  /** First protected result after that failing run (ISO). */
  fixedAt?: string;
  lastResultAt: string;
}
/** At most MOVEMENT_LIST_LIMIT rows; total is the full count. */
export interface MovementList {
  total: number;
  rows: MovementRow[];
}
export type MovementListKey = 'fixed' | 'stillFailing' | 'notRetested' | 'leftUntested' | 'newStopped' | 'newGotThrough';
export interface ScoreMovementResponse {
  window: { from: string; to: string; label: string };
  /** Score pairs in the score at from / at to. */
  pairs: { start: number; end: number };
  /** Unprotected score pairs at from / at to (the score's own counts). */
  failing: { start: number; end: number };
  /** failing.end = stillFailing + notRetested + fixedButCounted + countedTwice. */
  scoreDifference: { fixedButCounted: number; countedTwice: number };
  failures: {
    total: number;
    fixed: number;
    stillFailing: number;
    notRetested: number;
    leftUntested: number;
    fixRate: number | null;
    origins: { openAtStart: number; olderRetested: number; regression: number; newTest: number; firstOnEndpoint: number };
  };
  /** First period result of every pair of a new attack test (cyber-hygiene left out). */
  newTests: {
    tests: number;
    pairs: number;
    stopped: number;
    gotThrough: number;
    rate: number | null;
    gotThroughFixed: number;
    gotThroughOpen: number;
  };
  regressed: { total: number; fixed: number };
  /** Pairs with no prior result that are not new-test pairs. */
  firstOnEndpoint: { pairs: number; stopped: number };
  /** Open failures a risk acceptance removes entirely; null when nothing is excluded. */
  riskAccepted: number | null;
  lists: Record<MovementListKey, MovementList>;
}
