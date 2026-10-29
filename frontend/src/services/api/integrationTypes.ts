// Vendor-neutral integration (CrowdStrike / Defender) API types.

import type { RelatedCrowdStrikeAlertsResponse } from './crowdstrike';

/** ISO from/to window sent to the integration endpoints. */
export type TimeWindow = { from: string; to: string };

/** Alert feed source filter. Linked = Achilles-correlated; organic = everything else. */
export type AlertSource = 'all' | 'test' | 'organic';

/**
 * Facet counts behind the alert feed's filter segments and summary strip.
 * Every count sees the window, search, techniques and status filters;
 * severity only ever filters the listed hits.
 */
export interface AlertFacetCounts {
  /** Ignores source and severity, so `all` equals the alerts tile. */
  bySource: { all: number; test: number; organic: number };
  /** Honours source, ignores severity. */
  bySeverity: Record<string, number>;
  /** Honours source, ignores severity. Alerts Achilles really resolved (enabled, error-free receipt). */
  autoResolved: number;
  /** Window only: linked AND status NOT IN ('closed','resolved'). */
  linkedOpen: number;
  /** CrowdStrike only. Honours source, ignores severity. */
  byPrevention?: { prevented: number; detected_only: number; kill_failed: number };
  /** Defender only. Honours source, ignores severity. */
  byProduct?: Record<string, number>;
}

export interface TechniqueCoverageItem {
  technique: string;
  name: string | null;
  executions: number;
  prevented: number;
  detectedOnly: number;
  missed: number;
  /** Distinct vendor alerts in the window tagged with this id or an `<id>.` sub-technique (the drawer's rule). */
  alerts: number;
}

export interface TechniqueCoverageResponse {
  overall: {
    executions: number;
    prevented: number;
    detectedOnly: number;
    missed: number;
    /** % of distinct executions, 1 dp, 0 when executions = 0. */
    detectionRate: number;
    /** % of distinct executions, 1 dp, 0 when executions = 0. */
    preventionRate: number;
    testedTechniques: number;
    detectedTechniques: number;
  };
  /** Detected first, then executions desc. */
  byTechnique: TechniqueCoverageItem[];
}

// ---------------------------------------------------------------------------
// Vendor-neutral shapes used by the shared integration components. The vendor
// clients' response types are structurally assignable to these.
// ---------------------------------------------------------------------------

export interface IntegrationAlertItem {
  alert_id: string;
  alert_title: string;
  severity: string;
  status: string;
  mitre_techniques: string[];
  created_at: string;
  hostname: string | null;
  prevention_action?: 'quarantined' | 'process_killed' | 'blocked' | 'kill_failed';
  portal_url?: string;
  achilles_correlated: boolean;
  achilles_test_uuid?: string;
  achilles_test_name?: string;
  /** 'bundle' when achilles_test_uuid is a bundle (name = bundle_name), else 'test'. */
  achilles_test_kind?: 'test' | 'bundle';
  /** Defender only (CrowdStrike items carry `product` instead). */
  service_source?: string;
}

export interface IntegrationAlertPage {
  data: IntegrationAlertItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: AlertFacetCounts;
}

export interface IntegrationAlertSummary {
  total: number;
  bySeverity: Record<string, number>;
  counts: AlertFacetCounts;
}

export interface IntegrationTrendPoint {
  date: string;
  count: number;
  linked: number;
  interval: 'day' | 'week';
}

export interface IntegrationAlertQuery {
  page?: number;
  pageSize?: number;
  severity?: string;
  status?: string;
  search?: string;
  techniques?: string[];
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  source?: AlertSource;
  /** Vendor-specific record type (SentinelOne: threats vs detection alerts). */
  sourceType?: string;
  severities?: string[];
  from?: string;
  to?: string;
}

/** The API surface the shared integration components depend on. */
/** Auto-resolve state behind the hero tile, in one shape for every vendor. */
export interface AutoResolveTileStatus {
  mode: 'disabled' | 'dry_run' | 'enabled';
  counts: { last24h: number; last7d: number; last30d: number };
  /** Enabled, but the vendor connection can't write (SentinelOne read-only token). */
  writesBlocked?: boolean;
}

export interface AutoResolveSource {
  getStatus(): Promise<AutoResolveTileStatus>;
  getReceipts(limit: number, offset: number): Promise<{ items: { auto_resolved_at?: string | null }[] }>;
}

/** Alerts that name one test run (Executions panel); endpoint-EDR vendors only. */
export type AlertsForTestFn = (
  techniques: string[],
  timestamp: string,
  windowMinutes?: number,
  hostname?: string,
  binaryName?: string,
  bundleName?: string,
) => Promise<RelatedCrowdStrikeAlertsResponse>;

export interface IntegrationApi {
  /** Present for endpoint-EDR vendors (see vendorConfig `endpointEdr`). */
  getAlertsForTest?: AlertsForTestFn;
  getAlerts(params?: IntegrationAlertQuery): Promise<IntegrationAlertPage>;
  getAlertSummary(window?: TimeWindow): Promise<IntegrationAlertSummary>;
  getAlertTrend(days?: number, window?: TimeWindow): Promise<IntegrationTrendPoint[]>;
  getTechniqueCoverage(window: TimeWindow): Promise<TechniqueCoverageResponse>;
}
