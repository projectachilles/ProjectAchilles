// Elasticsearch service for analytics queries

import { Client } from '@elastic/elasticsearch';
import { RiskAcceptanceService } from '../risk-acceptance/risk-acceptance.service.js';
import { DEFENDER_INDEX } from '../defender/index-management.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import type {
  AnalyticsSettings,
  AnalyticsQueryParams,
  DefenseScoreResponse,
  TrendDataPoint,
  BreakdownItem,
  TestExecution,
  OrganizationInfo,
  OrgBreakdownItem,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  EnrichedTestExecution,
  PaginatedResponse,
  ExtendedAnalyticsQueryParams,
  PaginatedExecutionsParams,
  FilterOption,
  SeverityBreakdownItem,
  CategoryBreakdownItem,
  CategorySubcategoryBreakdownItem,
  SubcategoryBreakdownItem,
  ThreatActorCoverageItem,
  DefenseScoreByHostItem,
  CanonicalTestCountResponse,
  ErrorRateResponse,
  ErrorRateTrendDataPoint,
  SeverityLevel,
  CategoryType,
  ExecutionGroup,
  GroupedPaginatedResponse,
} from '../../types/analytics.js';

// Canonical error code → name mapping
// Categories: protected, failed, inconclusive, contextual, error
export const ERROR_CODE_MAP: Record<number, { name: string; description: string; category: string }> = {
  0:   { name: 'NormalExit',                description: 'Normal exit - varies by context',              category: 'inconclusive' },
  1:   { name: 'BinaryNotRecognized',       description: 'Binary not recognized or permission denied',   category: 'contextual' },
  101: { name: 'Unprotected',               description: 'Attack succeeded - endpoint unprotected',      category: 'failed' },
  105: { name: 'FileQuarantinedOnExtraction', description: 'File quarantined during extraction',          category: 'protected' },
  126: { name: 'ExecutionPrevented',         description: 'Execution blocked/prevented by AV/EDR',       category: 'protected' },
  127: { name: 'QuarantinedOnExecution',     description: 'Quarantined on execution attempt',            category: 'protected' },
  200: { name: 'NoOutput',                   description: 'No output - quick AV block before execution', category: 'inconclusive' },
  259: { name: 'StillActive',               description: 'Windows STILL_ACTIVE - process timeout',      category: 'inconclusive' },
  999: { name: 'UnexpectedTestError',        description: 'Test error - prerequisites not met',          category: 'error' },
};

/** Resolve an error code to its canonical name, with optional fallback to f0rtika.error_name */
export function resolveErrorName(errorCode: number | undefined, storedName?: string): string {
  if (errorCode !== undefined && ERROR_CODE_MAP[errorCode]) {
    return ERROR_CODE_MAP[errorCode].name;
  }
  if (storedName) return storedName;
  return `Unknown (${errorCode ?? '?'})`;
}

/** Get field value from ES _source — handles both flattened (dot-key) and nested formats */
function getField(source: any, path: string): any {
  if (source[path] !== undefined) return source[path];
  const parts = path.split('.');
  let value = source;
  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }
  return value;
}

// Organization UUID → short-name mapping
const ORG_NAMES: Record<string, string> = {
  '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': 'SB',
  'b2f8dccb-6d23-492e-aa87-a0a8a6103189': 'TPSGL',
  '9634119d-fa6b-42b8-9b9b-90ad8f22e482': 'RGA',
};

export class ElasticsearchService {
  private client: Client;
  private settings: AnalyticsSettings;

  // Conclusive test outcome codes (used for Defense Score)
  private readonly CONCLUSIVE_ERROR_CODES = [101, 105, 126, 127];

  // Error codes representing failed/inconclusive test attempts (used for Error Rate)
  private readonly ERROR_CODES = [0, 1, 259, 999];

  // Upload confirmation code — not a test outcome, excluded from everything
  private readonly UPLOAD_CONFIRMATION_CODE = 200;

  // Risk acceptance service for Defense Score exclusion filter
  private riskAcceptanceService: RiskAcceptanceService | null = null;

  constructor(settings: AnalyticsSettings) {
    this.settings = settings;

    if (settings.connectionType === 'cloud' && settings.cloudId) {
      this.client = new Client({
        cloud: { id: settings.cloudId },
        auth: { apiKey: settings.apiKey || '' },
      });
    } else if (settings.node) {
      const auth = settings.apiKey
        ? { apiKey: settings.apiKey }
        : { username: settings.username || '', password: settings.password || '' };

      this.client = new Client({
        node: settings.node,
        auth,
      });
    } else {
      throw new Error('Invalid Elasticsearch configuration');
    }
  }

  // Test the connection
  async testConnection(): Promise<string> {
    const info = await this.client.info();
    return info.version.number;
  }

  // Build date range filter
  private buildDateFilter(from?: string, to?: string): any {
    if (!from && !to) {
      return { range: { 'routing.event_time': { gte: 'now-7d' } } };
    }

    const filter: any = { range: { 'routing.event_time': {} } };
    if (from) filter.range['routing.event_time'].gte = from;
    if (to) filter.range['routing.event_time'].lte = to;

    return filter;
  }

  // Build org filter
  private buildOrgFilter(org?: string): any | null {
    if (!org) return null;
    return { term: { 'routing.oid': org } };
  }

  // Filter for valid test execution data only
  // Excludes incomplete records (cleanup operations, etc.)
  private buildTestDataFilter(): any {
    return {
      bool: {
        must: [
          { exists: { field: 'f0rtika.test_uuid' } },
          { exists: { field: 'f0rtika.test_name' } }
        ]
      }
    };
  }

