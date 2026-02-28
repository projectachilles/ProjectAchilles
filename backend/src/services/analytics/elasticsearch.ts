// Elasticsearch service for analytics queries

import { Client } from '@elastic/elasticsearch';
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

  // Get overall defense score
  async getDefenseScore(params: AnalyticsQueryParams): Promise<DefenseScoreResponse> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        protected: {
          filter: { term: { 'f0rtika.is_protected': true } },
        },
      },
    });

    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value || 0;

    const protectedCount = (response.aggregations?.protected as any)?.doc_count || 0;
    const overall = total > 0 ? (protectedCount / total) * 100 : 0;
    const unprotectedCount = total - protectedCount;

    return {
      score: Math.round(overall * 100) / 100,
      protectedCount,
      unprotectedCount,
      totalExecutions: total,
    };
  }

  // Get defense score trend over time
  async getDefenseScoreTrend(params: AnalyticsQueryParams): Promise<TrendDataPoint[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const interval = params.interval || 'day';

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
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.over_time as any)?.buckets || [];

    return buckets.map((bucket: any) => {
      const total = bucket.doc_count;
      const protectedCount = bucket.protected?.doc_count || 0;
      const score = total > 0 ? (protectedCount / total) * 100 : 0;

      return {
        timestamp: bucket.key_as_string,
        score: Math.round(score * 100) / 100,
        total,
        protected: protectedCount,
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
  async getDefenseScoreTrendRolling(params: AnalyticsQueryParams): Promise<TrendDataPoint[]> {
    const windowDays = params.windowDays || 7;
    const displayFrom = params.from;

    // Extend date range to include lookback period
    const extendedFrom = this.extendDateRange(params.from, windowDays);

    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(extendedFrom, params.to),
      this.buildConclusiveResultsFilter()
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

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
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.over_time as any)?.buckets || [];

    // Compute rolling sums
    const rollingResults: TrendDataPoint[] = [];

    for (let i = 0; i < buckets.length; i++) {
      const currentBucket = buckets[i];
      const timestamp = currentBucket.key_as_string;

      // Sum over the window (current day + previous windowDays-1 days)
      let windowTotal = 0;
      let windowProtected = 0;

      const windowStart = Math.max(0, i - windowDays + 1);
      for (let j = windowStart; j <= i; j++) {
        windowTotal += buckets[j].doc_count;
        windowProtected += buckets[j].protected?.doc_count || 0;
      }

      // Skip points that are in the lookback-only period
      if (!this.isWithinDisplayRange(currentBucket.key.toString(), displayFrom)) {
        continue;
      }

      const score = windowTotal > 0 ? (windowProtected / windowTotal) * 100 : 0;

      rollingResults.push({
        timestamp,
        score: Math.round(score * 100) / 100,
        total: windowTotal,
        protected: windowProtected,
      });
    }

    return rollingResults;
  }

  // Get defense score by test
  async getDefenseScoreByTest(params: AnalyticsQueryParams): Promise<BreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_test: {
          terms: { field: 'f0rtika.test_name', size: params.limit || 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_test as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          name: bucket.key,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
        };
      })
      .sort((a: BreakdownItem, b: BreakdownItem) => b.score - a.score);
  }

  // Get defense score by technique
  async getDefenseScoreByTechnique(params: AnalyticsQueryParams): Promise<BreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

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
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_technique as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          name: bucket.key,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
        };
      })
      .sort((a: BreakdownItem, b: BreakdownItem) => b.score - a.score);
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
  async getUniqueHostnames(params: AnalyticsQueryParams): Promise<number> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

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
  async getUniqueTests(params: AnalyticsQueryParams): Promise<number> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

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
  async getResultsByErrorType(params: AnalyticsQueryParams): Promise<ErrorTypeBreakdown[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) filters.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) filters.push(techniquesFilter);

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
  async getTestCoverage(params: AnalyticsQueryParams): Promise<TestCoverageItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) filters.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) filters.push(techniquesFilter);

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
  async getTechniqueDistribution(params: AnalyticsQueryParams): Promise<TechniqueDistributionItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) filters.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) filters.push(techniquesFilter);

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
  async getHostTestMatrix(params: AnalyticsQueryParams): Promise<HostTestMatrixCell[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) filters.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) filters.push(techniquesFilter);

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
  async getDefenseScoreByOrg(params: AnalyticsQueryParams): Promise<OrgBreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];

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

  // Build all extended filters
  private buildExtendedFilters(params: PaginatedExecutionsParams): any[] {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) filters.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) filters.push(techniquesFilter);

    const hostnamesFilter = this.buildHostnamesFilter(params.hostnames);
    if (hostnamesFilter) filters.push(hostnamesFilter);

    const categoriesFilter = this.buildCategoriesFilter(params.categories);
    if (categoriesFilter) filters.push(categoriesFilter);

    const severitiesFilter = this.buildSeveritiesFilter(params.severities);
    if (severitiesFilter) filters.push(severitiesFilter);

    const threatActorsFilter = this.buildThreatActorsFilter(params.threatActors);
    if (threatActorsFilter) filters.push(threatActorsFilter);

    const tagsFilter = this.buildTagsFilter(params.tags);
    if (tagsFilter) filters.push(tagsFilter);

    const errorNamesFilter = this.buildErrorNamesFilter(params.errorNames);
    if (errorNamesFilter) filters.push(errorNamesFilter);

    const errorCodesFilter = this.buildErrorCodesFilter(params.errorCodes);
    if (errorCodesFilter) filters.push(errorCodesFilter);

    const resultFilter = this.buildResultFilter(params.result);
    if (resultFilter) filters.push(resultFilter);

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

    // Painless script that computes a display group key per document:
    //   bundle controls → "bundle::<bundle_id>::<hostname>"
    //   standalone tests → "standalone::<test_uuid>::<hostname>"
    const groupKeyScript = {
      source: `
        if (doc.containsKey('f0rtika.is_bundle_control')
            && doc['f0rtika.is_bundle_control'].size() > 0
            && doc['f0rtika.is_bundle_control'].value == true) {
          return 'bundle::' + doc['f0rtika.bundle_id'].value + '::' + doc['routing.hostname'].value;
        } else {
          return 'standalone::' + doc['f0rtika.test_uuid'].value + '::' + doc['routing.hostname'].value;
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

  // Get defense score by severity
  async getDefenseScoreBySeverity(params: AnalyticsQueryParams): Promise<SeverityBreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];
    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        by_severity: {
          terms: { field: 'f0rtika.severity', size: 10 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_severity as any)?.buckets || [];
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          severity: bucket.key as SeverityLevel,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
        };
      })
      .sort((a: SeverityBreakdownItem, b: SeverityBreakdownItem) =>
        severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
      );
  }

  // Get defense score by category
  async getDefenseScoreByCategory(params: AnalyticsQueryParams): Promise<CategoryBreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];
    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        by_category: {
          terms: { field: 'f0rtika.category', size: 20 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_category as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          category: bucket.key as CategoryType,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
        };
      })
      .sort((a: CategoryBreakdownItem, b: CategoryBreakdownItem) => b.score - a.score);
  }

  // Get defense score by category with nested subcategories
  async getDefenseScoreByCategoryWithSubcategories(params: AnalyticsQueryParams): Promise<CategorySubcategoryBreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];
    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        by_category: {
          terms: { field: 'f0rtika.category', size: 20 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            by_subcategory: {
              terms: { field: 'f0rtika.subcategory', size: 50 },
              aggs: {
                protected: {
                  filter: { term: { 'f0rtika.is_protected': true } },
                },
              },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_category as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        const subBuckets = bucket.by_subcategory?.buckets || [];
        const subcategories: SubcategoryBreakdownItem[] = subBuckets
          .map((sub: any) => {
            const subTotal = sub.doc_count;
            const subProtected = sub.protected?.doc_count || 0;
            const subScore = subTotal > 0 ? (subProtected / subTotal) * 100 : 0;
            return {
              subcategory: sub.key,
              score: Math.round(subScore * 100) / 100,
              count: subTotal,
              protected: subProtected,
              unprotected: subTotal - subProtected,
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
  async getDefenseScoreByHostname(params: AnalyticsQueryParams): Promise<DefenseScoreByHostItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_hostname: {
          terms: { field: 'routing.hostname', size: params.limit || 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_hostname as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const unprotectedCount = total - protectedCount;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          hostname: bucket.key,
          score: Math.round(score * 100) / 100,
          protected: protectedCount,
          unprotected: unprotectedCount,
          total,
        };
      })
      .sort((a: DefenseScoreByHostItem, b: DefenseScoreByHostItem) => b.total - a.total);
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
  async getThreatActorCoverage(params: AnalyticsQueryParams): Promise<ThreatActorCoverageItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter()
    ];
    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

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
  async getErrorRateTrendRolling(params: AnalyticsQueryParams): Promise<ErrorRateTrendDataPoint[]> {
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
  async getErrorRate(params: AnalyticsQueryParams): Promise<ErrorRateResponse> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildTestActivityFilter()  // excludes code 200
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

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
