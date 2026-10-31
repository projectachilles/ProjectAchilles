// Frontend API client for Defender analytics endpoints.

import { apiClient } from '@/hooks/useAuthenticatedApi';

import type { AlertFacetCounts, AlertSource, TechniqueCoverageResponse, TimeWindow } from './integrationTypes';
import { requestAlertsForTests, type AlertsForTestItem } from './alertsForTests';

// ---------------------------------------------------------------------------
// Response types (mirrors backend analytics service)
// ---------------------------------------------------------------------------

export interface SecureScoreSummary {
  currentScore: number;
  maxScore: number;
  percentage: number;
  averageComparative: number | null;
}

export interface SecureScoreTrendPoint {
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
}

export interface RecentAlertItem {
  alert_id: string;
  title: string;
  severity: string;
  created_at: string;
  service_source: string;
}

export interface AlertSummary {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  recentHigh: RecentAlertItem[];
  recentMedium: RecentAlertItem[];
  counts: AlertFacetCounts;
}

export interface AlertTrendPoint {
  date: string;
  count: number;
  /** Alerts in the bucket linked to an Achilles test. */
  linked: number;
  /** Bucket width: day for windows up to 90 days, week beyond. */
  interval: 'day' | 'week';
  high: number;
  medium: number;
  low: number;
}

export interface DefenderAlertItem {
  alert_id: string;
  alert_title: string;
  description: string;
  severity: string;
  status: string;
  category: string;
  service_source: string;
  mitre_techniques: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  hostname: string | null;
  achilles_correlated: boolean;
  achilles_test_uuid?: string;
  achilles_test_name?: string;
  /** 'bundle' when achilles_test_uuid is a bundle (name = bundle_name), else 'test'. */
  achilles_test_kind?: 'test' | 'bundle';
  recommended_actions: string;
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
   * Vendor-confirmed prevention disposition (from evidence[].remediationStatus,
   * normalized to the shared vocabulary: 'prevented' → 'blocked',
   * 'blocked' → 'process_killed', 'remediated' → 'quarantined'). Absent on
   * detection-only alerts. Defender has no 'kill_failed' equivalent.
   */
  prevention_action?: 'quarantined' | 'process_killed' | 'blocked';
  /** Raw Defender evidence remediationStatus — display/audit. */
  remediation_status?: string;
  /** Exact per-alert Defender portal deep link (from alertWebUrl). */
  portal_url?: string;
  auto_resolved?: boolean;
  auto_resolved_at?: string | null;
  auto_resolve_mode?: 'disabled' | 'dry_run' | 'enabled' | null;
  /** Set when Achilles shelved the alert without resolving it (not_found, not_applied, ...). */
  auto_resolve_error?: string | null;
}

export interface PaginatedAlerts {
  data: DefenderAlertItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: AlertFacetCounts;
}

export interface ControlItem {
  control_name: string;
  control_category: string;
  title: string;
  implementation_cost: string;
  user_impact: string;
  rank: number;
  threats: string[];
  deprecated: boolean;
  remediation_summary: string;
  action_url: string;
  max_score: number;
  tier: string;
}

export interface ControlCategoryBreakdown {
  category: string;
  count: number;
  totalMaxScore: number;
}

export interface ControlCorrelationResult {
  coveredTechniques: string[];
  alertCount: number;
}

export interface ScoreComparisonPoint {
  date: string;
  defenseScore: number | null;
  secureScore: number | null;
}

export interface TechniqueOverlapItem {
  technique: string;
  testResults: number;
  defenderAlerts: number;
}

export interface DetectionRateTechniqueItem {
  technique: string;
  testExecutions: number;
  correlatedExecutions: number;
  detected: boolean;
}

export interface DetectionRateResponse {
  overall: {
    /** Per-execution rate: correlatedExecutions / totalExecutions, as a percentage. */
    detectionRate: number;
    totalExecutions: number;
    correlatedExecutions: number;
    /** Distinct techniques exercised — drill-down context, not the headline. */
    testedTechniques: number;
    detectedTechniques: number;
  };
  byTechnique: DetectionRateTechniqueItem[];
}

