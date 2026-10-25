// CrowdStrike analytics: the shared endpoint-EDR alert analytics
// (edr/alert-analytics.service.ts) over achilles-crowdstrike, plus the Zero
// Trust Assessment (ZTA) posture score, which only Falcon has.

import { EdrAlertAnalyticsService } from '../edr/alert-analytics.service.js';
import { CROWDSTRIKE_INDEX } from './index-management.js';

// Callers import the shared alert types from here; keep them available.
export * from '../edr/alert-analytics.service.js';

export interface ZtaScoreSummary {
  overallScore: number;
  osScore: number;
  sensorConfigScore: number;
  deviceCount: number;
  minScore: number;
  maxScore: number;
  timestamp: string | null;
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

export class CrowdStrikeAnalyticsService extends EdrAlertAnalyticsService {
  constructor() {
    super(CROWDSTRIKE_INDEX, 'crowdstrike');
  }

  /** The ZTA overall score beside the Defense Score (getScoreComparison). */
  protected override async getPostureScoreTrend(days: number): Promise<Array<{ date: string; score: number }>> {
    return this.getZtaScoreTrend(days);
  }

  // ── ZTA Score (CrowdStrike's Secure-Score equivalent) ─────────

  async getZtaScoreSummary(): Promise<ZtaScoreSummary> {
    const client = this.getEsClient();

    const result = await client.search({
      index: this.alertIndex,
      size: 1,
      query: { term: { doc_type: 'zta_score' } },
      sort: [{ timestamp: { order: 'desc' } }],
    });

    const hit = result.hits.hits[0];
    if (!hit) {
      return {
        overallScore: 0,
        osScore: 0,
        sensorConfigScore: 0,
        deviceCount: 0,
        minScore: 0,
        maxScore: 0,
        timestamp: null,
      };
    }

    const source = hit._source as Record<string, unknown>;

    return {
      overallScore: Number(source.overall_score ?? 0),
      osScore: Number(source.os_score ?? 0),
      sensorConfigScore: Number(source.sensor_config_score ?? 0),
      deviceCount: Number(source.device_count ?? 0),
      minScore: Number(source.min_score ?? 0),
      maxScore: Number(source.max_score ?? 0),
      timestamp: source.timestamp ? String(source.timestamp) : null,
    };
  }

  async getZtaScoreTrend(days: number): Promise<ZtaScoreTrendPoint[]> {
    const client = this.getEsClient();

    const result = await client.search({
      index: this.alertIndex,
      size: days,
      query: {
        bool: {
          must: [
            { term: { doc_type: 'zta_score' } },
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
        overallScore: Number(source.overall_score ?? 0),
        score: Number(source.overall_score ?? 0),
        osScore: Number(source.os_score ?? 0),
        sensorConfigScore: Number(source.sensor_config_score ?? 0),
        deviceCount: Number(source.device_count ?? 0),
      };
    });
  }
}
