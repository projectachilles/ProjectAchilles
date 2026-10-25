// Frontend API client for SentinelOne analytics endpoints
// (/api/analytics/sentinelone/*). The backend serves the same response shapes
// as the CrowdStrike analytics routes (shared normalized alert doc), so the
// CrowdStrike types are reused. There is no ZTA score endpoint: SentinelOne has
// no device posture score equivalent.

import { apiClient } from '@/hooks/useAuthenticatedApi';

import type {
  CrowdStrikeAlertSummary,
  CrowdStrikeAlertTrendPoint,
  CrowdStrikeDetectionRateResponse,
  CrowdStrikeTechniqueOverlapItem,
  PaginatedCrowdStrikeAlerts,
  RelatedCrowdStrikeAlertsResponse,
  ZtaScoreComparisonPoint,
} from './crowdstrike';
import type { AlertSource, TechniqueCoverageResponse, TimeWindow } from './integrationTypes';

const BASE = '/analytics/sentinelone';

export type SentinelOneAlertSourceType = 'threats' | 'cloud_detection_alerts';

/** One protection policy per account / site / group, as read from SentinelOne (no score). */
export interface SentinelOnePolicyRow {
  level: 'account' | 'site' | 'group';
  scope_id: string;
  scope_name?: string;
  account_id?: string;
  site_id?: string;
  site_name?: string;
  group_id?: string;
  inherits?: boolean;
  mitigation_mode?: string;
  mitigation_mode_suspicious?: string;
  auto_mitigation_action?: string;
  anti_tampering_on?: boolean;
  snapshots_on?: boolean;
  agent_ui_on?: boolean;
  engines_on: string[];
  engines_off: string[];
  /** Set when SentinelOne refused this scope's policy (e.g. "HTTP 403"). */
  policy_error?: string;
  snapshot_id?: string;
}

export interface SentinelOneAgentHealthCounts {
  total: number | null;
  active: number | null;
  infected: number | null;
  outdated: number | null;
  detect_only: number | null;
  disconnected: number | null;
}

export interface SentinelOneAgentHealthResponse {
  latest: { timestamp: string; counts: SentinelOneAgentHealthCounts; counts_error?: string } | null;
  trend: Array<{ timestamp: string; counts: SentinelOneAgentHealthCounts }>;
}

export interface SentinelOneExclusionGapReport {
  exclusionsTotal: number;
  byType: Record<string, number>;
  unmatchable: number;
  s1Agents: number;
  missedOnS1Hosts: number;
  missedOnOtherHosts: number;
  flagged: Array<{
    test_uuid: string;
    test_name: string | null;
    hostname: string;
    os: string;
    last_seen: string | null;
    exclusions: Array<{ exclusion_id: string; value: string; path_exclusion_type: string | null; exclusion_mode: string | null; scope_name: string | null }>;
  }>;
}

export const sentineloneAnalyticsApi = {
  async getAlertSummary(window?: TimeWindow): Promise<CrowdStrikeAlertSummary> {
    const res = await apiClient.get(`${BASE}/alerts/summary`, { params: window });
    return res.data;
  },

  async getAlerts(params?: {
    page?: number;
    pageSize?: number;
    severity?: string;
    status?: string;
    search?: string;
    techniques?: string[];
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
    source?: AlertSource;
    sourceType?: SentinelOneAlertSourceType | string;
    severities?: string[];
    from?: string;
    to?: string;
  }): Promise<PaginatedCrowdStrikeAlerts> {
    const { techniques, severities, ...rest } = params ?? {};
    const queryParams: Record<string, unknown> = { ...rest };
    if (severities && severities.length > 0) queryParams.severity = severities.join(',');
    if (techniques && techniques.length > 0) queryParams.techniques = techniques.join(',');
    const res = await apiClient.get(`${BASE}/alerts`, { params: queryParams });
    return res.data;
  },

  async getAlertTrend(days = 30, window?: TimeWindow): Promise<CrowdStrikeAlertTrendPoint[]> {
    const res = await apiClient.get(`${BASE}/alerts/trend`, { params: { days, ...window } });
    return res.data;
  },

  /** Defense Score series; ztaScore is always null for SentinelOne. */
  async getScoreCorrelation(days = 90): Promise<ZtaScoreComparisonPoint[]> {
    const res = await apiClient.get(`${BASE}/correlation/scores`, { params: { days } });
    return res.data;
  },

  async getTechniqueCoverage(window: TimeWindow): Promise<TechniqueCoverageResponse> {
    const res = await apiClient.get(`${BASE}/correlation/technique-coverage`, { params: window });
    return res.data;
  },

  async getTechniqueOverlap(): Promise<CrowdStrikeTechniqueOverlapItem[]> {
    const res = await apiClient.get(`${BASE}/correlation/techniques`);
    return res.data;
  },

  async getDetectionRate(days = 30, windowMinutes = 60): Promise<CrowdStrikeDetectionRateResponse> {
    const res = await apiClient.get(`${BASE}/correlation/detection-rate`, { params: { days, windowMinutes } });
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
    const res = await apiClient.get(`${BASE}/correlation/alerts-for-test`, {
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

  async getPosturePolicies(): Promise<SentinelOnePolicyRow[]> {
    const res = await apiClient.get(`${BASE}/posture/policies`);
    return res.data.items ?? [];
  },

  async getAgentHealth(days = 30): Promise<SentinelOneAgentHealthResponse> {
    const res = await apiClient.get(`${BASE}/posture/agent-health`, { params: { days } });
    return res.data;
  },

  async getExclusionGaps(window?: TimeWindow): Promise<SentinelOneExclusionGapReport> {
    const res = await apiClient.get(`${BASE}/posture/exclusion-gaps`, { params: window });
    return res.data;
  },
};
