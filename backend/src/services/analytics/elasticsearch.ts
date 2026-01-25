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
  ThreatActorCoverageItem,
  DefenseScoreByHostItem,
  CanonicalTestCountResponse,
  SeverityLevel,
  CategoryType,
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

  // Get overall defense score
  async getDefenseScore(params: AnalyticsQueryParams): Promise<DefenseScoreResponse> {
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
      this.buildDateFilter(params.from, params.to)
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

  // Get defense score by test
  async getDefenseScoreByTest(params: AnalyticsQueryParams): Promise<BreakdownItem[]> {
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
        by_error_type: {
          terms: { field: 'f0rtika.error_name', size: 20 },
        },
      },
    });

    const buckets = (response.aggregations?.by_error_type as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      name: bucket.key,
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
      this.buildDateFilter(params.from, params.to)
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

    // Known organization mapping
    const orgNames: Record<string, string> = {
      '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': 'SB',
      'b2f8dccb-6d23-492e-aa87-a0a8a6103189': 'TPSGL',
      '9634119d-fa6b-42b8-9b9b-90ad8f22e482': 'RGA',
    };

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          org: bucket.key,
          orgName: orgNames[bucket.key] || bucket.key.substring(0, 8),
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

  // Build result filter (protected/unprotected)
  private buildResultFilter(result?: 'all' | 'protected' | 'unprotected'): any | null {
    if (!result || result === 'all') return null;
    return { term: { 'f0rtika.is_protected': result === 'protected' } };
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

    // Known organization mapping
    const orgNames: Record<string, string> = {
      '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': 'SB',
      'b2f8dccb-6d23-492e-aa87-a0a8a6103189': 'TPSGL',
      '9634119d-fa6b-42b8-9b9b-90ad8f22e482': 'RGA',
    };

    // Helper to get field value
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

    const data: EnrichedTestExecution[] = response.hits.hits.map((hit: any) => {
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
        // Enriched fields
        category: getField(source, 'f0rtika.category') as CategoryType | undefined,
        subcategory: getField(source, 'f0rtika.subcategory'),
        severity: getField(source, 'f0rtika.severity') as SeverityLevel | undefined,
        tactics: getField(source, 'f0rtika.tactics'),
        target: getField(source, 'f0rtika.target'),
        complexity: getField(source, 'f0rtika.complexity'),
        threat_actor: getField(source, 'f0rtika.threat_actor'),
        tags: getField(source, 'f0rtika.tags'),
        score: getField(source, 'f0rtika.score'),
      };
    });

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

  // Get defense score by severity
  async getDefenseScoreBySeverity(params: AnalyticsQueryParams): Promise<SeverityBreakdownItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
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
      this.buildDateFilter(params.from, params.to)
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

  // Get defense score by hostname
  async getDefenseScoreByHostname(params: AnalyticsQueryParams): Promise<DefenseScoreByHostItem[]> {
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
      this.buildDateFilter(params.from, params.to)
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
}
