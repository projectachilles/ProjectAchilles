// Frontend API client for Sophos analytics endpoints (/api/analytics/sophos/*).
// The alert routes serve the same normalized shapes as the CrowdStrike and
// SentinelOne ones, so the CrowdStrike types are reused. `ztaScore` in the score
// correlation carries the Achilles average of Sophos Health Check scores.

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
import type { SophosSourceType } from './sophos';

const BASE = '/analytics/sophos';

export type SophosAlertSourceType = SophosSourceType;

/** Mirrors backend services/sophos/health-score.ts. */
export type SophosHealthCategoryId = 'protection' | 'policy' | 'exclusions' | 'tamper_protection';

export interface SophosHealthCategoryScore {
  category: SophosHealthCategoryId;
  score: number | null;
  computer?: number | null;
  server?: number | null;
  global?: number | null;
}

export interface SophosHealthSnapshot {
  /** Achilles average of Sophos Health Check scores (0-100); null when none reported. */
  headline: number | null;
  categories: SophosHealthCategoryScore[];
  items: {
    notFullyProtected: string[];
    notOnRecommended: Array<{ policy: string; settings: string[] }>;
    riskyExclusions: Array<{ value: string; type: string; scanMode?: string; reasonCode?: string }>;
    tamperDisabled: string[];
  };
}

export interface SophosHealthCheckResponse {
  latest: SophosHealthSnapshot | null;
  trend: Array<{ date: string; score: number }>;
}

/** Mirrors backend services/sophos/posture.service.ts. */
export interface SophosEndpointHealth {
  total: number;
  notSeen7d: number;
  outOfDate: number;
  tamperOff: number;
  isolated: number;
  healthBad: number;
  healthSuspicious: number;
  xdrInstalled: number;
}

export interface SophosPolicyRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  appliesTo: string[];
  deviations: Array<{ key: string; value: unknown; recommended: unknown }>;
}

export interface SophosExclusionGapReport {
  critical: Array<{ kind: 'certificate_allow' | 'folder_exclusion' | 'agent_process_exclusion'; value: string; detail: string }>;
  gaps: Array<{ testUuid: string; hostname: string; path: string; exclusion: string; lastRunAt: string }>;
  notes: string[];
}

export const sophosAnalyticsApi = {
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
    sourceType?: SophosAlertSourceType | string;
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

  /** Defense Score series; ztaScore is the Achilles average of Sophos Health Check scores. */
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

  /** Latest Health Check snapshot and its trend over `days`. */
  async getHealthCheck(days = 30): Promise<SophosHealthCheckResponse> {
    const res = await apiClient.get(`${BASE}/posture/health-check`, { params: { days } });
    return res.data;
  },

  async getEndpointHealth(): Promise<SophosEndpointHealth> {
    const res = await apiClient.get(`${BASE}/posture/endpoint-health`);
    return res.data;
  },

  async getPolicies(): Promise<SophosPolicyRow[]> {
    const res = await apiClient.get(`${BASE}/posture/policies`);
    return res.data.items ?? [];
  },

  async getExclusionGaps(window?: TimeWindow): Promise<SophosExclusionGapReport> {
    const res = await apiClient.get(`${BASE}/posture/exclusion-gaps`, { params: window });
    return res.data;
  },
};
