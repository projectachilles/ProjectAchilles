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
} from '../../types/analytics.js';

export class ElasticsearchService {
  private client: Client;
  private settings: AnalyticsSettings;

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

  // Get overall defense score
  async getDefenseScore(params: AnalyticsQueryParams): Promise<DefenseScoreResponse> {
    const filters: any[] = [this.buildDateFilter(params.from, params.to)];

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

    // Calculate delta (compare with prior period)
    let delta: number | null = null;

    if (!params.from && !params.to) {
      const priorFilters: any[] = [
        { range: { 'routing.event_time': { gte: 'now-14d', lt: 'now-7d' } } },
      ];
      if (orgFilter) priorFilters.push(orgFilter);

      try {
        const priorResponse = await this.client.search({
          index: this.settings.indexPattern,
          size: 0,
          query: {
            bool: { filter: priorFilters },
          },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        });

        const priorTotal =
          typeof priorResponse.hits.total === 'number'
            ? priorResponse.hits.total
            : priorResponse.hits.total?.value || 0;

        const priorProtected =
          (priorResponse.aggregations?.protected as any)?.doc_count || 0;
        const priorScore = priorTotal > 0 ? (priorProtected / priorTotal) * 100 : 0;

        if (priorTotal > 0) {
          delta = overall - priorScore;
        }
      } catch {
        // Ignore delta calculation errors
      }
    }

    return {
      overall: Math.round(overall * 100) / 100,
      delta: delta !== null ? Math.round(delta * 100) / 100 : null,
      total,
      protected: protectedCount,
    };
  }

  // Get defense score trend over time
  async getDefenseScoreTrend(params: AnalyticsQueryParams): Promise<TrendDataPoint[]> {
    const filters: any[] = [this.buildDateFilter(params.from, params.to)];

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

  // Get defense score by test
  async getDefenseScoreByTest(params: AnalyticsQueryParams): Promise<BreakdownItem[]> {
    const filters: any[] = [this.buildDateFilter(params.from, params.to)];

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
    const filters: any[] = [this.buildDateFilter(params.from, params.to)];

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
    const filters: any[] = [this.buildDateFilter(params.from, params.to)];

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

    // Known organization mapping
    const orgNames: Record<string, string> = {
      '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': 'SB',
      'b2f8dccb-6d23-492e-aa87-a0a8a6103189': 'TPSGL',
      '9634119d-fa6b-42b8-9b9b-90ad8f22e482': 'RGA',
    };

    // Helper to get field value - handles both nested and flattened field names
    function getField(source: any, path: string): any {
      // First try flattened format (e.g., "f0rtika.test_name" as a key)
      if (source[path] !== undefined) {
        return source[path];
      }
      // Then try nested format (e.g., source.f0rtika.test_name)
      const parts = path.split('.');
      let value = source;
      for (const part of parts) {
        if (value === undefined || value === null) return undefined;
        value = value[part];
      }
      return value;
    }

    return response.hits.hits.map((hit: any) => {
      const source = hit._source;
      const orgUuid = getField(source, 'routing.oid') || '';

      return {
        test_uuid: getField(source, 'f0rtika.test_uuid') || '',
        test_name: getField(source, 'f0rtika.test_name') || 'Unknown Test',
        hostname: getField(source, 'routing.hostname') || 'Unknown',
        is_protected: getField(source, 'f0rtika.is_protected') || false,
        org: orgNames[orgUuid] || (orgUuid ? orgUuid.substring(0, 8) : ''),
        timestamp: getField(source, 'routing.event_time') || '',
        error_code: getField(source, 'event.ERROR'),
        error_name: getField(source, 'f0rtika.error_name'),
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
  async getUniqueHostnames(org?: string): Promise<number> {
    const filters: any[] = [this.buildDateFilter()];

    const orgFilter = this.buildOrgFilter(org);
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
  async getUniqueTests(org?: string): Promise<number> {
    const filters: any[] = [this.buildDateFilter()];

    const orgFilter = this.buildOrgFilter(org);
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
}
