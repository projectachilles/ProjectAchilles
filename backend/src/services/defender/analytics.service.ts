// Defender analytics service — queries the achilles-defender ES index
// for Secure Score, alerts, and control profile data.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { DEFENDER_INDEX } from './index-management.js';
import type { Client } from '@elastic/elasticsearch';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';
import type { DetectionRateResponse, RelatedAlertsResponse } from '../../types/defender.js';

// ---------------------------------------------------------------------------
// Response types
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

export interface PaginatedAlerts {
  data: DefenderAlertItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DefenderAnalyticsService {
  private getEsClient(): Client {
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();
    if (!settings.configured) {
      throw new Error('Elasticsearch is not configured');
    }
    return createEsClient(settings);
  }

  // ── Secure Score ─────────────────────────────────────────────

  async getCurrentSecureScore(): Promise<SecureScoreSummary> {
    const client = this.getEsClient();

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: 1,
      query: { term: { doc_type: 'secure_score' } },
      sort: [{ timestamp: { order: 'desc' } }],
    });

    const hit = result.hits.hits[0];
    if (!hit) {
      return {
        currentScore: 0,
        maxScore: 0,
        percentage: 0,
        averageComparative: null,
      };
    }

    const source = hit._source as Record<string, unknown>;

    return {
      currentScore: Number(source.current_score ?? 0),
      maxScore: Number(source.max_score ?? 0),
      percentage: Number(source.score_percentage ?? 0),
      averageComparative: source.average_comparative_score != null
        ? Number(source.average_comparative_score)
        : null,
    };
  }

  async getSecureScoreTrend(days: number): Promise<SecureScoreTrendPoint[]> {
    const client = this.getEsClient();

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: days,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'secure_score' } },
            { range: { timestamp: { gte: `now-${days}d/d` } } },
          ],
        },
      },
      sort: [{ timestamp: { order: 'asc' } }],
    });

    return result.hits.hits.map((hit) => {
      const source = hit._source as Record<string, unknown>;
      return {
        date: String(source.timestamp ?? ''),
        score: Number(source.current_score ?? 0),
        maxScore: Number(source.max_score ?? 0),
        percentage: Number(source.score_percentage ?? 0),
      };
    });
  }

  // ── Alerts ───────────────────────────────────────────────────

  async getAlertSummary(): Promise<AlertSummary> {
    const client = this.getEsClient();

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: 0,
      query: { term: { doc_type: 'alert' } },
      aggs: {
        by_severity: { terms: { field: 'severity', size: 10 } },
        by_status: { terms: { field: 'status', size: 10 } },
      },
    });

    const aggs = result.aggregations as Record<string, unknown>;

    const bySeverity: Record<string, number> = {};
    const severityBuckets = ((aggs?.by_severity as Record<string, unknown>)?.buckets as Array<{ key: string; doc_count: number }>) ?? [];
    for (const b of severityBuckets) {
      bySeverity[b.key] = b.doc_count;
    }

    const byStatus: Record<string, number> = {};
    const statusBuckets = ((aggs?.by_status as Record<string, unknown>)?.buckets as Array<{ key: string; doc_count: number }>) ?? [];
    for (const b of statusBuckets) {
      byStatus[b.key] = b.doc_count;
    }

    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : (result.hits.total as { value: number })?.value ?? 0;

    // Fetch top 3 recent high alerts
    const highAlerts = await client.search({
      index: DEFENDER_INDEX,
      size: 3,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'alert' } },
            { term: { severity: 'high' } },
          ],
        },
      },
      sort: [{ created_at: { order: 'desc' } }],
    });

    const recentHigh = highAlerts.hits.hits.map((hit) => {
      const s = hit._source as Record<string, unknown>;
      return {
        alert_id: String(s.alert_id ?? ''),
        title: String(s.alert_title ?? ''),
        severity: String(s.severity ?? ''),
        created_at: String(s.created_at ?? ''),
        service_source: String(s.service_source ?? ''),
      };
    });

    return { total, bySeverity, byStatus, recentHigh };
  }

  async getAlerts(params: {
    page?: number;
    pageSize?: number;
    severity?: string;
    status?: string;
    search?: string;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedAlerts> {
    const client = this.getEsClient();
    const { page = 1, pageSize = 25, severity, status, search, sortField = 'created_at', sortOrder = 'desc' } = params;

    const must: QueryDslQueryContainer[] = [{ term: { doc_type: 'alert' } }];
    if (severity) must.push({ term: { severity } });
    if (status) must.push({ term: { status } });
    if (search) must.push({ multi_match: { query: search, fields: ['alert_title', 'description', 'category'] } });

    const result = await client.search({
      index: DEFENDER_INDEX,
      from: (page - 1) * pageSize,
      size: pageSize,
      query: { bool: { must } },
      sort: [{ [sortField]: { order: sortOrder } }],
    });

    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : (result.hits.total as { value: number })?.value ?? 0;

    const data = result.hits.hits.map((hit) => {
      const s = hit._source as Record<string, unknown>;
      return {
        alert_id: String(s.alert_id ?? ''),
        alert_title: String(s.alert_title ?? ''),
        description: String(s.description ?? ''),
        severity: String(s.severity ?? ''),
        status: String(s.status ?? ''),
        category: String(s.category ?? ''),
        service_source: String(s.service_source ?? ''),
        mitre_techniques: (s.mitre_techniques as string[]) ?? [],
        created_at: String(s.created_at ?? ''),
        updated_at: String(s.updated_at ?? ''),
        resolved_at: s.resolved_at ? String(s.resolved_at) : null,
        recommended_actions: String(s.recommended_actions ?? ''),
      };
    });

    return { data, total, page, pageSize };
  }

  async getAlertTrend(days: number): Promise<AlertTrendPoint[]> {
    const client = this.getEsClient();

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: 0,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'alert' } },
            { range: { created_at: { gte: `now-${days}d/d` } } },
          ],
        },
      },
      aggs: {
        by_day: {
          date_histogram: { field: 'created_at', calendar_interval: 'day' },
          aggs: {
            high: { filter: { term: { severity: 'high' } } },
            medium: { filter: { term: { severity: 'medium' } } },
            low: { filter: { term: { severity: 'low' } } },
          },
        },
      },
    });

    const aggs = result.aggregations as Record<string, unknown>;
    const buckets = ((aggs?.by_day as Record<string, unknown>)?.buckets as Array<{
      key_as_string: string;
      doc_count: number;
      high: { doc_count: number };
      medium: { doc_count: number };
      low: { doc_count: number };
    }>) ?? [];

    return buckets.map((b) => ({
      date: b.key_as_string,
      count: b.doc_count,
      high: b.high.doc_count,
      medium: b.medium.doc_count,
      low: b.low.doc_count,
    }));
  }

  // ── Controls ─────────────────────────────────────────────────

  async getControlProfiles(params?: {
    category?: string;
    deprecated?: boolean;
  }): Promise<ControlItem[]> {
    const client = this.getEsClient();
    const must: QueryDslQueryContainer[] = [{ term: { doc_type: 'control_profile' } }];
    if (params?.category) must.push({ term: { control_category: params.category } });
    if (params?.deprecated !== undefined) must.push({ term: { deprecated: params.deprecated } });

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: 200,
      query: { bool: { must } },
      sort: [{ rank: { order: 'asc' } }],
    });

    return result.hits.hits.map((hit) => {
      const s = hit._source as Record<string, unknown>;
      return {
        control_name: String(s.control_name ?? ''),
        control_category: String(s.control_category ?? ''),
        title: String(s.title ?? ''),
        implementation_cost: String(s.implementation_cost ?? ''),
        user_impact: String(s.user_impact ?? ''),
        rank: Number(s.rank ?? 0),
        threats: (s.threats as string[]) ?? [],
        deprecated: Boolean(s.deprecated),
        remediation_summary: String(s.remediation_summary ?? ''),
        action_url: String(s.action_url ?? ''),
        max_score: Number(s.max_score ?? 0),
        tier: String(s.tier ?? ''),
      };
    });
  }

  async getControlsByCategory(): Promise<ControlCategoryBreakdown[]> {
    const client = this.getEsClient();

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: 0,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'control_profile' } },
            { term: { deprecated: false } },
          ],
        },
      },
      aggs: {
        by_category: {
          terms: { field: 'control_category', size: 20 },
          aggs: {
            total_max_score: { sum: { field: 'max_score' } },
          },
        },
      },
    });

    const aggs = result.aggregations as Record<string, unknown>;
    const buckets = ((aggs?.by_category as Record<string, unknown>)?.buckets as Array<{
      key: string;
      doc_count: number;
      total_max_score: { value: number };
    }>) ?? [];

    return buckets.map((b) => ({
      category: b.key,
      count: b.doc_count,
      totalMaxScore: b.total_max_score.value,
    }));
  }

  // ── Cross-correlation ────────────────────────────────────────

  async getDefenseVsSecureScore(days: number): Promise<ScoreComparisonPoint[]> {
    const client = this.getEsClient();
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();

    // Get Secure Score trend
    const secureScores = await this.getSecureScoreTrend(days);
    const secureMap = new Map(secureScores.map((s) => [s.date.split('T')[0], s.percentage]));

    // Get Defense Score trend from the results index
    const defenseResult = await client.search({
      index: settings.indexPattern,
      size: 0,
      query: { range: { 'routing.event_time': { gte: `now-${days}d/d` } } },
      aggs: {
        by_day: {
          date_histogram: { field: 'routing.event_time', calendar_interval: 'day' },
          aggs: {
            protected: { filter: { term: { 'f0rtika.is_protected': true } } },
          },
        },
      },
    });

    const defenseAggs = defenseResult.aggregations as Record<string, unknown>;
    const defenseBuckets = ((defenseAggs?.by_day as Record<string, unknown>)?.buckets as Array<{
      key_as_string: string;
      doc_count: number;
      protected: { doc_count: number };
    }>) ?? [];

    const defenseMap = new Map(defenseBuckets.map((b) => {
      const date = b.key_as_string.split('T')[0];
      const score = b.doc_count > 0 ? (b.protected.doc_count / b.doc_count) * 100 : null;
      return [date, score];
    }));

    // Merge dates
    const allDates = new Set([...secureMap.keys(), ...defenseMap.keys()]);
    return Array.from(allDates)
      .sort()
      .map((date) => ({
        date,
        defenseScore: defenseMap.get(date) ?? null,
        secureScore: secureMap.get(date) ?? null,
      }));
  }

  async getTechniqueOverlap(): Promise<TechniqueOverlapItem[]> {
    const client = this.getEsClient();
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();

    // Get MITRE techniques from test results
    const testResult = await client.search({
      index: settings.indexPattern,
      size: 0,
      aggs: {
        techniques: { terms: { field: 'f0rtika.techniques', size: 100 } },
      },
    });

    const testAggs = testResult.aggregations as Record<string, unknown>;
    const testBuckets = ((testAggs?.techniques as Record<string, unknown>)?.buckets as Array<{
      key: string;
      doc_count: number;
    }>) ?? [];

    // Get MITRE techniques from Defender alerts
    const alertResult = await client.search({
      index: DEFENDER_INDEX,
      size: 0,
      query: { term: { doc_type: 'alert' } },
      aggs: {
        techniques: { terms: { field: 'mitre_techniques', size: 100 } },
      },
    });

    const alertAggs = alertResult.aggregations as Record<string, unknown>;
    const alertBuckets = ((alertAggs?.techniques as Record<string, unknown>)?.buckets as Array<{
      key: string;
      doc_count: number;
    }>) ?? [];

    // Merge
    const testMap = new Map(testBuckets.map((b) => [b.key, b.doc_count]));
    const alertMap = new Map(alertBuckets.map((b) => [b.key, b.doc_count]));
    const allTechniques = new Set([...testMap.keys(), ...alertMap.keys()]);

    return Array.from(allTechniques)
      .map((technique) => ({
        technique,
        testResults: testMap.get(technique) ?? 0,
        defenderAlerts: alertMap.get(technique) ?? 0,
      }))
      .filter((item) => item.testResults > 0 && item.defenderAlerts > 0)
      .sort((a, b) => (b.testResults + b.defenderAlerts) - (a.testResults + a.defenderAlerts));
  }

  // ── Detection correlation ───────────────────────────────────

  async getDetectionRate(days: number, windowMinutes: number): Promise<DetectionRateResponse> {
    const client = this.getEsClient();
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();

    // Query 1: Test executions by technique with hourly buckets
    const testResult = await client.search({
      index: settings.indexPattern,
      size: 0,
      query: { range: { 'routing.event_time': { gte: `now-${days}d/d` } } },
      aggs: {
        techniques: {
          terms: { field: 'f0rtika.techniques', size: 100 },
          aggs: {
            by_hour: {
              date_histogram: { field: 'routing.event_time', fixed_interval: '1h' },
            },
          },
        },
      },
    });

    // Query 2: Defender alerts by technique with hourly buckets
    const alertResult = await client.search({
      index: DEFENDER_INDEX,
      size: 0,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'alert' } },
            { range: { created_at: { gte: `now-${days}d/d` } } },
          ],
        },
      },
      aggs: {
        techniques: {
          terms: { field: 'mitre_techniques', size: 100 },
          aggs: {
            by_hour: {
              date_histogram: { field: 'created_at', fixed_interval: '1h' },
            },
          },
        },
      },
    });

    type HourBucket = { key: number; doc_count: number };
    type TechniqueBucket = { key: string; doc_count: number; by_hour: { buckets: HourBucket[] } };

    const testAggs = testResult.aggregations as Record<string, unknown>;
    const testTechniques = ((testAggs?.techniques as Record<string, unknown>)?.buckets as TechniqueBucket[]) ?? [];

    const alertAggs = alertResult.aggregations as Record<string, unknown>;
    const alertTechniques = ((alertAggs?.techniques as Record<string, unknown>)?.buckets as TechniqueBucket[]) ?? [];

    // Build alert lookup: technique → set of hour keys (epoch ms)
    const alertHoursByTechnique = new Map<string, Set<number>>();
    for (const bucket of alertTechniques) {
      const hours = new Set<number>();
      for (const h of bucket.by_hour.buckets) {
        if (h.doc_count > 0) hours.add(h.key);
      }
      alertHoursByTechnique.set(bucket.key, hours);
    }

    const windowMs = windowMinutes * 60 * 1000;

    // For each tested technique, check temporal proximity with alerts
    const byTechnique = testTechniques.map((testBucket) => {
      const technique = testBucket.key;
      const alertHours = alertHoursByTechnique.get(technique);
      let correlatedAlerts = 0;

      if (alertHours && alertHours.size > 0) {
        const alertTimestamps = Array.from(alertHours).sort((a, b) => a - b);
        for (const testHour of testBucket.by_hour.buckets) {
          if (testHour.doc_count === 0) continue;
          // Check if any alert bucket falls within ±windowMinutes
          for (const alertTs of alertTimestamps) {
            if (Math.abs(testHour.key - alertTs) <= windowMs) {
              correlatedAlerts++;
              break;
            }
          }
        }
      }

      return {
        technique,
        testExecutions: testBucket.doc_count,
        correlatedAlerts,
        detected: correlatedAlerts > 0,
      };
    });

    // Sort: detected first, then by test execution count desc
    byTechnique.sort((a, b) => {
      if (a.detected !== b.detected) return a.detected ? -1 : 1;
      return b.testExecutions - a.testExecutions;
    });

    const testedTechniques = byTechnique.length;
    const detectedTechniques = byTechnique.filter((t) => t.detected).length;
    const detectionRate = testedTechniques > 0
      ? Math.round((detectedTechniques / testedTechniques) * 1000) / 10
      : 0;

    return {
      overall: { testedTechniques, detectedTechniques, detectionRate },
      byTechnique,
    };
  }

  async getAlertsForTest(
    techniques: string[],
    timestamp: string,
    windowMinutes: number,
  ): Promise<RelatedAlertsResponse> {
    const client = this.getEsClient();

    const testTime = new Date(timestamp).getTime();
    const windowMs = windowMinutes * 60 * 1000;
    const from = new Date(testTime - windowMs).toISOString();
    const to = new Date(testTime + windowMs).toISOString();

    const result = await client.search({
      index: DEFENDER_INDEX,
      size: 50,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'alert' } },
            { terms: { mitre_techniques: techniques } },
            { range: { created_at: { gte: from, lte: to } } },
          ],
        },
      },
      sort: [{ created_at: { order: 'asc' } }],
    });

    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : (result.hits.total as { value: number })?.value ?? 0;

    const matchedTechniqueSet = new Set<string>();

    const alerts = result.hits.hits.map((hit) => {
      const s = hit._source as Record<string, unknown>;
      const alertTechniques = (s.mitre_techniques as string[]) ?? [];
      for (const t of alertTechniques) {
        if (techniques.includes(t)) matchedTechniqueSet.add(t);
      }
      return {
        alert_id: String(s.alert_id ?? ''),
        alert_title: String(s.alert_title ?? ''),
        description: String(s.description ?? ''),
        severity: String(s.severity ?? ''),
        status: String(s.status ?? ''),
        category: String(s.category ?? ''),
        service_source: String(s.service_source ?? ''),
        mitre_techniques: alertTechniques,
        created_at: String(s.created_at ?? ''),
        updated_at: String(s.updated_at ?? ''),
        resolved_at: s.resolved_at ? String(s.resolved_at) : null,
        recommended_actions: String(s.recommended_actions ?? ''),
      };
    });

    // Sort by proximity to the test execution timestamp
    alerts.sort((a, b) => {
      const aDiff = Math.abs(new Date(a.created_at).getTime() - testTime);
      const bDiff = Math.abs(new Date(b.created_at).getTime() - testTime);
      return aDiff - bDiff;
    });

    return {
      alerts,
      matchedTechniques: Array.from(matchedTechniqueSet),
      total,
    };
  }
}
