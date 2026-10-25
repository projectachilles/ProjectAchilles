// Frontend API client for CrowdStrike Falcon analytics endpoints.

import { apiClient } from '@/hooks/useAuthenticatedApi';

import type { AlertFacetCounts, AlertSource, TechniqueCoverageResponse, TimeWindow } from './integrationTypes';

// ---------------------------------------------------------------------------
// Response types (mirrors backend analytics service)
// ---------------------------------------------------------------------------

export interface ZtaScoreSummary {
  overallScore: number;
  osScore: number;
  sensorConfigScore: number;
  deviceCount: number;
  minScore: number;
}

export interface ZtaScoreTrendPoint {
  date: string;
  overallScore: number;
  /** Alias of overallScore, kept for the CLI. */
  score: number;
  osScore: number;
  sensorConfigScore: number;
  deviceCount: number;
}

export interface CrowdStrikeRecentAlertItem {
  alert_id: string;
  title: string;
  severity: string;
  created_at: string;
  product: string;
}

export interface CrowdStrikeAlertSummary {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  recentHigh: CrowdStrikeRecentAlertItem[];
  recentMedium: CrowdStrikeRecentAlertItem[];
  counts: AlertFacetCounts;
}

export interface CrowdStrikeAlertTrendPoint {
  date: string;
  count: number;
  /** Alerts in the bucket linked to an Achilles test. */
  linked: number;
  /** Bucket width: day for windows up to 90 days, week beyond. */
  interval: 'day' | 'week';
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface CrowdStrikeAlertItem {
  alert_id: string;
  alert_title: string;
  description: string;
  severity: string;
  status: string;
  technique: string;
  tactic: string;
  product: string;
  scenario: string;
  hostname: string | null;
  filename: string;
  filepath: string;
  mitre_techniques: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  achilles_correlated: boolean;
  achilles_test_uuid?: string;
  achilles_test_name?: string;
  /** 'bundle' when achilles_test_uuid is a bundle (name = bundle_name), else 'test'. */
  achilles_test_kind?: 'test' | 'bundle';
  /**
   * 'stage' when the alert's evidence carries a `<bundle_uuid>-<technique>.exe`
   * binary that pins it to a specific stage; 'bundle' otherwise (orchestrator
   * UUID-only binary, dropped-file path under a bundle-named sandbox dir,
   * etc.). Drives whether the alert renders inside a stage drill-down or in
   * the bundle parent's bundle-level callout.
   */
  attribution?: 'stage' | 'bundle';
  /**
   * Lowercased technique token from a stage-attributable evidence binary.
   * Frontend matches case-insensitively against `f0rtika.control_id`.
   */
  attributed_control_id?: string;
  /**
   * Vendor-confirmed prevention disposition (from pattern_disposition_details):
   * 'quarantined' | 'process_killed' | 'blocked' = Falcon prevented the action;
   * 'kill_failed' = prevention attempted but failed (detection-only signal).
   * Absent on detection-only alerts.
   */
  prevention_action?: 'quarantined' | 'process_killed' | 'blocked' | 'kill_failed';
  /** Raw CrowdStrike disposition text, e.g. "Prevention, process killed." — display/audit. */
  pattern_disposition_description?: string;
  /** Exact per-alert Falcon console deep link (from falcon_host_link). */
  portal_url?: string;
  auto_resolved?: boolean;
  auto_resolved_at?: string | null;
  auto_resolve_mode?: 'disabled' | 'dry_run' | 'enabled' | null;
  /** Set when Achilles shelved the alert without resolving it (not_found, not_applied, ...). */
  auto_resolve_error?: string | null;
}

export interface PaginatedCrowdStrikeAlerts {
  data: CrowdStrikeAlertItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: AlertFacetCounts;
}

export interface ZtaScoreComparisonPoint {
  date: string;
  defenseScore: number | null;
  ztaScore: number | null;
}

export interface CrowdStrikeTechniqueOverlapItem {
  technique: string;
  testResults: number;
  crowdstrikeAlerts: number;
}

export interface CrowdStrikeDetectionRateTechniqueItem {
  technique: string;
  testExecutions: number;
  correlatedExecutions: number;
  detected: boolean;
}

export interface CrowdStrikeDetectionRateResponse {
  overall: {
    /** Per-execution rate: correlatedExecutions / totalExecutions, as a percentage. */
    detectionRate: number;
    totalExecutions: number;
    correlatedExecutions: number;
    /** Distinct techniques exercised — drill-down context, not the headline. */
    testedTechniques: number;
    detectedTechniques: number;
  };
  byTechnique: CrowdStrikeDetectionRateTechniqueItem[];
}

export interface RelatedCrowdStrikeAlertsResponse {
  alerts: CrowdStrikeAlertItem[];
  matchedTechniques: string[];
  total: number;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const crowdstrikeApi = {
  // Zero Trust Assessment score
  async getZtaScore(): Promise<ZtaScoreSummary> {
    const res = await apiClient.get('/analytics/crowdstrike/zta-score');
    return res.data;
  },

  async getZtaScoreTrend(days = 90): Promise<ZtaScoreTrendPoint[]> {
    const res = await apiClient.get('/analytics/crowdstrike/zta-score/trend', { params: { days } });
    return res.data;
  },

  // Alerts
  async getAlertSummary(window?: TimeWindow): Promise<CrowdStrikeAlertSummary> {
    const res = await apiClient.get('/analytics/crowdstrike/alerts/summary', { params: window });
    return res.data;
  },

  async getAlerts(params?: {
    page?: number;
    pageSize?: number;
    severity?: string;
    status?: string;
    search?: string;
    /** MITRE techniques to OR-filter on. Each matches itself + sub-techniques. */
    techniques?: string[];
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
    /** Linked (Achilles test) vs organic alerts. */
    source?: AlertSource;
    /** Severity OR-filter; sent as a comma-separated `severity` param. */
    severities?: string[];
    from?: string;
    to?: string;
  }): Promise<PaginatedCrowdStrikeAlerts> {
    // Server expects techniques as comma-separated string
    const { techniques, severities, ...rest } = params ?? {};
    const queryParams: Record<string, unknown> = { ...rest };
    if (severities && severities.length > 0) {
      queryParams.severity = severities.join(',');
    }
    if (techniques && techniques.length > 0) {
      queryParams.techniques = techniques.join(',');
    }
    const res = await apiClient.get('/analytics/crowdstrike/alerts', { params: queryParams });
    return res.data;
  },

  async getAlertTrend(days = 30, window?: TimeWindow): Promise<CrowdStrikeAlertTrendPoint[]> {
    const res = await apiClient.get('/analytics/crowdstrike/alerts/trend', { params: { days, ...window } });
    return res.data;
  },

  // Cross-correlation
  async getScoreCorrelation(days = 90): Promise<ZtaScoreComparisonPoint[]> {
    const res = await apiClient.get('/analytics/crowdstrike/correlation/scores', { params: { days } });
    return res.data;
  },

  async getTechniqueCoverage(window: TimeWindow): Promise<TechniqueCoverageResponse> {
    const res = await apiClient.get('/analytics/crowdstrike/correlation/technique-coverage', { params: window });
    return res.data;
  },

  async getTechniqueOverlap(): Promise<CrowdStrikeTechniqueOverlapItem[]> {
    const res = await apiClient.get('/analytics/crowdstrike/correlation/techniques');
    return res.data;
  },

  // Detection correlation
  async getDetectionRate(days = 30, windowMinutes = 60): Promise<CrowdStrikeDetectionRateResponse> {
    const res = await apiClient.get('/analytics/crowdstrike/correlation/detection-rate', {
      params: { days, windowMinutes },
    });
    return res.data;
  },

  async getAlertsForTest(
    techniques: string[],
    timestamp: string,
    windowMinutes = 30,
    hostname?: string,
    binaryName?: string,
    bundleName?: string,
  ): Promise<RelatedCrowdStrikeAlertsResponse> {
    const res = await apiClient.get('/analytics/crowdstrike/correlation/alerts-for-test', {
      params: {
        techniques: techniques.join(','),
        timestamp,
        windowMinutes,
        ...(hostname && { hostname }),
        ...(binaryName && { binaryName }),
        ...(bundleName && { bundleName }),
      },
    });
    return res.data;
  },
};