  // Filter to only conclusive test outcomes (for Defense Score calculations)
  private buildConclusiveResultsFilter(): any {
    return { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } };
  }

  // Filter to exclude upload confirmations (for Error Rate — real test activity only)
  private buildTestActivityFilter(): any {
    return {
      bool: {
        must_not: [{ term: { 'event.ERROR': this.UPLOAD_CONFIRMATION_CODE } }]
      }
    };
  }

  /** Get or create the RiskAcceptanceService instance. */
  private getRiskAcceptanceService(): RiskAcceptanceService {
    if (!this.riskAcceptanceService) {
      this.riskAcceptanceService = new RiskAcceptanceService(this.client);
    }
    return this.riskAcceptanceService;
  }

  /**
   * Build the complete filter array for Defense Score queries.
   * Includes: test data filter, date filter, conclusive results filter,
   * optional org filter, and risk acceptance exclusion filter.
   */
  async buildDefenseScoreFilters(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<any[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter(),
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const exclusionFilter = await this.getRiskAcceptanceService().buildExclusionFilter();
    if (exclusionFilter) filters.push(exclusionFilter);

    return filters;
  }

  /** Invalidate the risk acceptance cache (call after accept/revoke). */
  invalidateRiskAcceptanceCache(): void {
    this.riskAcceptanceService?.invalidateCache();
  }

  /**
   * Build Defense Score filters WITHOUT risk acceptance exclusion.
   * Synchronous — used as the "real score" baseline for dual-query comparison.
   */
  buildDefenseScoreFiltersWithoutExclusion(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): any[] {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter(),
    ];
    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);
    filters.push(...this.buildFilterBarClauses(params));
    return filters;
  }

  /** Run a size:0 defense score aggregation and extract totals. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dead code, removed in Wave 7
  // @ts-ignore TS6133
  private parseScoreResponse(response: any): { total: number; protectedCount: number } {
    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value || 0;
    const protectedCount = (response.aggregations?.protected as any)?.doc_count || 0;
    return { total, protectedCount };
  }

  /** Build and execute a size:0 defense score query. */
  // @ts-ignore TS6133 -- dead code, removed in Wave 7
  private async runScoreQuery(filters: any[]): Promise<any> {
    return this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        protected: {
          filter: { term: { 'f0rtika.is_protected': true } },
        },
      },
    });
  }

  /**
   * Run a score query that returns both combined (is_protected OR defender_detected)
   * and strict (is_protected only) counts in a single ES request.
   */
  private async runCombinedScoreQuery(filters: any[]): Promise<{
    total: number;
    combinedProtected: number;
    strictProtected: number;
  }> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        combined: {
          filter: {
            bool: {
              should: [
                { term: { 'f0rtika.is_protected': true } },
                { term: { 'f0rtika.defender_detected': true } },
              ],
              minimum_should_match: 1,
            },
          },
        },
        strict: { filter: { term: { 'f0rtika.is_protected': true } } },
      },
    });
    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value || 0;
    const combinedProtected = (response.aggregations?.combined as any)?.doc_count || 0;
    const strictProtected = (response.aggregations?.strict as any)?.doc_count || 0;
    return { total, combinedProtected, strictProtected };
  }

  /**
   * Any-stage combined query: returns both combined and strict counts
   * split into per-doc and per-bundle subsets.
   */
  private async runAnyStageCombinedQuery(
    filters: any[],
  ): Promise<{ total: number; combinedProtected: number; strictProtected: number }> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        per_doc: {
          filter: this.PER_DOC_FILTER,
          aggs: {
            combined: {
              filter: {
                bool: {
                  should: [
                    { term: { 'f0rtika.is_protected': true } },
                    { term: { 'f0rtika.defender_detected': true } },
                  ],
                  minimum_should_match: 1,
                },
              },
            },
            strict: { filter: { term: { 'f0rtika.is_protected': true } } },
          },
        },
        per_bundle: {
          filter: this.PER_BUNDLE_FILTER,
          aggs: {
            bundles: {
              terms: { script: this.BUNDLE_GROUP_SCRIPT, size: 10000 },
              aggs: {
                has_combined: {
                  filter: {
                    bool: {
                      should: [
                        { term: { 'f0rtika.is_protected': true } },
                        { term: { 'f0rtika.defender_detected': true } },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                },
                has_strict: { filter: { term: { 'f0rtika.is_protected': true } } },
              },
            },
          },
        },
      },
    });

    const perDoc = (response.aggregations as any)?.per_doc;
    const perDocTotal = perDoc?.doc_count || 0;
    const perDocCombined = perDoc?.combined?.doc_count || 0;
    const perDocStrict = perDoc?.strict?.doc_count || 0;

    const perBundle = (response.aggregations as any)?.per_bundle;
    const bundleBuckets: any[] = perBundle?.bundles?.buckets || [];
    const bundleTotal = bundleBuckets.length;
    const bundleCombined = bundleBuckets.filter((b: any) => (b.has_combined?.doc_count || 0) > 0).length;
    const bundleStrict = bundleBuckets.filter((b: any) => (b.has_strict?.doc_count || 0) > 0).length;

    return {
      total: perDocTotal + bundleTotal,
      combinedProtected: perDocCombined + bundleCombined,
      strictProtected: perDocStrict + bundleStrict,
    };
  }

  // ============================================================================
  // ANY-STAGE SCORING — treats each non-CH bundle as a single scoring unit
  // ============================================================================

  /**
   * Query the Defender alerts index for all MITRE techniques with alerts
   * in the given date range. Returns null if Defender is not configured.
   * @deprecated dead code — removed in Wave 7
   */
  // @ts-ignore TS6133 -- dead code, removed in Wave 7
  private async getDefenderDetectedTechniques(from?: string, to?: string): Promise<Set<string> | null> {
    try {
      const intSettings = new IntegrationsSettingsService();
      if (!intSettings.isDefenderConfigured()) return null;
    } catch {
      return null;
    }

    try {
      const dateFilter: any = { range: { created_at: {} } };
      dateFilter.range.created_at.gte = from || 'now-7d';
      if (to) dateFilter.range.created_at.lte = to;

      const response = await this.client.search({
        index: DEFENDER_INDEX,
        size: 0,
        query: {
          bool: {
            must: [
              { term: { doc_type: 'alert' } },
              dateFilter,
            ],
          },
        },
        aggs: {
          techniques: {
            terms: { field: 'mitre_techniques', size: 500 },
          },
        },
      });

      const buckets = (response.aggregations?.techniques as any)?.buckets || [];
      return new Set<string>(buckets.map((b: any) => b.key as string));
    } catch {
      // Defender index may not exist or be inaccessible — graceful fallback
      return null;
    }
  }

  /**
   * Build the "has_detected" filter for per-bundle scoring. A stage is
   * "detected" if the agent reported is_protected:true OR the Defender
   * enrichment pass marked defender_detected:true.
   */
  private buildDetectedFilter(): Record<string, any> {
    return {
      filter: {
        bool: {
          should: [
            { term: { 'f0rtika.is_protected': true } },
            { term: { 'f0rtika.defender_detected': true } },
          ],
          minimum_should_match: 1,
        },
      },
    };
  }

  /** Filter matching standalone tests + cyber-hygiene bundle controls (scored per-document). */
  private readonly PER_DOC_FILTER = {
    bool: {
      should: [
        { bool: { must_not: [{ term: { 'f0rtika.is_bundle_control': true } }] } },
        { term: { 'f0rtika.category': 'cyber-hygiene' } },
      ],
      minimum_should_match: 1,
    },
  };

  /** Filter matching non-cyber-hygiene bundle controls (scored per-bundle-group). */
  private readonly PER_BUNDLE_FILTER = {
    bool: {
      must: [
        { term: { 'f0rtika.is_bundle_control': true } },
        { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } },
      ],
    },
  };

  /** Painless script that groups non-CH bundle controls by bundle_id + hostname. */
  private readonly BUNDLE_GROUP_SCRIPT = {
    source: "doc['f0rtika.bundle_id'].value + '::' + doc['routing.hostname'].value",
    lang: 'painless',
  };

  /**
   * Run an "any-stage" defense score query.
   * Splits into per-doc scoring (standalone + CH) and per-bundle scoring (non-CH bundles).
   * A bundle counts as 1 protected/detected if ANY member has is_protected:true
   * OR matches a Defender alert technique (when Defender is configured).
   */
  // @ts-ignore TS6133 -- dead code, removed in Wave 7
  private async runAnyStageScoreQuery(
    filters: any[],
  ): Promise<{ total: number; protectedCount: number }> {
    const detectedFilter = this.buildDetectedFilter();
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        per_doc: {
          filter: this.PER_DOC_FILTER,
          aggs: {
            protected: { filter: { term: { 'f0rtika.is_protected': true } } },
          },
        },
        per_bundle: {
          filter: this.PER_BUNDLE_FILTER,
          aggs: {
            bundles: {
              terms: { script: this.BUNDLE_GROUP_SCRIPT, size: 10000 },
              aggs: {
                has_protected: detectedFilter,
              },
            },
          },
        },
      },
    });

    return this.parseAnyStageResponse(response);
  }

  /** Extract combined totals from a split per-doc + per-bundle aggregation response. */
  private parseAnyStageResponse(response: any): { total: number; protectedCount: number } {
    const perDoc = response.aggregations?.per_doc as any;
    const perDocTotal = perDoc?.doc_count || 0;
    const perDocProtected = perDoc?.protected?.doc_count || 0;

    const perBundle = response.aggregations?.per_bundle as any;
    const bundleBuckets: any[] = perBundle?.bundles?.buckets || [];
    const bundleTotal = bundleBuckets.length;
    const bundleProtected = bundleBuckets.filter(
      (b: any) => (b.has_protected?.doc_count || 0) > 0
    ).length;

    return {
      total: perDocTotal + bundleTotal,
      protectedCount: perDocProtected + bundleProtected,
    };
  }

  /** Build any-stage aggregations for use inside a date_histogram or terms bucket. */
  private buildAnyStageSubAggs(): Record<string, any> {
    const detectedFilter = this.buildDetectedFilter();
    return {
      per_doc: {
        filter: this.PER_DOC_FILTER,
        aggs: {
          protected: { filter: { term: { 'f0rtika.is_protected': true } } },
        },
      },
      per_bundle: {
        filter: this.PER_BUNDLE_FILTER,
        aggs: {
          bundles: {
            terms: { script: this.BUNDLE_GROUP_SCRIPT, size: 10000 },
            aggs: {
              has_protected: detectedFilter,
            },
          },
        },
      },
    };
  }

  /** Parse any-stage totals from a sub-bucket (date_histogram bucket or terms bucket). */
  private parseAnyStageSubBucket(bucket: any): { total: number; protectedCount: number } {
    const perDocTotal = bucket.per_doc?.doc_count || 0;
    const perDocProtected = bucket.per_doc?.protected?.doc_count || 0;

    const bundleBuckets: any[] = bucket.per_bundle?.bundles?.buckets || [];
    const bundleTotal = bundleBuckets.length;
    const bundleProtected = bundleBuckets.filter(
      (b: any) => (b.has_protected?.doc_count || 0) > 0
    ).length;

    return {
      total: perDocTotal + bundleTotal,
      protectedCount: perDocProtected + bundleProtected,
    };
  }

  /** Run an any-stage trend query (date_histogram with split sub-aggs). */
  private async runAnyStageTrendQuery(
    filters: any[],
    interval: string,
  ): Promise<any> {
    return this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: interval as 'day' | 'week' | 'month' | 'hour',
            min_doc_count: 0,
          },
          aggs: this.buildAnyStageSubAggs(),
        },
      },
    });
  }

  // Get overall defense score
  async getDefenseScore(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<DefenseScoreResponse> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const rawFilters = this.buildDefenseScoreFiltersWithoutExclusion(params);
    const adjustedFilters = await this.buildDefenseScoreFilters(params);
    const hasExclusion = adjustedFilters.length > rawFilters.length;

    const runQuery = isAnyStage
      ? (f: any[]) => this.runAnyStageCombinedQuery(f)
      : (f: any[]) => this.runCombinedScoreQuery(f);

    if (!hasExclusion) {
      const counts = await runQuery(adjustedFilters);
      const combinedScore = counts.total > 0 ? (counts.combinedProtected / counts.total) * 100 : 0;
      const strictScore = counts.total > 0 ? (counts.strictProtected / counts.total) * 100 : 0;
      return {
        score: Math.round(combinedScore * 100) / 100,
        protectedCount: counts.strictProtected,
        detectedCount: counts.combinedProtected - counts.strictProtected,
        unprotectedCount: counts.total - counts.combinedProtected,
        totalExecutions: counts.total,
        realScore: Math.round(strictScore * 100) / 100,
        riskAcceptedCount: 0,
      };
    }

    const [adjusted, raw] = await Promise.all([
      runQuery(adjustedFilters),
      runQuery(rawFilters),
    ]);

    const adjustedCombined = adjusted.total > 0 ? (adjusted.combinedProtected / adjusted.total) * 100 : 0;
    const adjustedStrict = adjusted.total > 0 ? (adjusted.strictProtected / adjusted.total) * 100 : 0;

    return {
      score: Math.round(adjustedCombined * 100) / 100,
      protectedCount: adjusted.strictProtected,
      detectedCount: adjusted.combinedProtected - adjusted.strictProtected,
      unprotectedCount: adjusted.total - adjusted.combinedProtected,
      totalExecutions: adjusted.total,
      realScore: Math.round(adjustedStrict * 100) / 100,
      realProtectedCount: raw.combinedProtected,
      realUnprotectedCount: raw.total - raw.combinedProtected,
      realTotalExecutions: raw.total,
      riskAcceptedCount: Math.max(0, raw.total - adjusted.total),
    };
  }

  /** Run a date histogram trend query and return raw ES response. */
  private async runTrendQuery(filters: any[], interval: string): Promise<any> {
    return this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: interval as 'day' | 'week' | 'month' | 'hour',
            min_doc_count: 0,
          },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });
  }

  // Get defense score trend over time
  async getDefenseScoreTrend(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TrendDataPoint[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const rawFilters = this.buildDefenseScoreFiltersWithoutExclusion(params);
    const adjustedFilters = await this.buildDefenseScoreFilters(params);
    const hasExclusion = adjustedFilters.length > rawFilters.length;
    const interval = params.interval || 'day';

    const runTrend = isAnyStage
      ? (f: any[]) => this.runAnyStageTrendQuery(f, interval)
      : (f: any[]) => this.runTrendQuery(f, interval);

    const parseBucket = isAnyStage
      ? (b: any) => this.parseAnyStageSubBucket(b)
      : (b: any) => ({ total: b.doc_count, protectedCount: b.protected?.doc_count || 0 });

    if (!hasExclusion) {
      const response = await runTrend(adjustedFilters);
      const buckets = (response.aggregations?.over_time as any)?.buckets || [];
      return buckets.map((bucket: any) => {
        const { total, protectedCount } = parseBucket(bucket);
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          timestamp: bucket.key_as_string,
          score: Math.round(score * 100) / 100,
          total,
          protected: protectedCount,
        };
      });
    }

    // Dual query: adjusted + raw
    const [adjustedResponse, rawResponse] = await Promise.all([
      runTrend(adjustedFilters),
      runTrend(rawFilters),
    ]);

    const adjustedBuckets = (adjustedResponse.aggregations?.over_time as any)?.buckets || [];
    const rawBuckets = (rawResponse.aggregations?.over_time as any)?.buckets || [];

    const rawByKey = new Map<string, { total: number; protected: number }>();
    for (const bucket of rawBuckets) {
      const parsed = parseBucket(bucket);
      rawByKey.set(bucket.key_as_string, { total: parsed.total, protected: parsed.protectedCount });
    }

    return adjustedBuckets.map((bucket: any) => {
      const { total, protectedCount } = parseBucket(bucket);
      const score = total > 0 ? (protectedCount / total) * 100 : 0;

      const raw = rawByKey.get(bucket.key_as_string);
      const rawTotal = raw?.total ?? total;
      const rawProtected = raw?.protected ?? protectedCount;
      const rawScore = rawTotal > 0 ? (rawProtected / rawTotal) * 100 : 0;

      return {
        timestamp: bucket.key_as_string,
        score: Math.round(score * 100) / 100,
        total,
        protected: protectedCount,
        realScore: Math.round(rawScore * 100) / 100,
        realTotal: rawTotal,
        realProtected: rawProtected,
      };
    });
  }

  // Extend a date string by windowDays for lookback period
  // Handles both 'now-Xd' format and ISO date strings
  private extendDateRange(from: string | undefined, windowDays: number): string {
    if (!from) {
      return `now-${7 + windowDays - 1}d`; // Default to 7d + lookback
    }

    // Handle 'now-Xd' format
    const nowMatch = from.match(/^now-(\d+)([dhwm])$/);
    if (nowMatch) {
      const value = parseInt(nowMatch[1], 10);
      const unit = nowMatch[2];
      // Convert to days for extension
      const daysMap: Record<string, number> = { d: 1, h: 1/24, w: 7, m: 30 };
      const totalDays = Math.ceil(value * (daysMap[unit] || 1)) + windowDays - 1;
      return `now-${totalDays}d`;
    }

    // Handle ISO date string - subtract windowDays-1
    const date = new Date(from);
    if (!isNaN(date.getTime())) {
      date.setDate(date.getDate() - (windowDays - 1));
      return date.toISOString();
    }

    // Fallback
    return from;
  }

  // Check if a timestamp is within the display range (after the extended lookback)
  private isWithinDisplayRange(timestamp: string, displayFrom: string | undefined): boolean {
    const pointDate = new Date(parseInt(timestamp, 10) || timestamp);

    if (!displayFrom) {
      // Default 7d range
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      cutoff.setHours(0, 0, 0, 0);
      return pointDate >= cutoff;
    }

    // Handle 'now-Xd' format
    const nowMatch = displayFrom.match(/^now-(\d+)([dhwm])$/);
    if (nowMatch) {
      const value = parseInt(nowMatch[1], 10);
      const unit = nowMatch[2];
      const daysMap: Record<string, number> = { d: 1, h: 1/24, w: 7, m: 30 };
      const days = Math.ceil(value * (daysMap[unit] || 1));
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cutoff.setHours(0, 0, 0, 0);
      return pointDate >= cutoff;
    }

    // Handle ISO date string
    const cutoffDate = new Date(displayFrom);
    cutoffDate.setHours(0, 0, 0, 0);
    return pointDate >= cutoffDate;
  }

  // Get defense score trend with rolling window aggregation
  async getDefenseScoreTrendRolling(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TrendDataPoint[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const windowDays = params.windowDays || 7;
    const displayFrom = params.from;
    const interval = params.interval || 'day';

    // Extend date range to include lookback period
    const extendedFrom = this.extendDateRange(params.from, windowDays);
    const extendedParams = { ...params, from: extendedFrom };

    const rawFilters = this.buildDefenseScoreFiltersWithoutExclusion(extendedParams);
    const adjustedFilters = await this.buildDefenseScoreFilters(extendedParams);
    const hasExclusion = adjustedFilters.length > rawFilters.length;

    const runTrend = isAnyStage
      ? (f: any[]) => this.runAnyStageTrendQuery(f, interval)
      : (f: any[]) => this.runTrendQuery(f, interval);

    const normalizeBuckets = isAnyStage
      ? (buckets: any[]) => buckets.map((b: any) => {
          const parsed = this.parseAnyStageSubBucket(b);
          return { ...b, doc_count: parsed.total, protected: { doc_count: parsed.protectedCount } };
        })
      : (buckets: any[]) => buckets;

    if (!hasExclusion) {
      const response = await runTrend(adjustedFilters);
      const buckets = normalizeBuckets((response.aggregations?.over_time as any)?.buckets || []);
      return this.computeRollingWindow(buckets, windowDays, displayFrom);
    }

    // Dual query: adjusted + raw (both with extended date range)
    const [adjustedResponse, rawResponse] = await Promise.all([
      runTrend(adjustedFilters),
      runTrend(rawFilters),
    ]);

    const adjustedBuckets = normalizeBuckets((adjustedResponse.aggregations?.over_time as any)?.buckets || []);
    const rawBuckets = normalizeBuckets((rawResponse.aggregations?.over_time as any)?.buckets || []);

    const adjustedResults = this.computeRollingWindow(adjustedBuckets, windowDays, displayFrom);
    const rawResults = this.computeRollingWindow(rawBuckets, windowDays, displayFrom);

    const rawByTimestamp = new Map<string, TrendDataPoint>();
    for (const point of rawResults) {
      rawByTimestamp.set(point.timestamp, point);
    }

    return adjustedResults.map(point => {
      const raw = rawByTimestamp.get(point.timestamp);
      return {
        ...point,
        realScore: raw?.score ?? point.score,
        realTotal: raw?.total ?? point.total,
        realProtected: raw?.protected ?? point.protected,
      };
    });
  }

  /** Compute rolling window sums from date histogram buckets. */
  private computeRollingWindow(
    buckets: any[],
    windowDays: number,
    displayFrom: string | undefined,
  ): TrendDataPoint[] {
    const results: TrendDataPoint[] = [];

    for (let i = 0; i < buckets.length; i++) {
      const currentBucket = buckets[i];
      const timestamp = currentBucket.key_as_string;

      let windowTotal = 0;
      let windowProtected = 0;

      const windowStart = Math.max(0, i - windowDays + 1);
      for (let j = windowStart; j <= i; j++) {
        windowTotal += buckets[j].doc_count;
        windowProtected += buckets[j].protected?.doc_count || 0;
      }

      if (!this.isWithinDisplayRange(currentBucket.key.toString(), displayFrom)) {
        continue;
      }

      const score = windowTotal > 0 ? (windowProtected / windowTotal) * 100 : 0;

      results.push({
        timestamp,
        score: Math.round(score * 100) / 100,
        total: windowTotal,
        protected: windowProtected,
      });
    }

    return results;
  }

  /**
   * Run a breakdown query with optional any-stage scoring.
   * When isAnyStage is true, non-CH bundles inside each breakdown bucket are
   * grouped and scored per-bundle rather than per-document.
   */
  private async runBreakdownQuery(
    filters: any[],
    aggName: string,
    fieldOrScript: string | { script: any },
    size: number,
    isAnyStage: boolean,
  ): Promise<{ key: string; total: number; protectedCount: number }[]> {
    const termsConfig = typeof fieldOrScript === 'string'
      ? { field: fieldOrScript, size }
      : { ...fieldOrScript, size };

    const subAggs = isAnyStage
      ? this.buildAnyStageSubAggs()
      : { protected: { filter: { term: { 'f0rtika.is_protected': true } } } };

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: { [aggName]: { terms: termsConfig, aggs: subAggs } },
    });

    const buckets = (response.aggregations?.[aggName] as any)?.buckets || [];

    return buckets.map((bucket: any) => {
      if (isAnyStage) {
        const parsed = this.parseAnyStageSubBucket(bucket);
        return { key: bucket.key, total: parsed.total, protectedCount: parsed.protectedCount };
      }
      return { key: bucket.key, total: bucket.doc_count, protectedCount: bucket.protected?.doc_count || 0 };
    });
  }

  // Get defense score by test
  async getDefenseScoreByTest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<BreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_test', 'f0rtika.test_name', params.limit || 50, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return { name: key, score: Math.round(score * 100) / 100, count: total, protected: protectedCount };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Get defense score by technique
  async getDefenseScoreByTechnique(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<BreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_technique', 'f0rtika.techniques', 50, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return { name: key, score: Math.round(score * 100) / 100, count: total, protected: protectedCount };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Get recent test executions
  async getRecentExecutions(params: AnalyticsQueryParams): Promise<TestExecution[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: params.limit || 50,
      query: {
        bool: { filter: filters },
      },
      sort: [{ 'routing.event_time': 'desc' }],
    });

    return response.hits.hits.map((hit: any) => {
      const source = hit._source;
      const orgUuid = getField(source, 'routing.oid') || '';

      return {
        test_uuid: getField(source, 'f0rtika.test_uuid') || '',
        test_name: getField(source, 'f0rtika.test_name') || 'Unknown Test',
        hostname: getField(source, 'routing.hostname') || 'Unknown',
        is_protected: getField(source, 'f0rtika.is_protected') || false,
        org: ORG_NAMES[orgUuid] || (orgUuid ? orgUuid.substring(0, 8) : ''),
        timestamp: getField(source, 'routing.event_time') || '',
        error_code: getField(source, 'event.ERROR'),
        error_name: resolveErrorName(getField(source, 'event.ERROR'), getField(source, 'f0rtika.error_name')),
      };
    });
  }

  // Get list of organizations
  async getOrganizations(): Promise<OrganizationInfo[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      aggs: {
        orgs: {
          terms: { field: 'routing.oid', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.orgs as any)?.buckets || [];

    // Known organization mapping
    const knownOrgs: Record<string, { shortName: string; fullName: string }> = {
      '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': {
        shortName: 'SB',
        fullName: 'Superintendency of Banks',
      },
      'b2f8dccb-6d23-492e-aa87-a0a8a6103189': {
        shortName: 'TPSGL',
        fullName: 'Transact Pay',
      },
      '9634119d-fa6b-42b8-9b9b-90ad8f22e482': {
        shortName: 'RGA',
        fullName: 'RG Associates',
      },
    };

    return buckets.map((bucket: any) => {
      const uuid = bucket.key;
      const known = knownOrgs[uuid];

      return {
        uuid,
        shortName: known?.shortName || uuid.substring(0, 8),
        fullName: known?.fullName || uuid,
      };
    });
  }

  // Get unique hostname count
  async getUniqueHostnames(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<number> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        unique_hostnames: {
          cardinality: { field: 'routing.hostname' },
        },
      },
    });

    return (response.aggregations?.unique_hostnames as any)?.value || 0;
  }

  // Get unique test count
  async getUniqueTests(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<number> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        unique_tests: {
          cardinality: { field: 'f0rtika.test_uuid' },
        },
      },
    });

    return (response.aggregations?.unique_tests as any)?.value || 0;
  }

  // Build tests filter (OR logic for multiple tests)
  private buildTestsFilter(tests?: string): any | null {
    if (!tests) return null;

    const testList = tests.split(',').map(t => t.trim()).filter(Boolean);
    if (testList.length === 0) return null;

    if (testList.length === 1) {
      return { term: { 'f0rtika.test_name': testList[0] } };
    }

    return {
      bool: {
        should: testList.map(test => ({ term: { 'f0rtika.test_name': test } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build techniques filter (OR logic for multiple techniques)
  private buildTechniquesFilter(techniques?: string): any | null {
    if (!techniques) return null;

    const techniqueList = techniques.split(',').map(t => t.trim()).filter(Boolean);
    if (techniqueList.length === 0) return null;

    if (techniqueList.length === 1) {
      return { term: { 'f0rtika.techniques': techniqueList[0] } };
    }

    return {
      bool: {
        should: techniqueList.map(technique => ({ term: { 'f0rtika.techniques': technique } })),
        minimum_should_match: 1,
      },
    };
  }

  // Get results by error type (for pie chart)
  async getResultsByErrorType(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ErrorTypeBreakdown[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_error_code: {
          terms: { field: 'event.ERROR', size: 20 },
        },
      },
    });

    const buckets = (response.aggregations?.by_error_code as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      name: resolveErrorName(bucket.key),
      code: bucket.key as number,
      count: bucket.doc_count,
    }));
  }

  // Get test coverage (protected vs unprotected counts per test)
  async getTestCoverage(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TestCoverageItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_test: {
          terms: { field: 'f0rtika.test_name', size: 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            unprotected: {
              filter: { term: { 'f0rtika.is_protected': false } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_test as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      name: bucket.key,
      protected: bucket.protected?.doc_count || 0,
      unprotected: bucket.unprotected?.doc_count || 0,
    }));
  }

  // Get technique distribution (protected vs unprotected counts per technique)
  async getTechniqueDistribution(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TechniqueDistributionItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_technique: {
          terms: { field: 'f0rtika.techniques', size: 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            unprotected: {
              filter: { term: { 'f0rtika.is_protected': false } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_technique as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      technique: bucket.key,
      protected: bucket.protected?.doc_count || 0,
      unprotected: bucket.unprotected?.doc_count || 0,
    }));
  }

  // Get host-test matrix for heatmap
  async getHostTestMatrix(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<HostTestMatrixCell[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        host_test_matrix: {
          composite: {
            size: 1000,
            sources: [
              { hostname: { terms: { field: 'routing.hostname' } } },
              { test_name: { terms: { field: 'f0rtika.test_name' } } },
            ],
          },
        },
      },
    });

    const buckets = (response.aggregations?.host_test_matrix as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      hostname: bucket.key.hostname,
      testName: bucket.key.test_name,
      count: bucket.doc_count,
    }));
  }

  // Get list of available tests (for filter dropdown)
  async getAvailableTests(): Promise<string[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: [this.buildTestDataFilter()] }
      },
      aggs: {
        tests: {
          terms: { field: 'f0rtika.test_name', size: 100 },
        },
      },
    });

    const buckets = (response.aggregations?.tests as any)?.buckets || [];
    return buckets.map((bucket: any) => bucket.key);
  }

  // Get list of test UUIDs that have been executed (for NRY filter)
  async getExecutedTestUuids(): Promise<string[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: [this.buildTestDataFilter()] }
      },
      aggs: {
        uuids: {
          terms: { field: 'f0rtika.test_uuid', size: 10000 },
        },
      },
    });

    const buckets = (response.aggregations?.uuids as any)?.buckets || [];
    return buckets.map((bucket: any) => bucket.key);
  }

  // Get list of available techniques (for filter dropdown)
  async getAvailableTechniques(): Promise<string[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: [this.buildTestDataFilter()] }
      },
      aggs: {
        techniques: {
          terms: { field: 'f0rtika.techniques', size: 100 },
        },
      },
    });

    const buckets = (response.aggregations?.techniques as any)?.buckets || [];
    return buckets.map((bucket: any) => bucket.key);
  }

  // Get defense score by organization
  async getDefenseScoreByOrg(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<OrgBreakdownItem[]> {
    const filters = await this.buildDefenseScoreFilters(params);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_org: {
          terms: { field: 'routing.oid', size: 20 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_org as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          org: bucket.key,
          orgName: ORG_NAMES[bucket.key] || bucket.key.substring(0, 8),
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
        };
      })
      .sort((a: OrgBreakdownItem, b: OrgBreakdownItem) => b.score - a.score);
  }

  // ============================================
  // New Filter Builders (for enriched fields)
  // ============================================

  // Build hostnames filter (OR logic)
  private buildHostnamesFilter(hostnames?: string): any | null {
    if (!hostnames) return null;
    const hostnameList = hostnames.split(',').map(h => h.trim()).filter(Boolean);
    if (hostnameList.length === 0) return null;
    if (hostnameList.length === 1) {
      return { term: { 'routing.hostname': hostnameList[0] } };
    }
    return {
      bool: {
        should: hostnameList.map(h => ({ term: { 'routing.hostname': h } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build categories filter (OR logic)
  private buildCategoriesFilter(categories?: string): any | null {
    if (!categories) return null;
    const categoryList = categories.split(',').map(c => c.trim()).filter(Boolean);
    if (categoryList.length === 0) return null;
    if (categoryList.length === 1) {
      return { term: { 'f0rtika.category': categoryList[0] } };
    }
    return {
      bool: {
        should: categoryList.map(c => ({ term: { 'f0rtika.category': c } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build severities filter (OR logic)
  private buildSeveritiesFilter(severities?: string): any | null {
    if (!severities) return null;
    const severityList = severities.split(',').map(s => s.trim()).filter(Boolean);
    if (severityList.length === 0) return null;
    if (severityList.length === 1) {
      return { term: { 'f0rtika.severity': severityList[0] } };
    }
    return {
      bool: {
        should: severityList.map(s => ({ term: { 'f0rtika.severity': s } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build threat actors filter (OR logic)
  private buildThreatActorsFilter(threatActors?: string): any | null {
    if (!threatActors) return null;
    const actorList = threatActors.split(',').map(a => a.trim()).filter(Boolean);
    if (actorList.length === 0) return null;
    if (actorList.length === 1) {
      return { term: { 'f0rtika.threat_actor': actorList[0] } };
    }
    return {
      bool: {
        should: actorList.map(a => ({ term: { 'f0rtika.threat_actor': a } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build tags filter (OR logic)
  private buildTagsFilter(tags?: string): any | null {
    if (!tags) return null;
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length === 0) return null;
    if (tagList.length === 1) {
      return { term: { 'f0rtika.tags': tagList[0] } };
    }
    return {
      bool: {
        should: tagList.map(t => ({ term: { 'f0rtika.tags': t } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build bundle names filter (OR logic)
  private buildBundleNamesFilter(bundleNames?: string): any | null {
    if (!bundleNames) return null;
    const nameList = bundleNames.split(',').map(n => n.trim()).filter(Boolean);
    if (nameList.length === 0) return null;
    if (nameList.length === 1) {
      return { term: { 'f0rtika.bundle_name': nameList[0] } };
    }
    return {
      bool: {
        should: nameList.map(n => ({ term: { 'f0rtika.bundle_name': n } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build error names filter (OR logic) — resolves canonical names to error codes
  private buildErrorNamesFilter(errorNames?: string): any | null {
    if (!errorNames) return null;
    const nameList = errorNames.split(',').map(n => n.trim()).filter(Boolean);
    if (nameList.length === 0) return null;

    // Reverse-resolve canonical names to numeric error codes
    const codes: number[] = [];
    for (const name of nameList) {
      const entry = Object.entries(ERROR_CODE_MAP).find(([, v]) => v.name === name);
      if (entry) {
        codes.push(Number(entry[0]));
      }
    }

    if (codes.length > 0) {
      return { terms: { 'event.ERROR': codes } };
    }

    // Fallback: try matching against the stored field for any unrecognised names
    if (nameList.length === 1) {
      return { term: { 'f0rtika.error_name': nameList[0] } };
    }
    return {
      bool: {
        should: nameList.map(n => ({ term: { 'f0rtika.error_name': n } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build error codes filter (OR logic, numeric field)
  private buildErrorCodesFilter(errorCodes?: string): any | null {
    if (!errorCodes) return null;
    const codeList = errorCodes.split(',').map(c => parseInt(c.trim(), 10)).filter(n => !isNaN(n));
    if (codeList.length === 0) return null;
    return { terms: { 'event.ERROR': codeList } };
  }

  // Build result filter (protected/unprotected/inconclusive)
  private buildResultFilter(result?: 'all' | 'protected' | 'unprotected' | 'inconclusive'): any | null {
    if (!result || result === 'all') return null;
    if (result === 'protected') return { terms: { 'event.ERROR': [105, 126, 127] } };
    if (result === 'unprotected') return { term: { 'event.ERROR': 101 } };
    // inconclusive: everything NOT in [101, 105, 126, 127]
    return { bool: { must_not: { terms: { 'event.ERROR': [101, 105, 126, 127] } } } };
  }

  /**
   * Build filter clauses from extended (filter-bar) params.
   * Returns only the clauses — caller is responsible for base filters (testData, date, org).
   * Shared by both paginated-executions and dashboard endpoints.
   */
  private buildFilterBarClauses(params: Partial<ExtendedAnalyticsQueryParams>): any[] {
    const clauses: any[] = [];

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) clauses.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) clauses.push(techniquesFilter);

    const hostnamesFilter = this.buildHostnamesFilter(params.hostnames);
    if (hostnamesFilter) clauses.push(hostnamesFilter);

    const categoriesFilter = this.buildCategoriesFilter(params.categories);
    if (categoriesFilter) clauses.push(categoriesFilter);

    const severitiesFilter = this.buildSeveritiesFilter(params.severities);
    if (severitiesFilter) clauses.push(severitiesFilter);

    const threatActorsFilter = this.buildThreatActorsFilter(params.threatActors);
    if (threatActorsFilter) clauses.push(threatActorsFilter);

    const tagsFilter = this.buildTagsFilter(params.tags);
    if (tagsFilter) clauses.push(tagsFilter);

    const errorNamesFilter = this.buildErrorNamesFilter(params.errorNames);
    if (errorNamesFilter) clauses.push(errorNamesFilter);

    const errorCodesFilter = this.buildErrorCodesFilter(params.errorCodes);
    if (errorCodesFilter) clauses.push(errorCodesFilter);

    const bundleNamesFilter = this.buildBundleNamesFilter(params.bundleNames);
    if (bundleNamesFilter) clauses.push(bundleNamesFilter);

    const resultFilter = this.buildResultFilter(params.result);
    if (resultFilter) clauses.push(resultFilter);

    return clauses;
  }

  // Build all extended filters (base + filter-bar clauses)
  private buildExtendedFilters(params: PaginatedExecutionsParams): any[] {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    return filters;
  }

  // ============================================
  // New Query Methods
  // ============================================

  // Get paginated executions with enriched data
  async getPaginatedExecutions(params: PaginatedExecutionsParams): Promise<PaginatedResponse<EnrichedTestExecution>> {
    const filters = this.buildExtendedFilters(params);

    const page = params.page || 1;
    const pageSize = Math.min(params.pageSize || 25, 100); // Max 100 per page
    const from = (page - 1) * pageSize;

    // Build sort configuration
    const sortField = params.sortField || 'routing.event_time';
    const sortOrder = params.sortOrder || 'desc';
    const sort: any[] = [{ [sortField]: sortOrder }];

    // First get total count
    const countResponse = await this.client.count({
      index: this.settings.indexPattern,
      query: { bool: { filter: filters } },
    });
    const totalItems = countResponse.count;

    // Then get paginated results
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: pageSize,
      from,
      query: { bool: { filter: filters } },
      sort,
    });

    const data: EnrichedTestExecution[] = response.hits.hits.map(
      (hit: any) => this.mapHitToExecution(hit)
    );

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      data,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  // Get paginated executions collapsed by display group (bundle or standalone).
  // Each collapsed group counts as 1 "row" for pagination, so "25 per page" = ~25 visible rows.
  // Uses terms aggregation with a Painless script (collapse doesn't support scripted/runtime fields).
  async getGroupedPaginatedExecutions(params: PaginatedExecutionsParams): Promise<GroupedPaginatedResponse> {
    const filters = this.buildExtendedFilters(params);
    const page = params.page || 1;
    const pageSize = Math.min(params.pageSize || 25, 100);
    const from = (page - 1) * pageSize;
    const sortField = params.sortField || 'routing.event_time';
    const sortOrder = params.sortOrder || 'desc';

    // Painless script that computes a display group key per document.
    // Includes a 30-minute time bucket so separate runs of the same test
    // on the same host get distinct groups instead of merging.
    //   bundle controls → "bundle::<bundle_id>::<hostname>::<time_bucket>"
    //   standalone tests → "standalone::<test_uuid>::<hostname>::<time_bucket>"
    const groupKeyScript = {
      source: `
        long bucket = doc['routing.event_time'].value.toInstant().toEpochMilli() / 1800000L;
        if (doc.containsKey('f0rtika.is_bundle_control')
            && doc['f0rtika.is_bundle_control'].size() > 0
            && doc['f0rtika.is_bundle_control'].value == true) {
          return 'bundle::' + doc['f0rtika.bundle_id'].value + '::' + doc['routing.hostname'].value + '::' + bucket;
        } else {
          return 'standalone::' + doc['f0rtika.test_uuid'].value + '::' + doc['routing.hostname'].value + '::' + bucket;
        }
      `,
      lang: 'painless',
    };

    // Total document count (for badge/info display)
    const countResponse = await this.client.count({
      index: this.settings.indexPattern,
      query: { bool: { filter: filters } },
    });

    // Single search with size:0 (results come from agg buckets, not top-level hits):
    //   - terms agg with Painless script for grouping, ordered by most recent event
    //   - top_hits sub-agg returns member docs per group
    //   - cardinality agg with same script gives total distinct group count
    // Pagination: over-fetch page*pageSize buckets and slice client-side for the requested page.
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        total_groups: {
          cardinality: {
            script: groupKeyScript,
            precision_threshold: 10000,
          },
        },
        display_groups: {
          terms: {
            script: groupKeyScript,
            size: page * pageSize,
            order: { sort_value: sortOrder },
          },
          aggs: {
            members: {
              top_hits: {
                size: 100,
                sort: [{ [sortField]: sortOrder }],
                _source: true,
              },
            },
            sort_value: {
              max: { field: 'routing.event_time' },
            },
          },
        },
      },
    });

    const totalDocuments = countResponse.count;
    const totalGroups = (response.aggregations?.total_groups as any)?.value ?? 0;
    const totalPages = Math.ceil(totalGroups / pageSize);

    // Slice the over-fetched buckets to the requested page window
    const allBuckets = (response.aggregations?.display_groups as any)?.buckets || [];
    const pageBuckets = allBuckets.slice(from, from + pageSize);

    const groups: ExecutionGroup[] = pageBuckets.map((bucket: any) => {
      const groupKey: string = bucket.key;
      const isBundle = groupKey.startsWith('bundle::');
      const memberHits = bucket.members?.hits?.hits || [];
      const members: EnrichedTestExecution[] = memberHits.map((hit: any) => this.mapHitToExecution(hit));
      const representative = members[0] || this.mapHitToExecution({ _source: {} });

      // Warn if top_hits were truncated (bundle exceeds 100 controls)
      if (isBundle && memberHits.length >= 100) {
        console.warn(`Bundle group ${groupKey} has ${memberHits.length}+ members (top_hits may be truncated)`);
      }

      let protectedCount = 0;
      let unprotectedCount = 0;
      for (const m of members) {
        if (m.error_code === 105 || m.error_code === 126 || m.error_code === 127) protectedCount++;
        else if (m.error_code === 101) unprotectedCount++;
      }

      return {
        groupKey,
        type: isBundle ? 'bundle' as const : 'standalone' as const,
        representative,
        members,
        protectedCount,
        unprotectedCount,
        totalCount: members.length,
      };
    });

    // Enrich groups with Defender detection status.
    // Single ES query checks which (hostname, binary_filename) pairs have alerts
    // within -5/+30 min of the group's representative timestamp.
    await this.enrichGroupsWithDefenderDetection(groups);

    return {
      groups,
      pagination: {
        page,
        pageSize,
        totalGroups,
        totalDocuments,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  /**
   * Check achilles-defender for alerts matching each group's binary + hostname.
   * Uses evidence_filenames and evidence_hostnames for precise correlation,
   * with technique-based fallback. Mutates groups in place.
   */
  private async enrichGroupsWithDefenderDetection(groups: ExecutionGroup[]): Promise<void> {
    try {
      const intSettings = new IntegrationsSettingsService();
      if (!intSettings.isDefenderConfigured()) return;
    } catch { return; }

    // Build per-group correlation queries as a single msearch
    const searches: any[] = [];
    const PRE_WINDOW_MS = 5 * 60 * 1000;
    const POST_WINDOW_MS = 30 * 60 * 1000;

    for (const group of groups) {
      const rep = group.representative;
      if (!rep.timestamp) continue;

      const testTime = new Date(rep.timestamp).getTime();
      const from = new Date(testTime - PRE_WINDOW_MS).toISOString();
      const to = new Date(testTime + POST_WINDOW_MS).toISOString();

      // Derive binary name prefix from test_uuid (strip ::control_id for bundle controls).
      // Multi-stage binaries are named <uuid>-<stage>.exe, so match with wildcard.
      const baseUuid = rep.test_uuid?.includes('::')
        ? rep.test_uuid.split('::')[0]
        : rep.test_uuid;
      const binaryPrefix = baseUuid ? `${baseUuid.toLowerCase()}*` : null;

      // Evidence-based query: binary filename + hostname + time window.
      // Filter on `timestamp` (= lastUpdateDateTime || createdDateTime) rather
      // than `created_at`. Defender reuses existing alerts and bumps their
      // updated time when new evidence arrives, so a test triggering an old
      // alert leaves `created_at` weeks in the past while `timestamp` reflects
      // when the test actually fired the detection. This also matches the
      // field used as the data view's time axis in Kibana Discover.
      const must: any[] = [
        { term: { doc_type: 'alert' } },
        { range: { timestamp: { gte: from, lte: to } } },
      ];

      if (binaryPrefix && rep.hostname) {
        // Tier 1: evidence-based (most precise).
        // Query the .keyword subfield: the parent text field tokenizes on '-' and '.',
        // so a wildcard against the analyzed value can never match a full hyphenated UUID.
        // Wildcard on filenames: matches <uuid>.exe and <uuid>-<stage>.exe
        // Wildcard on hostnames: matches short name (LT-TPL-L50) and FQDN (LT-TPL-L50.domain.com)
        must.push({ wildcard: { 'evidence_filenames.keyword': { value: binaryPrefix } } });
        must.push({ wildcard: { 'evidence_hostnames.keyword': { value: `${rep.hostname.toUpperCase()}*` } } });
      } else if (rep.techniques?.length) {
        // Fallback: technique-based
        must.push({ terms: { mitre_techniques: rep.techniques } });
      } else {
        continue;
      }

      searches.push({ index: DEFENDER_INDEX });
      searches.push({ size: 0, query: { bool: { must } } });
    }

    if (searches.length === 0) return;

    try {
      const msearchResult = await this.client.msearch({ searches });
      let responseIdx = 0;

      for (const group of groups) {
        const rep = group.representative;
        if (!rep.timestamp) continue;

        const baseUuid = rep.test_uuid?.includes('::')
          ? rep.test_uuid.split('::')[0]
          : rep.test_uuid;
        const binaryPrefix = baseUuid ? `${baseUuid.toLowerCase()}*` : null;

        if (!binaryPrefix && !rep.techniques?.length) continue;

        const resp = msearchResult.responses[responseIdx++] as any;
        if (resp.error) continue;

        const total = typeof resp.hits?.total === 'number'
          ? resp.hits.total
          : resp.hits?.total?.value ?? 0;

        if (total > 0) {
          group.defenderDetected = true;
        }
      }
    } catch {
      // Defender index might not exist — non-fatal, leave defenderDetected unset
    }
  }

  // Map a single ES hit (from search or inner_hits) to EnrichedTestExecution
  private mapHitToExecution(hit: any): EnrichedTestExecution {
    const source = hit._source;
    const orgUuid = getField(source, 'routing.oid') || '';

    return {
      test_uuid: getField(source, 'f0rtika.test_uuid') || '',
      test_name: getField(source, 'f0rtika.test_name') || 'Unknown Test',
      hostname: getField(source, 'routing.hostname') || 'Unknown',
      is_protected: getField(source, 'f0rtika.is_protected') || false,
      org: ORG_NAMES[orgUuid] || (orgUuid ? orgUuid.substring(0, 8) : ''),
      timestamp: getField(source, 'routing.event_time') || '',
      error_code: getField(source, 'event.ERROR'),
      error_name: resolveErrorName(getField(source, 'event.ERROR'), getField(source, 'f0rtika.error_name')),
      category: getField(source, 'f0rtika.category') as CategoryType | undefined,
      subcategory: getField(source, 'f0rtika.subcategory'),
      severity: getField(source, 'f0rtika.severity') as SeverityLevel | undefined,
      techniques: getField(source, 'f0rtika.techniques'),
      tactics: getField(source, 'f0rtika.tactics'),
      target: getField(source, 'f0rtika.target'),
      complexity: getField(source, 'f0rtika.complexity'),
      threat_actor: getField(source, 'f0rtika.threat_actor'),
      tags: getField(source, 'f0rtika.tags'),
      score: getField(source, 'f0rtika.score'),
      bundle_id: getField(source, 'f0rtika.bundle_id'),
      bundle_name: getField(source, 'f0rtika.bundle_name'),
      control_id: getField(source, 'f0rtika.control_id'),
      control_validator: getField(source, 'f0rtika.control_validator'),
      is_bundle_control: getField(source, 'f0rtika.is_bundle_control') ?? false,
    };
  }

  // Get available hostnames with counts
  // Note: For filter dropdowns, we show all available values unless date range is explicitly specified
  async getAvailableHostnames(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      // Only apply date filter if explicitly provided (don't default to 7d for filter options)
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        hostnames: {
          terms: { field: 'routing.hostname', size: 200 },
        },
      },
    });

    const buckets = (response.aggregations?.hostnames as any)?.buckets || [];
    return buckets.map((bucket: any) => ({
      value: bucket.key,
      label: bucket.key,
      count: bucket.doc_count,
    }));
  }

  // Get available categories with counts
  async getAvailableCategories(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        categories: {
          terms: { field: 'f0rtika.category', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.categories as any)?.buckets || [];
    return buckets.map((bucket: any) => ({
      value: bucket.key,
      label: bucket.key,
      count: bucket.doc_count,
    }));
  }

  // Get available severities with counts
  async getAvailableSeverities(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        severities: {
          terms: { field: 'f0rtika.severity', size: 10 },
        },
      },
    });

    const buckets = (response.aggregations?.severities as any)?.buckets || [];
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key.charAt(0).toUpperCase() + bucket.key.slice(1),
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) =>
        severityOrder.indexOf(a.value) - severityOrder.indexOf(b.value)
      );
  }

  // Get available threat actors with counts
  async getAvailableThreatActors(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        threat_actors: {
          terms: { field: 'f0rtika.threat_actor', size: 100 },
        },
      },
    });

    const buckets = (response.aggregations?.threat_actors as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available tags with counts
  async getAvailableTags(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        tags: {
          terms: { field: 'f0rtika.tags', size: 200 },
        },
      },
    });

    const buckets = (response.aggregations?.tags as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available error names with counts
  async getAvailableErrorNames(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        error_codes: {
          terms: { field: 'event.ERROR', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.error_codes as any)?.buckets || [];
    return buckets
      .map((bucket: any) => {
        const name = resolveErrorName(bucket.key);
        return {
          value: name,
          label: name,
          count: bucket.doc_count,
        };
      })
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available error codes with counts
  async getAvailableErrorCodes(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        error_codes: {
          terms: { field: 'event.ERROR', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.error_codes as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: String(bucket.key),
        label: `${bucket.key} (${resolveErrorName(bucket.key)})`,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available bundle names with counts
  async getAvailableBundleNames(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        bundle_names: {
          terms: { field: 'f0rtika.bundle_name', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.bundle_names as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get defense score by severity
  async getDefenseScoreBySeverity(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<SeverityBreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_severity', 'f0rtika.severity', 10, isAnyStage);
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          severity: key as SeverityLevel,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
        };
      })
      .sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  }

  // Get defense score by category
  async getDefenseScoreByCategory(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<CategoryBreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_category', 'f0rtika.category', 20, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          category: key as CategoryType,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Get defense score by category with nested subcategories
  async getDefenseScoreByCategoryWithSubcategories(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<CategorySubcategoryBreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);

    const subAggs: Record<string, any> = isAnyStage
      ? { ...this.buildAnyStageSubAggs(), by_subcategory: { terms: { field: 'f0rtika.subcategory', size: 50 }, aggs: this.buildAnyStageSubAggs() } }
      : { protected: { filter: { term: { 'f0rtika.is_protected': true } } }, by_subcategory: { terms: { field: 'f0rtika.subcategory', size: 50 }, aggs: { protected: { filter: { term: { 'f0rtika.is_protected': true } } } } } };

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: { by_category: { terms: { field: 'f0rtika.category', size: 20 }, aggs: subAggs } },
    });

    const buckets = (response.aggregations?.by_category as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const { total, protectedCount } = isAnyStage
          ? this.parseAnyStageSubBucket(bucket)
          : { total: bucket.doc_count, protectedCount: bucket.protected?.doc_count || 0 };
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        const subBuckets = bucket.by_subcategory?.buckets || [];
        const subcategories: SubcategoryBreakdownItem[] = subBuckets
          .map((sub: any) => {
            const subParsed = isAnyStage
              ? this.parseAnyStageSubBucket(sub)
              : { total: sub.doc_count, protectedCount: sub.protected?.doc_count || 0 };
            const subScore = subParsed.total > 0 ? (subParsed.protectedCount / subParsed.total) * 100 : 0;
            return {
              subcategory: sub.key,
              score: Math.round(subScore * 100) / 100,
              count: subParsed.total,
              protected: subParsed.protectedCount,
              unprotected: subParsed.total - subParsed.protectedCount,
            };
          })
          .sort((a: SubcategoryBreakdownItem, b: SubcategoryBreakdownItem) => b.count - a.count);

        return {
          category: bucket.key as CategoryType,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
          subcategories,
        };
      })
      .sort((a: CategorySubcategoryBreakdownItem, b: CategorySubcategoryBreakdownItem) => b.score - a.score);
  }

  // Get defense score by hostname
  async getDefenseScoreByHostname(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<DefenseScoreByHostItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_hostname', 'routing.hostname', params.limit || 50, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          hostname: key,
          score: Math.round(score * 100) / 100,
          protected: protectedCount,
          unprotected: total - protectedCount,
          total,
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  // Get canonical test count (stable denominator for coverage calculations)
  // Returns all unique tests seen in the last 90 days
  async getCanonicalTestCount(params?: { org?: string; days?: number }): Promise<CanonicalTestCountResponse> {
    const days = params?.days || 90;
    const filters: any[] = [
      this.buildTestDataFilter(),
      { range: { 'routing.event_time': { gte: `now-${days}d` } } }
    ];

    const orgFilter = this.buildOrgFilter(params?.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        unique_test_count: {
          cardinality: { field: 'f0rtika.test_name' },
        },
        test_names: {
          terms: { field: 'f0rtika.test_name', size: 500 },
        },
      },
    });

    const count = (response.aggregations?.unique_test_count as any)?.value || 0;
    const buckets = (response.aggregations?.test_names as any)?.buckets || [];
    const tests = buckets.map((bucket: any) => bucket.key);

    return { count, tests, days };
  }

  // Get threat actor coverage
  async getThreatActorCoverage(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ThreatActorCoverageItem[]> {
    const filters = await this.buildDefenseScoreFilters(params);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        by_threat_actor: {
          terms: { field: 'f0rtika.threat_actor', size: 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            unique_tests: {
              cardinality: { field: 'f0rtika.test_uuid' },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_threat_actor as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const testCount = bucket.unique_tests?.value || 0;
        const coverage = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          threatActor: bucket.key,
          coverage: Math.round(coverage * 100) / 100,
          testCount,
          protectedCount,
          totalExecutions: total,
        };
      })
      .sort((a: ThreatActorCoverageItem, b: ThreatActorCoverageItem) => b.totalExecutions - a.totalExecutions);
  }

  // Get error rate trend with rolling window aggregation
  async getErrorRateTrendRolling(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ErrorRateTrendDataPoint[]> {
    const windowDays = params.windowDays || 7;
    const displayFrom = params.from;

    // Extend date range to include lookback period
    const extendedFrom = this.extendDateRange(params.from, windowDays);

    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(extendedFrom, params.to),
      this.buildTestActivityFilter()  // excludes code 200
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const interval = params.interval || 'day';

    // Query ES with extended range
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: interval as 'day' | 'week' | 'month' | 'hour',
            min_doc_count: 0,
          },
          aggs: {
            errors: {
              filter: { terms: { 'event.ERROR': this.ERROR_CODES } },
            },
            conclusive: {
              filter: { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.over_time as any)?.buckets || [];

    // Compute rolling sums
    const rollingResults: ErrorRateTrendDataPoint[] = [];

    for (let i = 0; i < buckets.length; i++) {
      const currentBucket = buckets[i];
      const timestamp = currentBucket.key_as_string;

      // Sum over the window (current day + previous windowDays-1 days)
      let windowErrors = 0;
      let windowConclusive = 0;

      const windowStart = Math.max(0, i - windowDays + 1);
      for (let j = windowStart; j <= i; j++) {
        windowErrors += buckets[j].errors?.doc_count || 0;
        windowConclusive += buckets[j].conclusive?.doc_count || 0;
      }

      // Skip points that are in the lookback-only period
      if (!this.isWithinDisplayRange(currentBucket.key.toString(), displayFrom)) {
        continue;
      }

      const total = windowErrors + windowConclusive;
      const errorRate = total > 0 ? (windowErrors / total) * 100 : 0;

      rollingResults.push({
        timestamp,
        errorRate: Math.round(errorRate * 100) / 100,
        errorCount: windowErrors,
        conclusiveCount: windowConclusive,
        total,
      });
    }

    return rollingResults;
  }

  // Get error rate (proportion of non-conclusive test activity)
  async getErrorRate(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ErrorRateResponse> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildTestActivityFilter()  // excludes code 200
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        errors: {
          filter: { terms: { 'event.ERROR': this.ERROR_CODES } },
        },
        conclusive: {
          filter: { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } },
        },
      },
    });

    const errorCount = (response.aggregations?.errors as any)?.doc_count || 0;
    const conclusiveCount = (response.aggregations?.conclusive as any)?.doc_count || 0;
    const totalTestActivity = errorCount + conclusiveCount;
    const errorRate = totalTestActivity > 0 ? (errorCount / totalTestActivity) * 100 : 0;

    return {
      errorRate: Math.round(errorRate * 100) / 100,
      errorCount,
      conclusiveCount,
      totalTestActivity,
    };
  }

  // ================================================================
  // Archive operations
  // ================================================================

  /** Derive archive index name from the active index pattern. */
  private getArchiveIndexName(): string {
    // Strip trailing wildcard: "achilles-results-*" → "achilles-results-"
    // Then remove any trailing dash/wildcard characters to get the base.
    const base = (this.settings.indexPattern || 'achilles-results-*')
      .replace(/[\-\*]+$/, '');
    // Reversed prefix so it does NOT match "achilles-results-*"
    return `archived-${base}`;
  }

  /** Ensure the archive index exists with the correct mapping. */
  private async ensureArchiveIndex(): Promise<string> {
    const archiveIndex = this.getArchiveIndexName();
    const exists = await this.client.indices.exists({ index: archiveIndex });
    if (!exists) {
      const { RESULTS_INDEX_MAPPING } = await import('./index-management.service.js');
      await this.client.indices.create({
        index: archiveIndex,
        ...RESULTS_INDEX_MAPPING,
      });
    }
    return archiveIndex;
  }

  /**
   * Archive executions by group keys.
   * Group key format:
   *   "bundle::<bundle_id>::<hostname>" — all docs in a bundle execution
   *   "standalone::<test_uuid>::<hostname>" — a single standalone test execution
   */
  async archiveByGroupKeys(
    groupKeys: string[],
  ): Promise<{ archived: number; errors: string[] }> {
    const errors: string[] = [];
    const shouldClauses: any[] = [];

    for (const key of groupKeys) {
      if (key.startsWith('bundle::')) {
        const parts = key.split('::');
        if (parts.length < 3) {
          errors.push(`Invalid bundle group key: ${key}`);
          continue;
        }
        const bundleId = parts[1];
        const hostname = parts.slice(2).join('::');
        shouldClauses.push({
          bool: {
            filter: [
              { term: { 'f0rtika.bundle_id': bundleId } },
              { term: { 'routing.hostname': hostname } },
            ],
          },
        });
      } else if (key.startsWith('standalone::')) {
        const parts = key.split('::');
        if (parts.length < 3) {
          errors.push(`Invalid standalone group key: ${key}`);
          continue;
        }
        const testUuid = parts[1];
        const hostname = parts.slice(2).join('::');
        shouldClauses.push({
          bool: {
            filter: [
              { term: { 'f0rtika.test_uuid': testUuid } },
              { term: { 'routing.hostname': hostname } },
              { bool: { must_not: [{ term: { 'f0rtika.is_bundle_control': true } }] } },
            ],
          },
        });
      } else {
        errors.push(`Unknown group key prefix: ${key}`);
      }
    }

    if (shouldClauses.length === 0) {
      return { archived: 0, errors };
    }

    const query = {
      bool: {
        filter: [this.buildTestDataFilter()],
        should: shouldClauses,
        minimum_should_match: 1,
      },
    };

    const archiveIndex = await this.ensureArchiveIndex();

    // Step 1: Reindex to archive
    const reindexResult = await this.client.reindex({
      source: { index: this.settings.indexPattern, query },
      dest: { index: archiveIndex },
      refresh: true,
    });

    const archived = (reindexResult as any).total || 0;

    if (archived === 0) {
      return { archived: 0, errors };
    }

    // Step 2: Delete from source
    await this.client.deleteByQuery({
      index: this.settings.indexPattern,
      query,
      refresh: true,
    });

    return { archived, errors };
  }

  /** Archive all executions before a given date. */
  async archiveByDateRange(
    before: string,
  ): Promise<{ archived: number; errors: string[] }> {
    const errors: string[] = [];

    const query = {
      bool: {
        filter: [
          this.buildTestDataFilter(),
          { range: { 'routing.event_time': { lt: before } } },
        ],
      },
    };

    const archiveIndex = await this.ensureArchiveIndex();

    const reindexResult = await this.client.reindex({
      source: { index: this.settings.indexPattern, query },
      dest: { index: archiveIndex },
      refresh: true,
    });

    const archived = (reindexResult as any).total || 0;

    if (archived === 0) {
      return { archived: 0, errors };
    }

    await this.client.deleteByQuery({
      index: this.settings.indexPattern,
      query,
      refresh: true,
    });

    return { archived, errors };
  }
}