export interface RelatedAlertsResponse {
  alerts: DefenderAlertItem[];
  matchedTechniques: string[];
  total: number;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const defenderApi = {
  // Secure Score
  async getSecureScore(): Promise<SecureScoreSummary> {
    const res = await apiClient.get('/analytics/defender/secure-score');
    return res.data;
  },

  async getSecureScoreTrend(days = 90): Promise<SecureScoreTrendPoint[]> {
    const res = await apiClient.get('/analytics/defender/secure-score/trend', { params: { days } });
    return res.data;
  },

  // Alerts
  async getAlertSummary(window?: TimeWindow): Promise<AlertSummary> {
    const res = await apiClient.get('/analytics/defender/alerts/summary', { params: window });
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
  }): Promise<PaginatedAlerts> {
    // Server expects techniques as comma-separated string
    const { techniques, severities, ...rest } = params ?? {};
    const queryParams: Record<string, unknown> = { ...rest };
    if (severities && severities.length > 0) {
      queryParams.severity = severities.join(',');
    }
    if (techniques && techniques.length > 0) {
      queryParams.techniques = techniques.join(',');
    }
    const res = await apiClient.get('/analytics/defender/alerts', { params: queryParams });
    return res.data;
  },

  async getAlertTrend(days = 30, window?: TimeWindow): Promise<AlertTrendPoint[]> {
    const res = await apiClient.get('/analytics/defender/alerts/trend', { params: { days, ...window } });
    return res.data;
  },

  // Controls
  async getControls(params?: {
    category?: string;
    deprecated?: boolean;
  }): Promise<ControlItem[]> {
    const res = await apiClient.get('/analytics/defender/controls', { params });
    return res.data;
  },

  async getControlsByCategory(): Promise<ControlCategoryBreakdown[]> {
    const res = await apiClient.get('/analytics/defender/controls/by-category');
    return res.data;
  },

  /** Alert correlation for several controls in one request (one Elasticsearch query), in input order. */
  async getControlCorrelations(
    titles: string[],
    days = 30,
  ): Promise<Array<ControlCorrelationResult & { title: string }>> {
    // axios sends the array as title[]=…&title[]=…, which the backend reads as a list.
    const res = await apiClient.get('/analytics/defender/controls/correlations', {
      params: { title: titles, days },
    });
    return res.data;
  },

  // Cross-correlation
  async getScoreCorrelation(days = 90): Promise<ScoreComparisonPoint[]> {
    const res = await apiClient.get('/analytics/defender/correlation/scores', { params: { days } });
    return res.data;
  },

  async getTechniqueCoverage(window: TimeWindow): Promise<TechniqueCoverageResponse> {
    const res = await apiClient.get('/analytics/defender/correlation/technique-coverage', { params: window });
    return res.data;
  },

  async getTechniqueOverlap(): Promise<TechniqueOverlapItem[]> {
    const res = await apiClient.get('/analytics/defender/correlation/techniques');
    return res.data;
  },

  // Detection correlation
  async getDetectionRate(days = 30, windowMinutes = 60): Promise<DetectionRateResponse> {
    const res = await apiClient.get('/analytics/defender/correlation/detection-rate', {
      params: { days, windowMinutes },
    });
    return res.data;
  },

  /** Related alerts for many executions (an Executions row's stages) in one request. */
  async getAlertsForTests(items: AlertsForTestItem[]): Promise<Array<RelatedAlertsResponse | null>> {
    return requestAlertsForTests<RelatedAlertsResponse>('/analytics/defender/correlation/alerts-for-tests', items, (item) =>
      defenderApi.getAlertsForTest(
        item.techniques, item.timestamp, item.windowMinutes, item.hostname, item.binaryName, item.bundleName,
      ),
    );
  },

  async getAlertsForTest(
    techniques: string[],
    timestamp: string,
    windowMinutes = 30,
    hostname?: string,
    binaryName?: string,
    bundleName?: string,
  ): Promise<RelatedAlertsResponse> {
    const res = await apiClient.get('/analytics/defender/correlation/alerts-for-test', {
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
