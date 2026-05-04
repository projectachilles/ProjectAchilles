// Frontend API client for Defender analytics endpoints.

import { apiClient } from '@/hooks/useAuthenticatedApi';

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

export interface AlertSummary {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  recentHigh: Array<{
    alert_id: string;
    title: string;
    severity: string;
    created_at: string;
    service_source: string;
  }>;
}

export interface AlertTrendPoint {
  date: string;
  count: number;
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
  recommended_actions: string;
}

export interface PaginatedAlerts {
  data: DefenderAlertItem[];
  total: number;
  page: number;
  pageSize: number;
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
  correlatedAlerts: number;
  detected: boolean;
}

export interface DetectionRateResponse {
  overall: {
    testedTechniques: number;
    detectedTechniques: number;
    detectionRate: number;
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
  async getAlertSummary(): Promise<AlertSummary> {
    const res = await apiClient.get('/analytics/defender/alerts/summary');
    return res.data;
  },

  async getAlerts(params?: {
    page?: number;
    pageSize?: number;
    severity?: string;
    status?: string;
    search?: string;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedAlerts> {
    const res = await apiClient.get('/analytics/defender/alerts', { params });
    return res.data;
  },

  async getAlertTrend(days = 30): Promise<AlertTrendPoint[]> {
    const res = await apiClient.get('/analytics/defender/alerts/trend', { params: { days } });
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

  // Cross-correlation
  async getScoreCorrelation(days = 90): Promise<ScoreComparisonPoint[]> {
    const res = await apiClient.get('/analytics/defender/correlation/scores', { params: { days } });
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
