import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { ExtendedFilterParams } from './analytics';

// ─── SB-PC-2026-001 compliance report ─────────────────────────────

export type SbOutcome = 'PREVENTED' | 'DETECTED' | 'MISSED' | 'EXPOSED' | 'NOT_RUN' | 'ERROR';

export interface SbReportExecutionRow {
  sourceEventId: string;
  timestamp: string;
  bundleId: string;
  bundleName: string;
  testName: string;
  hostname: string;
  stage: number;
  stageLabel: string;
  techniques: string[];
  tactics: string[];
  outcome: SbOutcome;
  isProtected: boolean;
  preventedBy: string[];
  detectedBy: string[];
  evidenceRef: string;
}

export interface SbReport {
  meta: {
    organization: string;
    vendor: string;
    window: { from: string; to: string };
    generatedAt: string;
  };
  executions: SbReportExecutionRow[];
}

export interface SbReportParams {
  /** Window start, ISO 8601 datetime (required). */
  from: string;
  /** Window end, ISO 8601 datetime (required). */
  to: string;
  /** Organization UUID (routing.oid filter). */
  org?: string;
  /** SB entity code for meta.organization. */
  orgCode?: string;
  /** Bundle UUID (f0rtika.bundle_id filter). */
  bundleUuid?: string;
  /** Comma-separated f0rtika.tags scope filter. */
  tags?: string;
  /** Comma-separated routing.hostname scope filter. */
  hostnames?: string;
  /** Comma-separated f0rtika.test_name scope filter. */
  tests?: string;
  /** Comma-separated f0rtika.bundle_name scope filter. */
  bundleNames?: string;
}

export interface ExecutionReportParams extends Omit<ExtendedFilterParams, 'scoringMode'> {
  /** IANA time zone for buckets and printed times. */
  tz: string;
}

export const reportsApi = {
  /** Fetch the SB-PC-2026-001 compliance report for a window. */
  async getSbPc2026001Report(params: SbReportParams): Promise<SbReport> {
    const response = await apiClient.get('/reports/sb-pc-2026-001', {
      params: {
        from: params.from,
        to: params.to,
        org: params.org,
        org_code: params.orgCode,
        bundle_uuid: params.bundleUuid,
        tags: params.tags,
        hostnames: params.hostnames,
        tests: params.tests,
        bundle_names: params.bundleNames,
      },
    });
    return response.data;
  },

  /** Fetch the print-ready execution report for the All executions filters. */
  async getExecutionReport(params: ExecutionReportParams): Promise<ExecutionReport> {
    const response = await apiClient.get('/reports/executions', { params });
    return response.data.data;
  },
};

// ─── Execution report (GET /api/reports/executions) ───────────────
// Copied from backend/src/types/reports.ts; change both together.

export type StageOutcome =
  | 'protected'
  | 'prevented'
  | 'detected'
  | 'unprotected'
  | 'inconclusive'
  | 'skipped';

export type OutcomeCounts = Record<StageOutcome, number>;

export type TimeBucket = 'hour' | 'day' | 'week' | 'month';

export interface ReportWindow {
  /** '1d' | '7d' | '30d' | '90d' | 'all' | 'custom', derived from the bounds. */
  preset: string;
  /** e.g. 'Last 30 days', 'All time', 'Custom range'. */
  label: string;
  /** Absolute bounds every query used (resolved once at request start). */
  effectiveFrom: string;
  effectiveTo: string;
  /** Timeline axis (spec §5.5 rule 4). */
  axisFrom: string;
  axisTo: string;
  bucket: TimeBucket;
  firstExecution: string | null;
  lastExecution: string | null;
}

/** Optional report sections that depend on a fallible lookup outside the required queries. */
export type ReportEnrichment = 'defenseScore' | 'alerts' | 'startTimes' | 'acceptedRisks';

export interface ReportMeta {
  reportId: string;
  generatedAt: string;
  tz: string;
  /** id: the agent-org filter from the URL. name: that org's short name or, with no org in the URL,
   *  the deployment's ORGANIZATION_NAME; null when neither applies. */
  org: { id: string | null; name: string | null };
  /** Applied filter-bar params, echoed (non-empty values only). */
  filters: Record<string, string>;
  /** Active outcome-selecting filters, e.g. ['result=unprotected']. */
  outcomeFiltered: string[];
  window: ReportWindow;
  truncation: { runs: boolean; tests: boolean; lanes: boolean };
  /** Section-level degradations, human readable. */
  warnings: string[];
  /**
   * Optional enrichments that failed or timed out (spec §5.7). The matching section says
   * the data is unavailable or incomplete; for `'alerts'` the alerts that were found are
   * still listed and unchecked runs are marked via `ReportRun.alertsChecked`. Empty when
   * everything succeeded or was not applicable.
   */
  unavailable: ReportEnrichment[];
  /** Set when part of the data in scope could not be read (partial shard failure); the cover shows a banner. */
  partial: { failedShards: number; totalShards: number } | null;
  /** EDR vendors configured for this report; empty means EDR content is omitted silently (matching the console). */
  edrVendors: Array<'defender' | 'crowdstrike' | 'sentinelone'>;
}

