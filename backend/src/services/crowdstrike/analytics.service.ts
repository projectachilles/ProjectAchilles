// CrowdStrike analytics service — queries the achilles-crowdstrike ES index
// for ZTA scores and alert data.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { CROWDSTRIKE_INDEX } from './index-management.js';
import { buildAlertTimeWindowQuery, buildCrowdStrikeEvidenceQuery } from './evidence-correlation.js';
import { attackSimulationExclusions } from '../analytics/attack-simulation-filter.js';
import { projectAlertHit } from '../alerts/alertHit.js';
import { trendInterval, windowRange } from '../analytics/integration-window.js';
import { alertDocs, alertFacets, allOf, LINKED, firstString, severityFilter, sourceFilter } from '../analytics/alert-facets.js';
import type { AlertFacetCounts, AlertSource, TimeWindow } from '../analytics/integration-window.js';
import { resolveTestNames } from '../analytics/test-name-lookup.js';
import { getTechniqueCoverage } from '../analytics/technique-coverage.js';
import type { CoverageVendor, TechniqueCoverageResponse } from '../analytics/technique-coverage.js';
import type { Client } from '@elastic/elasticsearch';
import type {
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types.js';
import { isAchillesMitigated, ACHILLES_MITIGATED_QUERY } from '../shared/achillesMitigation.js';
import type { DetectionRateResponse, RelatedAlertsResponse } from '../../types/crowdstrike.js';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

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

interface RecentAlert {
  alert_id: string;
  title: string;
  severity: string;
  created_at: string;
  service_source: string;
  product: string;
}

export interface AlertSummary {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  /** Most recent critical+high alerts (CrowdStrike's top severity tiers). */
  recentHigh: RecentAlert[];
  recentMedium: RecentAlert[];
  /** Facet counts for the hero tiles, over the same window. */
  counts: AlertFacetCounts;
}

export interface AlertTrendPoint {
  date: string;
  count: number;
  /** Alerts the enrichment pass matched to an Achilles test. */
  linked: number;
  /** Bucket width of the series. */
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
  category: string;
  service_source: string;
  mitre_techniques: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  recommended_actions: string;
  auto_resolved?: boolean;
  auto_resolved_at?: string | null;
  auto_resolve_mode?: 'disabled' | 'dry_run' | 'enabled' | null;
  /** First of evidence_hostnames, or null. */
  hostname: string | null;
  /** quarantined | process_killed | blocked | kill_failed; absent when Falcon only detected. */
  prevention_action?: string;
  pattern_disposition_description?: string;
  /** Deep link to the alert in the Falcon console. */
  portal_url?: string;
  /** True when the enrichment pass matched this alert to an Achilles test. */
  achilles_correlated: boolean;
  achilles_test_uuid?: string;
  /** Display name of the matched test or bundle, when it can be resolved. */
  achilles_test_name?: string;
  /** 'bundle' when achilles_test_uuid is a bundle (name = bundle_name), else 'test'. */
  achilles_test_kind?: 'test' | 'bundle';
}

export interface ScoreComparisonPoint {
  date: string;
  defenseScore: number | null;
  ztaScore: number | null;
}

export interface TechniqueOverlapItem {
  technique: string;
  testResults: number;
  crowdstrikeAlerts: number;
}

export interface PaginatedAlerts {
  data: CrowdStrikeAlertItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Facet counts for the filter segments and summary strip. */
  counts: AlertFacetCounts;
}

/** prevention_action values meaning Falcon stopped the activity. */
const PREVENTED_ACTIONS = ['quarantined', 'process_killed', 'blocked'];


// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CrowdStrikeAnalyticsService {
  /**
   * `alertIndex` / `vendor` default to CrowdStrike. SentinelOne reuses this
   * service over achilles-sentinelone, whose alert docs share the same shape
   * (see services/sentinelone/analytics.service.ts).
   */
  /** Treat alerts carrying an Achilles auto-mitigation receipt as detected only. */
  protected readonly ignoreAchillesMitigated: boolean = false;

  constructor(
    protected readonly alertIndex: string = CROWDSTRIKE_INDEX,
    protected readonly vendor: CoverageVendor = 'crowdstrike',
  ) {}

  private getEsContext() {
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();
    if (!settings.configured) {
      throw new Error('Elasticsearch is not configured');
    }
    return { client: createEsClient(settings), settings };
  }

  private getEsClient(): Client {
    return this.getEsContext().client;
  }

  /** Facet aggregations for the alert feed; see alert-facets.ts. */
  private alertFacets(filters: { source?: AlertSource; window: TimeWindow | null }) {
    return alertFacets({
      ...filters,
      closedStatuses: ['closed', 'resolved'],
      vendorFacet: {
        key: 'prevention',
        agg: {
          filters: {
            filters: {
              ...(this.ignoreAchillesMitigated
                ? {
                  prevented: { bool: { filter: [{ terms: { prevention_action: PREVENTED_ACTIONS } }], must_not: [ACHILLES_MITIGATED_QUERY] } },
                  detected_only: {
                    bool: {
                      should: [{ bool: { must_not: [{ exists: { field: 'prevention_action' } }] } }, ACHILLES_MITIGATED_QUERY],
                      minimum_should_match: 1,
                    },
                  },
                  // Keeps the buckets disjoint: a receipt-carrying alert counts only as detected_only.
                  kill_failed: { bool: { filter: [{ term: { prevention_action: 'kill_failed' } }], must_not: [ACHILLES_MITIGATED_QUERY] } },
                }
                : {
                  prevented: { terms: { prevention_action: PREVENTED_ACTIONS } },
                  detected_only: { bool: { must_not: [{ exists: { field: 'prevention_action' } }] } },
                  kill_failed: { term: { prevention_action: 'kill_failed' } },
                }),
            },
          },
        },
        read: (response) => {
          const buckets = (response as { buckets?: Record<string, { doc_count?: number } | undefined> } | undefined)?.buckets;
          return {
            byPrevention: {
              prevented: buckets?.prevented?.doc_count ?? 0,
              detected_only: buckets?.detected_only?.doc_count ?? 0,
              kill_failed: buckets?.kill_failed?.doc_count ?? 0,
            },
          };
        },
      },
    });
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

  // ── Alerts ───────────────────────────────────────────────────

  async getAlertSummary(window: TimeWindow | null = null): Promise<AlertSummary> {
    const client = this.getEsClient();
    const range = windowRange('created_at', window);
    const facets = this.alertFacets({ window });

    const result = await client.search({
      index: this.alertIndex,
      size: 0,
      query: alertDocs(window),
      aggs: {
        by_severity: { terms: { field: 'severity', size: 10 } },
        by_status: { terms: { field: 'status', size: 10 } },
        ...facets.aggs,
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

    // Two parallel searches: recent critical+high + recent medium. Listed in
    // the UI side-by-side so an analyst can scan both severity tiers without
    // jumping into the full alerts drawer.
    const mapHit = (hit: { _source?: unknown }): RecentAlert => {
      const s = (hit._source as Record<string, unknown>) ?? {};
      return {
        alert_id: String(s.alert_id ?? ''),
        title: String(s.alert_title ?? ''),
        severity: String(s.severity ?? ''),
        created_at: String(s.created_at ?? ''),
        service_source: String(s.service_source ?? ''),
        product: String(s.category ?? ''),
      };
    };

    const recentBySeverity = async (severities: string[], size: number) => {
      const resp = await client.search({
        index: this.alertIndex,
        size,
        query: {
          bool: {
            must: [
              { term: { doc_type: 'alert' } },
              ...(range ? [range] : []),
              { terms: { severity: severities } },
            ],
          },
        },
        sort: [{ created_at: { order: 'desc' } }],
      });
      return resp.hits.hits.map(mapHit);
    };

    const [recentHigh, recentMedium] = await Promise.all([
      recentBySeverity(['critical', 'high'], 5),
      recentBySeverity(['medium'], 5),
    ]);

    return {
      total,
      bySeverity,
      byStatus,
      recentHigh,
      recentMedium,
      counts: facets.read(result.aggregations),
    };
  }

  async getAlerts(params: {
    page?: number;
    pageSize?: number;
    severity?: string;
    status?: string;
    search?: string;
    /** MITRE techniques to OR-filter on. Each entry matches itself + sub-techniques. */
    techniques?: string[];
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
    /** Linked (test) vs organic alerts; 'all' or absent = no filter. */
    source?: AlertSource;
    /** Severities to OR-filter on. Unlike `severity`, this leaves the severity facet unfiltered. */
    severities?: string[];
    /** created_at window; null or absent = all time. */
    window?: TimeWindow | null;
    /** Exact `source_type` (SentinelOne: threats | cloud_detection_alerts). CrowdStrike docs don't carry it. */
    sourceType?: string;
  }): Promise<PaginatedAlerts> {
    const { client, settings } = this.getEsContext();
    const {
      page = 1, pageSize = 25, severity, status, search, techniques,
      sortField = 'created_at', sortOrder = 'desc', source, severities, window = null, sourceType,
    } = params;

    const must: QueryDslQueryContainer[] = [{ term: { doc_type: 'alert' } }];
    const range = windowRange('created_at', window);
    if (range) must.push(range);
    if (severity) must.push({ term: { severity } });
    if (status) must.push({ term: { status } });
    if (sourceType) must.push({ term: { source_type: sourceType } });
    if (search) must.push({ multi_match: { query: search, fields: ['alert_title', 'description', 'category'] } });
    if (techniques && techniques.length > 0) {
      // Match exact technique (e.g. T1059) and any sub-technique (T1059.001, T1059.003 …)
      // without false-positives like T10590. The trailing dot in the prefix is load-bearing.
      const should: QueryDslQueryContainer[] = techniques.flatMap((t) => [
        { term: { mitre_techniques: t } },
        { prefix: { mitre_techniques: `${t}.` } },
      ]);
      must.push({ bool: { should, minimum_should_match: 1 } });
    }

    // Source and severity filter the hits through post_filter so the facet
    // aggregations still see the alerts those filters exclude.
    const sourceClause = sourceFilter(source);
    const severityClause = severityFilter(severities);
    const facets = this.alertFacets({ source, window });

    const result = await client.search({
      index: this.alertIndex,
      from: (page - 1) * pageSize,
      size: pageSize,
      query: { bool: { must } },
      ...(sourceClause || severityClause ? { post_filter: allOf(sourceClause, severityClause) } : {}),
      aggs: facets.aggs,
      sort: [{ [sortField]: { order: sortOrder } }],
    });

    const total = typeof result.hits.total === 'number'
      ? result.hits.total
      : (result.hits.total as { value: number })?.value ?? 0;

    const sources = result.hits.hits.map((hit) => (hit._source as Record<string, unknown>) ?? {});
    const testUuids = new Set<string>();
    for (const s of sources) {
      const uuid = (s.f0rtika as Record<string, unknown> | undefined)?.achilles_test_uuid;
      if (typeof uuid === 'string' && uuid) testUuids.add(uuid);
    }
    const testNames = await resolveTestNames(client, settings.indexPattern, [...testUuids]);

    const data = sources.map((s) => {
      const f0rtika = (s.f0rtika as Record<string, unknown> | undefined) ?? {};
      const testUuid = typeof f0rtika.achilles_test_uuid === 'string' && f0rtika.achilles_test_uuid
        ? f0rtika.achilles_test_uuid
        : undefined;
      const linked = testUuid ? testNames.get(testUuid) : undefined;
      const item: CrowdStrikeAlertItem = {
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
        hostname: firstString(s.evidence_hostnames),
        ...(s.prevention_action && !(this.ignoreAchillesMitigated && isAchillesMitigated({ f0rtika })) ? { prevention_action: String(s.prevention_action) } : {}),
        ...(s.pattern_disposition_description
          ? { pattern_disposition_description: String(s.pattern_disposition_description) }
          : {}),
        ...(s.portal_url ? { portal_url: String(s.portal_url) } : {}),
        achilles_correlated: f0rtika.achilles_correlated === true,
        ...(testUuid ? { achilles_test_uuid: testUuid } : {}),
        ...(linked ? { achilles_test_name: linked.name, achilles_test_kind: linked.kind } : {}),
      };
      if (typeof f0rtika.auto_resolved === 'boolean') {
        item.auto_resolved = f0rtika.auto_resolved;
        item.auto_resolved_at = f0rtika.auto_resolved_at ? String(f0rtika.auto_resolved_at) : null;
        const mode = f0rtika.auto_resolve_mode;
        item.auto_resolve_mode =
          mode === 'disabled' || mode === 'dry_run' || mode === 'enabled' ? mode : null;
      }
      return item;
    });

    return { data, total, page, pageSize, counts: facets.read(result.aggregations) };
  }

  async getAlertTrend(days: number, window: TimeWindow | null = null): Promise<AlertTrendPoint[]> {
    const client = this.getEsClient();

    const interval = window ? trendInterval(window) : 'day';

    const result = await client.search({
      index: this.alertIndex,
      size: 0,
      query: window
        ? alertDocs(window)
        : {
            bool: {
              must: [
                { term: { doc_type: 'alert' } },
                { range: { created_at: { gte: `now-${days}d/d` } } },
              ],
            },
          },
      aggs: {
        by_day: {
          date_histogram: { field: 'created_at', calendar_interval: interval },
          aggs: {
            linked: { filter: LINKED },
            critical: { filter: { term: { severity: 'critical' } } },
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
      linked: { doc_count: number };
      critical: { doc_count: number };
      high: { doc_count: number };
      medium: { doc_count: number };
      low: { doc_count: number };
    }>) ?? [];

    return buckets.map((b) => ({
      date: b.key_as_string,
      count: b.doc_count,
      linked: b.linked?.doc_count ?? 0,
      interval,
      critical: b.critical.doc_count,
      high: b.high.doc_count,
      medium: b.medium.doc_count,
      low: b.low.doc_count,
    }));
  }

  // ── Cross-correlation ────────────────────────────────────────

  async getScoreComparison(days: number): Promise<ScoreComparisonPoint[]> {
    const client = this.getEsClient();
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();

    // Get ZTA score trend (overall score is already 0–100)
    const ztaScores = await this.getZtaScoreTrend(days);
    const ztaMap = new Map(ztaScores.map((s) => [s.date.split('T')[0], s.score]));

    // Get Defense Score trend from the results index — attack simulations
    // only, so it lines up with the rest of the CrowdStrike tab.
    const defenseResult = await client.search({
      index: settings.indexPattern,
      size: 0,
      query: {
        bool: {
          must: [{ range: { 'routing.event_time': { gte: `now-${days}d/d` } } }],
          must_not: attackSimulationExclusions(),
        },
      },
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
    const allDates = new Set([...ztaMap.keys(), ...defenseMap.keys()]);
    return Array.from(allDates)
      .sort()
      .map((date) => ({
        date,
        defenseScore: defenseMap.get(date) ?? null,
        ztaScore: ztaMap.get(date) ?? null,
      }));
  }

  async getTechniqueOverlap(): Promise<TechniqueOverlapItem[]> {
    const client = this.getEsClient();
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();

    // Get MITRE techniques from test results — attack simulations only,
    // so the overlap matches the rest of the CrowdStrike tab.
    const testResult = await client.search({
      index: settings.indexPattern,
      size: 0,
      query: { bool: { must_not: attackSimulationExclusions() } },
      aggs: {
        techniques: { terms: { field: 'f0rtika.techniques', size: 100 } },
      },
    });

    const testAggs = testResult.aggregations as Record<string, unknown>;
    const testBuckets = ((testAggs?.techniques as Record<string, unknown>)?.buckets as Array<{
      key: string;
      doc_count: number;
    }>) ?? [];

    // Get MITRE techniques from CrowdStrike alerts
    const alertResult = await client.search({
      index: this.alertIndex,
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
        crowdstrikeAlerts: alertMap.get(technique) ?? 0,
      }))
      .filter((item) => item.testResults > 0 && item.crowdstrikeAlerts > 0)
      .sort((a, b) => (b.testResults + b.crowdstrikeAlerts) - (a.testResults + a.crowdstrikeAlerts));
  }

  // ── Detection correlation ───────────────────────────────────

  /**
   * Evidence-based technique coverage: per-execution Detected / Prevented /
   * Missed from the enrichment-written Falcon flags on test docs, plus
   * Falcon alert counts per tested technique. Drives the tab's Detection
   * tile and Technique Coverage table. See analytics/technique-coverage.ts.
   */
  async getTechniqueCoverage(window: TimeWindow): Promise<TechniqueCoverageResponse> {
    const { client, settings } = this.getEsContext();
    return getTechniqueCoverage(client, {
      vendor: this.vendor,
      resultsIndex: settings.indexPattern,
      alertIndex: this.alertIndex,
      window,
    });
  }

  /**
   * Per-execution CrowdStrike detection rate: the share of attack-simulation
   * test executions that have a temporally-correlated Falcon alert.
   * See docs/crowdstrike-detection-rate.md for the metric definition,
   * MITRE roll-up semantics, and known approximations.
   */
  async getDetectionRate(days: number, windowMinutes: number): Promise<DetectionRateResponse> {
    const client = this.getEsClient();
    const settingsService = new SettingsService();
    const settings = settingsService.getSettings();

    // Query 1: test executions by technique with hourly buckets,
    // restricted to genuine attack simulations (see
    // attackSimulationExclusions).
    const testResult = await client.search({
      index: settings.indexPattern,
      size: 0,
      query: {
        bool: {
          must: [{ range: { 'routing.event_time': { gte: `now-${days}d/d` } } }],
          must_not: attackSimulationExclusions(),
        },
      },
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

    // Query 2: CrowdStrike alerts by technique with hourly buckets
    const alertResult = await client.search({
      index: this.alertIndex,
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

    // Resolve the alert-hour set for a tested technique, applying MITRE
    // roll-up: a sub-technique test (e.g. T1574.002) is satisfied by an
    // alert tagged with its parent (T1574), because the sub-technique is
    // a specialization of the parent and Falcon frequently tags alerts
    // at parent granularity only. Roll-up is one-directional — a parent
    // test is NOT credited by a sibling sub-technique's alert, since that
    // would attribute detection of one specific behavior to a different
    // one.
    const rolledUpAlertHours = (technique: string): Set<number> => {
      const direct = alertHoursByTechnique.get(technique);
      const dot = technique.indexOf('.');
      const parentHours = dot > 0
        ? alertHoursByTechnique.get(technique.slice(0, dot))
        : undefined;
      if (!parentHours) return direct ?? new Set<number>();
      if (!direct) return parentHours;
      return new Set<number>([...direct, ...parentHours]);
    };

    // For each tested technique, sum the executions in test-hours that
    // fall within ±windowMinutes of a (rolled-up) alert hour.
    const byTechnique = testTechniques.map((testBucket) => {
      const technique = testBucket.key;
      const alertHours = rolledUpAlertHours(technique);
      let correlatedExecutions = 0;

      if (alertHours.size > 0) {
        const alertTimestamps = Array.from(alertHours).sort((a, b) => a - b);
        for (const testHour of testBucket.by_hour.buckets) {
          if (testHour.doc_count === 0) continue;
          for (const alertTs of alertTimestamps) {
            if (Math.abs(testHour.key - alertTs) <= windowMs) {
              correlatedExecutions += testHour.doc_count;
              break;
            }
          }
        }
      }

      return {
        technique,
        testExecutions: testBucket.doc_count,
        correlatedExecutions,
        detected: correlatedExecutions > 0,
      };
    });

    // Sort: detected first, then by test execution count desc
    byTechnique.sort((a, b) => {
      if (a.detected !== b.detected) return a.detected ? -1 : 1;
      return b.testExecutions - a.testExecutions;
    });

    const totalExecutions = byTechnique.reduce((sum, t) => sum + t.testExecutions, 0);
    const correlatedExecutions = byTechnique.reduce((sum, t) => sum + t.correlatedExecutions, 0);
    const detectionRate = totalExecutions > 0
      ? Math.round((correlatedExecutions / totalExecutions) * 1000) / 10
      : 0;
    const testedTechniques = byTechnique.length;
    const detectedTechniques = byTechnique.filter((t) => t.detected).length;

    return {
      overall: {
        detectionRate,
        totalExecutions,
        correlatedExecutions,
        testedTechniques,
        detectedTechniques,
      },
      byTechnique,
    };
  }

  /**
   * Find CrowdStrike alerts correlated to a specific test execution.
   *
   * Primary match: alert evidence contains the test binary filename AND
   * originated from the same hostname, within 0 to +windowMinutes after test.
   *
   * Fallback: if no evidence-based matches, falls back to MITRE technique
   * matching on the same hostname within the time window, then technique-only.
   */
  async getAlertsForTest(
    techniques: string[],
    timestamp: string,
    windowMinutes: number,
    hostname?: string,
    binaryName?: string,
    bundleName?: string,
  ): Promise<RelatedAlertsResponse> {
    const client = this.getEsClient();

    const testTime = new Date(timestamp).getTime();
    const windowMs = windowMinutes * 60 * 1000;
    // Alerts can be generated DURING execution (before completed_at) as Falcon
    // processes telemetry in real-time. Start 5 minutes before test completion
    // to catch alerts triggered mid-execution.
    const PRE_WINDOW_MS = 5 * 60 * 1000;
    const from = new Date(testTime - PRE_WINDOW_MS).toISOString();
    const to = new Date(testTime + windowMs).toISOString();

    // Bundle UUID for stage-attribution classification. Derived from the
    // caller-supplied binaryName (`<uuid>.exe`) so we can recognize when an
    // alert's evidence references a SPECIFIC stage binary
    // (`<uuid>-<technique>.exe`) belonging to THIS bundle vs only the
    // orchestrator UUID-only binary, vs no UUID-prefixed evidence at all.
    // When binaryName isn't provided (technique-only fallback), every alert
    // is classified as 'bundle' — the safe default with no discriminator.
    const bundleUuidForAttribution = binaryName
      ? binaryName.toLowerCase().replace(/\.exe$/, '')
      : '';

    const parseHits = (hits: any[]) => {
      const matchedTechniqueSet = new Set<string>();
      const alerts = hits.map((hit) => {
        const s = hit._source as Record<string, unknown>;
        const alertTechniques = (s.mitre_techniques as string[]) ?? [];
        for (const t of alertTechniques) {
          if (techniques.includes(t)) matchedTechniqueSet.add(t);
        }
        return projectAlertHit(s, bundleUuidForAttribution);
      });
      // Sort by proximity to the test execution timestamp
      alerts.sort((a, b) => {
        const aDiff = Math.abs(new Date(a.created_at).getTime() - testTime);
        const bDiff = Math.abs(new Date(b.created_at).getTime() - testTime);
        return aDiff - bDiff;
      });
      return { alerts, matchedTechniques: Array.from(matchedTechniqueSet) };
    };

    // --- Primary: evidence-based correlation via the shared helper ---
    // Delegates to buildCrowdStrikeEvidenceQuery — the SAME query the
    // enrichment pass uses to write f0rtika.crowdstrike_detected. Single
    // source of truth: badges and drill-down agree by construction.
    // The helper emits should[bare, .keyword] for portability across
    // mapping shapes, and (when bundleName is provided) adds filepath
    // bundle-name-token wildcards that recover AV-only alerts whose
    // evidence carries only a sandbox-dir filepath.
    if (binaryName && hostname) {
      // The helper's binary matcher is `<bundleUuid>*`; the frontend sends
      // binaryName as `<bundleUuid>.exe`, so strip `.exe` to get the UUID.
      const bundleUuid = binaryName.toLowerCase().replace(/\.exe$/, '');
      const evidenceQuery = buildCrowdStrikeEvidenceQuery({
        test_uuid: bundleUuid,
        routing_event_time: timestamp,
        routing_hostname: hostname,
        bundle_name: bundleName,
      });

      if (evidenceQuery) {
        const evidenceResult = await client.search({
          index: this.alertIndex,
          size: 50,
          query: evidenceQuery as QueryDslQueryContainer,
          sort: [{ created_at: { order: 'asc' } }],
        });

        const evidenceTotal = typeof evidenceResult.hits.total === 'number'
          ? evidenceResult.hits.total
          : evidenceResult.hits.total?.value ?? 0;

        if (evidenceTotal > 0) {
          const { alerts, matchedTechniques } = parseHits(evidenceResult.hits.hits);
          return { alerts, matchedTechniques, total: evidenceTotal };
        }
      }
    }

    // --- Fallback 1: technique + hostname (via evidence) ---
    if (hostname) {
      const hostFallbackResult = await client.search({
        index: this.alertIndex,
        size: 50,
        query: {
          bool: {
            must: [
              { term: { doc_type: 'alert' } },
              { terms: { mitre_techniques: techniques } },
              {
                bool: {
                  should: [
                    { wildcard: { 'evidence_hostnames':         { value: `${hostname.toUpperCase()}*` } } },
                    { wildcard: { 'evidence_hostnames.keyword': { value: `${hostname.toUpperCase()}*` } } },
                  ],
                  minimum_should_match: 1,
                },
              },
              buildAlertTimeWindowQuery(from, to),
            ],
          },
        },
        sort: [{ created_at: { order: 'asc' } }],
      });

      const hostTotal = typeof hostFallbackResult.hits.total === 'number'
        ? hostFallbackResult.hits.total
        : hostFallbackResult.hits.total?.value ?? 0;

      if (hostTotal > 0) {
        const { alerts, matchedTechniques } = parseHits(hostFallbackResult.hits.hits);
        return { alerts, matchedTechniques, total: hostTotal };
      }
    }

    // --- Fallback 2: technique-only, host-scoped when the host is known ---
    // When the caller provides a hostname, keep the hostname constraint even
    // in this last-resort tier: during fleet-wide simultaneous runs, an
    // unscoped technique+window match would associate sibling hosts' alerts
    // with this test (cross-host false positives). Only a genuinely
    // host-less call (no hostname parameter at all) stays technique-only.
    const techniqueMust: QueryDslQueryContainer[] = [
      { term: { doc_type: 'alert' } },
      { terms: { mitre_techniques: techniques } },
      buildAlertTimeWindowQuery(from, to),
    ];
    if (hostname) {
      techniqueMust.push({
        bool: {
          should: [
            { wildcard: { 'evidence_hostnames':         { value: `${hostname.toUpperCase()}*` } } },
            { wildcard: { 'evidence_hostnames.keyword': { value: `${hostname.toUpperCase()}*` } } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    const techniqueFallbackResult = await client.search({
      index: this.alertIndex,
      size: 50,
      query: {
        bool: {
          must: techniqueMust,
        },
      },
      sort: [{ created_at: { order: 'asc' } }],
    });

    const techniqueTotal = typeof techniqueFallbackResult.hits.total === 'number'
      ? techniqueFallbackResult.hits.total
      : techniqueFallbackResult.hits.total?.value ?? 0;

    const { alerts, matchedTechniques } = parseHits(techniqueFallbackResult.hits.hits);
    return { alerts, matchedTechniques, total: techniqueTotal };
  }
}