export interface ReportTotals {
  runs: number;
  /** True above 10,000 runs, where the count comes from HyperLogLog. */
  runsApproximate: boolean;
  /** Stage results excluding skipped stages. */
  stageResults: number;
  endpoints: number;
  tests: number;
  techniques: number;
  tactics: number;
  actors: number;
  outcomes: OutcomeCounts;
  highImpactUnprotected: number;
}

export interface ReportDefenseScore {
  score: number | null;
  /** Score before accepted-risk exclusion; null when nothing is excluded. */
  rawScore: number | null;
  riskAcceptedCount: number;
}

export interface ReportTimelineLane {
  testKey: string;
  name: string;
  runs: number;
}

export interface ReportTimelineBucket {
  start: string;
  lanes: { testKey: string; runs: number; outcomes: OutcomeCounts }[];
}

export interface ReportTimeline {
  lanes: ReportTimelineLane[];
  buckets: ReportTimelineBucket[];
}

export interface ReportStage {
  controlId: string | null;
  name: string;
  order: number;
  techniques: string[];
  tactics: string[];
  outcomes: OutcomeCounts;
  /** Correlated alert counts from the runs list (the newest RUNS_CAP runs). */
  /** `sentinelone` is absent from backends without the SentinelOne integration. */
  alerts: { defender: number; crowdstrike: number; sentinelone?: number };
}

export interface ReportTest {
  testKey: string;
  name: string;
  isBundle: boolean;
  category: string | null;
  subcategory: string | null;
  severity: string | null;
  score: number | null;
  target: string[];
  complexity: string | null;
  threatActor: string | null;
  tags: string[];
  description: string | null;
  runs: number;
  endpoints: number;
  lastRun: string | null;
  outcomes: OutcomeCounts;
  stages: ReportStage[];
}

export interface ReportOtherTest {
  testKey: string;
  name: string;
  runs: number;
  outcomes: OutcomeCounts;
}

export interface ReportTechnique {
  id: string;
  name: string | null;
  tactic: string | null;
  outcomes: OutcomeCounts;
  testKeys: string[];
}

export interface ReportActor {
  name: string;
  testKeys: string[];
  runs: number;
  outcomes: OutcomeCounts;
}

export interface ReportHost {
  hostname: string;
  runs: number;
  outcomes: OutcomeCounts;
}

export interface ReportFinding {
  techniqueId: string;
  techniqueName: string | null;
  tactic: string | null;
  highImpact: boolean;
  outcomes: OutcomeCounts;
  testKeys: string[];
  testNames: string[];
  acceptedRisk: boolean;
  guidance: { testKey: string; testName: string; excerpt: string | null } | null;
}

/**
 * name, techniques and tactics are present only when the report has at most
 * RUN_STRIP_MAX_RUNS runs (the run-strip appendix); above that they are omitted
 * to keep the payload under the 4.5 MB serverless response limit. Read them
 * from tests[].stages by controlId instead.
 */
export interface ReportRunStage {
  controlId: string | null;
  name?: string;
  order: number;
  outcome: StageOutcome;
  exitCode: number | null;
  techniques?: string[];
  tactics?: string[];
  highImpact: boolean;
}

export interface ReportAlert {
  vendor: 'defender' | 'crowdstrike' | 'sentinelone';
  title: string;
  severity: string;
  status: string;
  createdAt: string;
  /** Lowercased control token from the evidence binary; null = bundle-level. */
  stageControlId: string | null;
  preventionAction: string | null;
  portalUrl: string | null;
  autoResolvedAt: string | null;
}

export interface ReportRun {
  key: string;
  testKey: string;
  testName: string;
  hostname: string;
  completedAt: string;
  startedAt: string | null;
  taskId: string | null;
  stages: ReportRunStage[];
  /** Stage docs beyond MEMBERS_CAP that were not fetched. */
  moreStages: number;
  alerts: ReportAlert[];
  /**
   * True when every configured EDR vendor completed a search for this run.
   * False means not (fully) checked, which is not the same as "no alerts".
   */
  alertsChecked: boolean;
}

export interface AcceptedRiskRow {
  testName: string;
  controlId: string | null;
  hostname: string | null;
  scope: 'host' | 'global';
  justification: string;
  acceptedBy: string;
  acceptedAt: string;
}

export interface ExecutionReport {
  meta: ReportMeta;
  totals: ReportTotals;
  defenseScore: ReportDefenseScore | null;
  timeline: ReportTimeline;
  tests: ReportTest[];
  otherTests: ReportOtherTest[];
  techniques: ReportTechnique[];
  actors: ReportActor[];
  hosts: ReportHost[];
  findings: ReportFinding[];
  runs: ReportRun[];
  /** null when the caller lacks analytics:risk:read. */
  acceptedRisks: AcceptedRiskRow[] | null;
}
