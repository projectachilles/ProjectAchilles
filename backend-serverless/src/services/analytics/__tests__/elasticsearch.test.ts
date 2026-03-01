import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, PaginatedExecutionsParams } from '../../../types/analytics.js';

// ─── Mock setup ───────────────────────────────────────────────────
const mockSearch = vi.fn();
const mockCount = vi.fn();
const mockInfo = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
    this.count = mockCount;
    this.info = mockInfo;
  }),
}));

// Mock the risk-acceptance service so buildDefenseScoreFilters doesn't
// trigger a real ES search for active acceptances. Returns no exclusions.
vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService, resolveErrorName, ERROR_CODE_MAP } =
  await import('../elasticsearch.js');

// ─── Helpers ──────────────────────────────────────────────────────
function makeSettings(overrides?: Partial<AnalyticsSettings>): AnalyticsSettings {
  return {
    connectionType: 'direct',
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'f0rtika-*',
    configured: true,
    ...overrides,
  };
}

function makeParams(overrides?: Partial<AnalyticsQueryParams>): AnalyticsQueryParams {
  return { from: '2025-01-01T00:00:00Z', to: '2025-01-31T23:59:59Z', ...overrides };
}

function esSearchResponse({ total = 0, aggs = {}, hits = [] }: {
  total?: number | { value: number; relation: string };
  aggs?: Record<string, unknown>;
  hits?: unknown[];
}) {
  return {
    hits: {
      total: typeof total === 'number' ? { value: total, relation: 'eq' } : total,
      hits: hits.map(h => (typeof h === 'object' && h !== null && '_source' in (h as any) ? h : { _source: h })),
    },
    aggregations: aggs,
  };
}

function esCountResponse(count: number) {
  return { count };
}

function makeScoreBuckets(items: { key: string; total: number; protected: number }[]) {
  return items.map(i => ({ key: i.key, doc_count: i.total, protected: { doc_count: i.protected } }));
}

function makeDateBuckets(items: {
  key: number; key_as_string: string; total: number; protected?: number;
  errors?: number; conclusive?: number;
}[]) {
  return items.map(i => ({
    key: i.key,
    key_as_string: i.key_as_string,
    doc_count: i.total,
    protected: { doc_count: i.protected ?? 0 },
    errors: { doc_count: i.errors ?? 0 },
    conclusive: { doc_count: i.conclusive ?? 0 },
  }));
}

function makeHitSource(overrides?: Record<string, unknown>) {
  return {
    'f0rtika.test_uuid': 'uuid-001',
    'f0rtika.test_name': 'Test Alpha',
    'routing.hostname': 'host-a',
    'f0rtika.is_protected': true,
    'routing.oid': '09b59276-9efb-4d3d-bbdd-4b4663ef0c42',
    'routing.event_time': '2025-01-15T12:00:00Z',
    'event.ERROR': 126,
    'f0rtika.error_name': 'ExecutionPrevented',
    ...overrides,
  };
}

function createService(settingsOverrides?: Partial<AnalyticsSettings>) {
  return new ElasticsearchService(makeSettings(settingsOverrides));
}

// ─── Tests ────────────────────────────────────────────────────────
describe('elasticsearch.ts', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockCount.mockReset();
    mockInfo.mockReset();
  });

  // ================================================================
  // Group 1: Pure exports
  // ================================================================
  describe('ERROR_CODE_MAP', () => {
    it('contains all 9 expected error codes', () => {
      expect(Object.keys(ERROR_CODE_MAP).map(Number).sort((a, b) => a - b))
        .toEqual([0, 1, 101, 105, 126, 127, 200, 259, 999]);
    });

    it('has correct categories for each code', () => {
      expect(ERROR_CODE_MAP[101].category).toBe('failed');
      expect(ERROR_CODE_MAP[105].category).toBe('protected');
      expect(ERROR_CODE_MAP[126].category).toBe('protected');
      expect(ERROR_CODE_MAP[127].category).toBe('protected');
      expect(ERROR_CODE_MAP[0].category).toBe('inconclusive');
      expect(ERROR_CODE_MAP[999].category).toBe('error');
    });
  });

  describe('resolveErrorName', () => {
    it('resolves known code to canonical name', () => {
      expect(resolveErrorName(126)).toBe('ExecutionPrevented');
    });

    it('falls back to storedName for unknown code', () => {
      expect(resolveErrorName(42, 'CustomError')).toBe('CustomError');
    });

    it('returns Unknown (code) when no mapping and no storedName', () => {
      expect(resolveErrorName(42)).toBe('Unknown (42)');
    });

    it('returns Unknown (?) when code is undefined', () => {
      expect(resolveErrorName(undefined)).toBe('Unknown (?)');
    });
  });

  // ================================================================
  // Group 2: Constructor
  // ================================================================
  describe('constructor', () => {
    it('creates client with cloud config', () => {
      const svc = createService({ connectionType: 'cloud', cloudId: 'my-cloud:abc', apiKey: 'key' });
      expect(svc).toBeDefined();
    });

    it('creates client with direct + apiKey config', () => {
      const svc = createService({ connectionType: 'direct', node: 'http://es:9200', apiKey: 'k' });
      expect(svc).toBeDefined();
    });

    it('creates client with direct + username/password config', () => {
      const svc = createService({ connectionType: 'direct', node: 'http://es:9200', apiKey: undefined, username: 'user', password: 'pass' });
      expect(svc).toBeDefined();
    });

    it('throws when no cloud/no node', () => {
      expect(() => createService({ connectionType: 'direct', node: undefined, cloudId: undefined }))
        .toThrow('Invalid Elasticsearch configuration');
    });
  });

  // ================================================================
  // Group 3: testConnection
  // ================================================================
  describe('testConnection', () => {
    it('returns ES version string', async () => {
      mockInfo.mockResolvedValue({ version: { number: '8.17.0' } });
      const svc = createService();
      expect(await svc.testConnection()).toBe('8.17.0');
    });

    it('propagates connection errors', async () => {
      mockInfo.mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = createService();
      await expect(svc.testConnection()).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ================================================================
  // Group 4: getDefenseScore (Pattern 1 — Score Aggregation)
  // ================================================================
  describe('getDefenseScore', () => {
    it('computes 70.0 when 70/100 protected', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 100,
        aggs: { protected: { doc_count: 70 } },
      }));
      const svc = createService();
      const result = await svc.getDefenseScore(makeParams());
      expect(result.score).toBe(70);
      expect(result.protectedCount).toBe(70);
      expect(result.unprotectedCount).toBe(30);
      expect(result.totalExecutions).toBe(100);
    });

    it('returns score=0 when 0 results', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 0, aggs: { protected: { doc_count: 0 } } }));
      const svc = createService();
      const result = await svc.getDefenseScore(makeParams());
      expect(result.score).toBe(0);
      expect(result.totalExecutions).toBe(0);
    });

    it('rounds to 2 decimal places (1/3 = 33.33)', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 3,
        aggs: { protected: { doc_count: 1 } },
      }));
      const svc = createService();
      const result = await svc.getDefenseScore(makeParams());
      expect(result.score).toBe(33.33);
    });

    it('handles numeric hits.total format (backward compat)', async () => {
      mockSearch.mockResolvedValue({
        hits: { total: 50, hits: [] },
        aggregations: { protected: { doc_count: 25 } },
      });
      const svc = createService();
      const result = await svc.getDefenseScore(makeParams());
      expect(result.score).toBe(50);
      expect(result.totalExecutions).toBe(50);
    });

    it('includes org filter when params.org is set', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 10, aggs: { protected: { doc_count: 5 } } }));
      const svc = createService();
      await svc.getDefenseScore(makeParams({ org: 'org-uuid' }));

      const callArg = mockSearch.mock.calls[0][0];
      const filters = callArg.query.bool.filter;
      expect(filters).toContainEqual({ term: { 'routing.oid': 'org-uuid' } });
    });

    it('defaults to now-7d when no from/to', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 5, aggs: { protected: { doc_count: 3 } } }));
      const svc = createService();
      await svc.getDefenseScore({});

      const callArg = mockSearch.mock.calls[0][0];
      const filters = callArg.query.bool.filter;
      expect(filters).toContainEqual({ range: { 'routing.event_time': { gte: 'now-7d' } } });
    });
  });

  // ================================================================
  // Group 5: getDefenseScoreTrend (Pattern 2 — Date Histogram)
  // ================================================================
  describe('getDefenseScoreTrend', () => {
    it('maps buckets to TrendDataPoint[]', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 0,
        aggs: {
          over_time: {
            buckets: makeDateBuckets([
              { key: 1704067200000, key_as_string: '2024-01-01', total: 10, protected: 7 },
              { key: 1704153600000, key_as_string: '2024-01-02', total: 20, protected: 18 },
            ]),
          },
        },
      }));

      const svc = createService();
      const result = await svc.getDefenseScoreTrend(makeParams());
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timestamp: '2024-01-01', score: 70, total: 10, protected: 7 });
      expect(result[1]).toEqual({ timestamp: '2024-01-02', score: 90, total: 20, protected: 18 });
    });

    it('returns [] for empty buckets', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 0, aggs: { over_time: { buckets: [] } } }));
      const svc = createService();
      expect(await svc.getDefenseScoreTrend(makeParams())).toEqual([]);
    });

    it('returns score=0 for zero-count bucket (not NaN)', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 0,
        aggs: { over_time: { buckets: makeDateBuckets([{ key: 1, key_as_string: '2024-01-01', total: 0, protected: 0 }]) } },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreTrend(makeParams());
      expect(result[0].score).toBe(0);
      expect(Number.isNaN(result[0].score)).toBe(false);
    });

    it('uses provided interval param', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 0, aggs: { over_time: { buckets: [] } } }));
      const svc = createService();
      await svc.getDefenseScoreTrend(makeParams({ interval: 'week' }));

      const callArg = mockSearch.mock.calls[0][0];
      expect(callArg.aggs.over_time.date_histogram.calendar_interval).toBe('week');
    });

    it('defaults interval to day', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 0, aggs: { over_time: { buckets: [] } } }));
      const svc = createService();
      await svc.getDefenseScoreTrend(makeParams());

      const callArg = mockSearch.mock.calls[0][0];
      expect(callArg.aggs.over_time.date_histogram.calendar_interval).toBe('day');
    });
  });

  // ================================================================
  // Group 6: getDefenseScoreTrendRolling (Pattern 3 — Rolling Window)
  // ================================================================
  describe('getDefenseScoreTrendRolling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-20T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('computes rolling sum correctly over windowDays', async () => {
      // 3-day window, 4 buckets, from=2025-01-17 so all visible
      const buckets = makeDateBuckets([
        { key: Date.parse('2025-01-17T00:00:00Z'), key_as_string: '2025-01-17', total: 10, protected: 5 },
        { key: Date.parse('2025-01-18T00:00:00Z'), key_as_string: '2025-01-18', total: 10, protected: 8 },
        { key: Date.parse('2025-01-19T00:00:00Z'), key_as_string: '2025-01-19', total: 10, protected: 6 },
        { key: Date.parse('2025-01-20T00:00:00Z'), key_as_string: '2025-01-20', total: 10, protected: 9 },
      ]);
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets } } }));

      const svc = createService();
      const result = await svc.getDefenseScoreTrendRolling(makeParams({
        from: '2025-01-17T00:00:00Z',
        to: '2025-01-20T23:59:59Z',
        windowDays: 3,
      }));

      // Bucket[2] (Jan 19): window covers [17,18,19] → total=30, protected=19 → 63.33
      expect(result.length).toBeGreaterThanOrEqual(3);
      const jan19 = result.find(r => r.timestamp === '2025-01-19');
      expect(jan19).toBeDefined();
      expect(jan19!.total).toBe(30);
      expect(jan19!.protected).toBe(19);
      expect(jan19!.score).toBe(63.33);
    });

    it('filters out lookback-period points before displayFrom', async () => {
      // 3-day window with from=now-3d; ES gets extended range
      // First bucket is in lookback period → filtered out
      const buckets = makeDateBuckets([
        { key: Date.parse('2025-01-15T00:00:00Z'), key_as_string: '2025-01-15', total: 5, protected: 2 },
        { key: Date.parse('2025-01-16T00:00:00Z'), key_as_string: '2025-01-16', total: 5, protected: 3 },
        { key: Date.parse('2025-01-17T00:00:00Z'), key_as_string: '2025-01-17', total: 5, protected: 4 },
        { key: Date.parse('2025-01-18T00:00:00Z'), key_as_string: '2025-01-18', total: 5, protected: 5 },
        { key: Date.parse('2025-01-19T00:00:00Z'), key_as_string: '2025-01-19', total: 5, protected: 5 },
        { key: Date.parse('2025-01-20T00:00:00Z'), key_as_string: '2025-01-20', total: 5, protected: 5 },
      ]);
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets } } }));

      const svc = createService();
      const result = await svc.getDefenseScoreTrendRolling(makeParams({
        from: 'now-3d',
        windowDays: 3,
      }));

      // now-3d from Jan 20 = Jan 17 cutoff. Points before Jan 17 should be excluded
      const timestamps = result.map(r => r.timestamp);
      expect(timestamps).not.toContain('2025-01-15');
      expect(timestamps).not.toContain('2025-01-16');
    });

    it('defaults windowDays to 7', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets: [] } } }));
      const svc = createService();
      await svc.getDefenseScoreTrendRolling(makeParams({ from: undefined, to: undefined }));

      // Extended date range: default 7d + windowDays(7) - 1 = 13d
      const callArg = mockSearch.mock.calls[0][0];
      const dateFilter = callArg.query.bool.filter.find(
        (f: any) => f.range?.['routing.event_time']
      );
      expect(dateFilter.range['routing.event_time'].gte).toBe('now-13d');
    });

    it('handles empty buckets gracefully', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets: [] } } }));
      const svc = createService();
      const result = await svc.getDefenseScoreTrendRolling(makeParams({ from: 'now-7d' }));
      expect(result).toEqual([]);
    });

    it('returns score=0 for all-zero window', async () => {
      const buckets = makeDateBuckets([
        { key: Date.parse('2025-01-19T00:00:00Z'), key_as_string: '2025-01-19', total: 0, protected: 0 },
        { key: Date.parse('2025-01-20T00:00:00Z'), key_as_string: '2025-01-20', total: 0, protected: 0 },
      ]);
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets } } }));

      const svc = createService();
      const result = await svc.getDefenseScoreTrendRolling(makeParams({ from: 'now-3d', windowDays: 2 }));
      for (const point of result) {
        expect(point.score).toBe(0);
        expect(Number.isNaN(point.score)).toBe(false);
      }
    });

    describe('extendDateRange (tested via rolling queries)', () => {
      it('extends now-Xd format', async () => {
        mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets: [] } } }));
        const svc = createService();
        await svc.getDefenseScoreTrendRolling(makeParams({ from: 'now-10d', windowDays: 5 }));

        const callArg = mockSearch.mock.calls[0][0];
        const dateFilter = callArg.query.bool.filter.find(
          (f: any) => f.range?.['routing.event_time']
        );
        // 10 + 5 - 1 = 14
        expect(dateFilter.range['routing.event_time'].gte).toBe('now-14d');
      });

      it('extends ISO date by subtracting windowDays-1', async () => {
        mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets: [] } } }));
        const svc = createService();
        await svc.getDefenseScoreTrendRolling(makeParams({
          from: '2025-01-15T00:00:00Z',
          windowDays: 4,
        }));

        const callArg = mockSearch.mock.calls[0][0];
        const dateFilter = callArg.query.bool.filter.find(
          (f: any) => f.range?.['routing.event_time']
        );
        // Jan 15 - 3 days = Jan 12
        const gte = dateFilter.range['routing.event_time'].gte;
        expect(new Date(gte).getUTCDate()).toBe(12);
      });

      it('falls back to default when no from', async () => {
        mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets: [] } } }));
        const svc = createService();
        await svc.getDefenseScoreTrendRolling(makeParams({ from: undefined, windowDays: 5 }));

        const callArg = mockSearch.mock.calls[0][0];
        const dateFilter = callArg.query.bool.filter.find(
          (f: any) => f.range?.['routing.event_time']
        );
        // default: 7 + 5 - 1 = 11
        expect(dateFilter.range['routing.event_time'].gte).toBe('now-11d');
      });
    });
  });

  // ================================================================
  // Group 7: getDefenseScoreByTest (Pattern 4 — Terms Breakdown)
  // ================================================================
  describe('getDefenseScoreByTest', () => {
    it('maps to BreakdownItem[] sorted by score desc', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_test: {
            buckets: makeScoreBuckets([
              { key: 'Test A', total: 10, protected: 5 },
              { key: 'Test B', total: 10, protected: 9 },
            ]),
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByTest(makeParams());
      expect(result[0].name).toBe('Test B');
      expect(result[0].score).toBe(90);
      expect(result[1].name).toBe('Test A');
      expect(result[1].score).toBe(50);
    });

    it('returns [] for empty buckets', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { by_test: { buckets: [] } } }));
      const svc = createService();
      expect(await svc.getDefenseScoreByTest(makeParams())).toEqual([]);
    });

    it('rounds score to 2 decimal places', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { by_test: { buckets: makeScoreBuckets([{ key: 'T', total: 3, protected: 1 }]) } },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByTest(makeParams());
      expect(result[0].score).toBe(33.33);
    });

    it('respects limit param for terms size', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { by_test: { buckets: [] } } }));
      const svc = createService();
      await svc.getDefenseScoreByTest(makeParams({ limit: 10 }));

      const callArg = mockSearch.mock.calls[0][0];
      expect(callArg.aggs.by_test.terms.size).toBe(10);
    });

    it('defaults terms size to 50', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { by_test: { buckets: [] } } }));
      const svc = createService();
      await svc.getDefenseScoreByTest(makeParams());

      const callArg = mockSearch.mock.calls[0][0];
      expect(callArg.aggs.by_test.terms.size).toBe(50);
    });
  });

  // ================================================================
  // Group 8: getRecentExecutions (Pattern 5 — Hit Mapping)
  // ================================================================
  describe('getRecentExecutions', () => {
    it('maps _source to TestExecution with all fields', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 1,
        hits: [makeHitSource()],
      }));
      const svc = createService();
      const result = await svc.getRecentExecutions(makeParams());
      expect(result).toHaveLength(1);
      expect(result[0].test_uuid).toBe('uuid-001');
      expect(result[0].test_name).toBe('Test Alpha');
      expect(result[0].hostname).toBe('host-a');
      expect(result[0].is_protected).toBe(true);
      expect(result[0].error_code).toBe(126);
      expect(result[0].error_name).toBe('ExecutionPrevented');
    });

    it('maps known org UUID to short name', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 1,
        hits: [makeHitSource({ 'routing.oid': '09b59276-9efb-4d3d-bbdd-4b4663ef0c42' })],
      }));
      const svc = createService();
      const result = await svc.getRecentExecutions(makeParams());
      expect(result[0].org).toBe('SB');
    });

    it('maps unknown org UUID to first 8 chars', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 1,
        hits: [makeHitSource({ 'routing.oid': 'abcdef01-2345-6789-abcd-ef0123456789' })],
      }));
      const svc = createService();
      const result = await svc.getRecentExecutions(makeParams());
      expect(result[0].org).toBe('abcdef01');
    });

    it('handles nested field format via getField', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 1,
        hits: [{
          f0rtika: { test_uuid: 'nested-uuid', test_name: 'Nested Test', is_protected: false },
          routing: { hostname: 'nested-host', oid: '', event_time: '2025-01-01' },
          event: { ERROR: 101 },
        }],
      }));
      const svc = createService();
      const result = await svc.getRecentExecutions(makeParams());
      expect(result[0].test_uuid).toBe('nested-uuid');
      expect(result[0].hostname).toBe('nested-host');
    });

    it('defaults missing fields to safe values', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ total: 1, hits: [{}] }));
      const svc = createService();
      const result = await svc.getRecentExecutions(makeParams());
      expect(result[0].test_name).toBe('Unknown Test');
      expect(result[0].hostname).toBe('Unknown');
      expect(result[0].test_uuid).toBe('');
    });

    it('resolves error_name via resolveErrorName', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 1,
        hits: [makeHitSource({ 'event.ERROR': 101, 'f0rtika.error_name': 'SomeLegacy' })],
      }));
      const svc = createService();
      const result = await svc.getRecentExecutions(makeParams());
      // Code 101 is known → returns canonical "Unprotected", not legacy stored name
      expect(result[0].error_name).toBe('Unprotected');
    });
  });

  // ================================================================
  // Group 9: Cardinality methods
  // ================================================================
  describe('getUniqueHostnames', () => {
    it('returns cardinality value', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { unique_hostnames: { value: 42 } },
      }));
      const svc = createService();
      expect(await svc.getUniqueHostnames(makeParams())).toBe(42);
    });

    it('returns 0 when aggregation missing', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: {} }));
      const svc = createService();
      expect(await svc.getUniqueHostnames(makeParams())).toBe(0);
    });
  });

  describe('getUniqueTests', () => {
    it('targets f0rtika.test_uuid field', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { unique_tests: { value: 15 } },
      }));
      const svc = createService();
      await svc.getUniqueTests(makeParams());

      const callArg = mockSearch.mock.calls[0][0];
      expect(callArg.aggs.unique_tests.cardinality.field).toBe('f0rtika.test_uuid');
    });
  });

  // ================================================================
  // Group 10: getAvailableHostnames (Filter Dropdown)
  // ================================================================
  describe('getAvailableHostnames', () => {
    it('returns FilterOption[] from buckets', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          hostnames: { buckets: [{ key: 'host-a', doc_count: 10 }, { key: 'host-b', doc_count: 5 }] },
        },
      }));
      const svc = createService();
      const result = await svc.getAvailableHostnames(makeParams());
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ value: 'host-a', label: 'host-a', count: 10 });
    });

    it('skips date filter when no from/to', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { hostnames: { buckets: [] } } }));
      const svc = createService();
      await svc.getAvailableHostnames({});

      const callArg = mockSearch.mock.calls[0][0];
      const filters = callArg.query.bool.filter;
      // Should only have testDataFilter, no date range
      const hasDateRange = filters.some((f: any) => f.range?.['routing.event_time']);
      expect(hasDateRange).toBe(false);
    });

    it('applies date filter when from/to provided', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { hostnames: { buckets: [] } } }));
      const svc = createService();
      await svc.getAvailableHostnames(makeParams());

      const callArg = mockSearch.mock.calls[0][0];
      const filters = callArg.query.bool.filter;
      const hasDateRange = filters.some((f: any) => f.range?.['routing.event_time']);
      expect(hasDateRange).toBe(true);
    });

    it('works with params = undefined', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { hostnames: { buckets: [] } } }));
      const svc = createService();
      const result = await svc.getAvailableHostnames(undefined);
      expect(result).toEqual([]);
    });

    it('applies org filter when provided', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { hostnames: { buckets: [] } } }));
      const svc = createService();
      await svc.getAvailableHostnames(makeParams({ org: 'org-123' }));

      const callArg = mockSearch.mock.calls[0][0];
      const filters = callArg.query.bool.filter;
      expect(filters).toContainEqual({ term: { 'routing.oid': 'org-123' } });
    });
  });

  // ================================================================
  // Group 11: Severity/Error Dropdowns
  // ================================================================
  describe('getAvailableSeverities', () => {
    it('sorts by severity order and capitalizes label', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          severities: {
            buckets: [
              { key: 'low', doc_count: 5 },
              { key: 'critical', doc_count: 3 },
              { key: 'high', doc_count: 8 },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getAvailableSeverities(makeParams());
      expect(result[0].value).toBe('critical');
      expect(result[0].label).toBe('Critical');
      expect(result[1].value).toBe('high');
      expect(result[1].label).toBe('High');
      expect(result[2].value).toBe('low');
      expect(result[2].label).toBe('Low');
    });
  });

  describe('getAvailableErrorNames', () => {
    it('resolves error codes to canonical names', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          error_codes: { buckets: [{ key: 126, doc_count: 20 }, { key: 101, doc_count: 10 }] },
        },
      }));
      const svc = createService();
      const result = await svc.getAvailableErrorNames(makeParams());
      expect(result).toContainEqual(expect.objectContaining({ value: 'ExecutionPrevented', label: 'ExecutionPrevented' }));
      expect(result).toContainEqual(expect.objectContaining({ value: 'Unprotected', label: 'Unprotected' }));
    });
  });

  describe('getAvailableErrorCodes', () => {
    it('formats label as "code (Name)" and value as string', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          error_codes: { buckets: [{ key: 126, doc_count: 15 }] },
        },
      }));
      const svc = createService();
      const result = await svc.getAvailableErrorCodes(makeParams());
      expect(result[0].value).toBe('126');
      expect(result[0].label).toBe('126 (ExecutionPrevented)');
      expect(result[0].count).toBe(15);
    });

    it('sorts by count desc', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          error_codes: {
            buckets: [
              { key: 101, doc_count: 5 },
              { key: 126, doc_count: 20 },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getAvailableErrorCodes(makeParams());
      expect(result[0].count).toBeGreaterThanOrEqual(result[1].count);
    });
  });

  // ================================================================
  // Group 12: Complex Unique Methods
  // ================================================================
  describe('getOrganizations', () => {
    it('maps known UUID to shortName/fullName', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          orgs: { buckets: [{ key: '09b59276-9efb-4d3d-bbdd-4b4663ef0c42', doc_count: 100 }] },
        },
      }));
      const svc = createService();
      const result = await svc.getOrganizations();
      expect(result[0].shortName).toBe('SB');
      expect(result[0].fullName).toBe('Superintendency of Banks');
    });

    it('falls back to substring for unknown UUID', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          orgs: { buckets: [{ key: 'abcdef01-xxxx-yyyy-zzzz-000000000000', doc_count: 10 }] },
        },
      }));
      const svc = createService();
      const result = await svc.getOrganizations();
      expect(result[0].shortName).toBe('abcdef01');
      expect(result[0].fullName).toBe('abcdef01-xxxx-yyyy-zzzz-000000000000');
    });
  });

  describe('getPaginatedExecutions', () => {
    function makePaginatedParams(overrides?: Partial<PaginatedExecutionsParams>): PaginatedExecutionsParams {
      return {
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-31T23:59:59Z',
        page: 1,
        pageSize: 25,
        ...overrides,
      };
    }

    it('returns correct pagination metadata', async () => {
      mockCount.mockResolvedValue(esCountResponse(100));
      mockSearch.mockResolvedValue(esSearchResponse({ total: 100, hits: [] }));

      const svc = createService();
      const result = await svc.getPaginatedExecutions(makePaginatedParams({ page: 2, pageSize: 25 }));
      expect(result.pagination.totalItems).toBe(100);
      expect(result.pagination.totalPages).toBe(4);
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrevious).toBe(true);
      expect(result.pagination.page).toBe(2);
    });

    it('caps pageSize at 100', async () => {
      mockCount.mockResolvedValue(esCountResponse(0));
      mockSearch.mockResolvedValue(esSearchResponse({ hits: [] }));

      const svc = createService();
      await svc.getPaginatedExecutions(makePaginatedParams({ pageSize: 200 }));

      const searchCall = mockSearch.mock.calls[0][0];
      expect(searchCall.size).toBe(100);
    });

    it('defaults page=1 and pageSize=25', async () => {
      mockCount.mockResolvedValue(esCountResponse(50));
      mockSearch.mockResolvedValue(esSearchResponse({ hits: [] }));

      const svc = createService();
      const result = await svc.getPaginatedExecutions(makePaginatedParams({ page: undefined, pageSize: undefined }));
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.pageSize).toBe(25);
    });

    it('computes correct from offset', async () => {
      mockCount.mockResolvedValue(esCountResponse(100));
      mockSearch.mockResolvedValue(esSearchResponse({ hits: [] }));

      const svc = createService();
      await svc.getPaginatedExecutions(makePaginatedParams({ page: 3, pageSize: 20 }));

      const searchCall = mockSearch.mock.calls[0][0];
      expect(searchCall.from).toBe(40); // (3-1) * 20
    });

    it('includes enriched fields in mapped data', async () => {
      mockCount.mockResolvedValue(esCountResponse(1));
      mockSearch.mockResolvedValue(esSearchResponse({
        total: 1,
        hits: [makeHitSource({
          'f0rtika.category': 'intel-driven',
          'f0rtika.subcategory': 'apt-simulation',
          'f0rtika.severity': 'critical',
          'f0rtika.tactics': ['TA0001'],
          'f0rtika.target': 'windows',
          'f0rtika.complexity': 'high',
          'f0rtika.threat_actor': 'APT29',
          'f0rtika.tags': ['ransomware'],
          'f0rtika.score': 9,
        })],
      }));

      const svc = createService();
      const result = await svc.getPaginatedExecutions(makePaginatedParams());
      const item = result.data[0];
      expect(item.category).toBe('intel-driven');
      expect(item.severity).toBe('critical');
      expect(item.threat_actor).toBe('APT29');
      expect(item.tags).toEqual(['ransomware']);
    });

    it('calls count then search', async () => {
      mockCount.mockResolvedValue(esCountResponse(0));
      mockSearch.mockResolvedValue(esSearchResponse({ hits: [] }));

      const svc = createService();
      await svc.getPaginatedExecutions(makePaginatedParams());

      expect(mockCount).toHaveBeenCalledTimes(1);
      expect(mockSearch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Grouped paginated executions (terms agg + top_hits) ──
  describe('getGroupedPaginatedExecutions', () => {
    function makePaginatedParams(overrides?: Partial<PaginatedExecutionsParams>): PaginatedExecutionsParams {
      return {
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-31T23:59:59Z',
        page: 1,
        pageSize: 25,
        ...overrides,
      };
    }

    function makeGroupedSearchResponse(buckets: any[], totalGroups: number) {
      return {
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
        aggregations: {
          total_groups: { value: totalGroups },
          display_groups: { buckets },
        },
      };
    }

    function makeGroupBucket(groupKey: string, memberSources: Record<string, unknown>[] = []) {
      return {
        key: groupKey,
        doc_count: memberSources.length,
        members: {
          hits: {
            hits: memberSources.map(src => ({ _source: src })),
          },
        },
        sort_value: { value: 1706745600000 },
      };
    }

    it('builds terms agg query with script, top_hits, and cardinality', async () => {
      mockCount.mockResolvedValue(esCountResponse(50));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse([], 0));

      const svc = createService();
      await svc.getGroupedPaginatedExecutions(makePaginatedParams());

      const searchCall = mockSearch.mock.calls[0][0];
      // size:0 — results come from agg buckets, not top-level hits
      expect(searchCall.size).toBe(0);
      // terms agg with Painless script
      expect(searchCall.aggs.display_groups.terms.script).toBeDefined();
      expect(searchCall.aggs.display_groups.terms.script.lang).toBe('painless');
      // top_hits sub-agg for member docs
      expect(searchCall.aggs.display_groups.aggs.members.top_hits).toBeDefined();
      expect(searchCall.aggs.display_groups.aggs.members.top_hits.size).toBe(100);
      // sort_value sub-agg for group ordering
      expect(searchCall.aggs.display_groups.aggs.sort_value.max.field).toBe('routing.event_time');
      // cardinality agg with same script for total group count
      expect(searchCall.aggs.total_groups.cardinality.script).toBeDefined();
    });

    it('returns correct pagination metadata', async () => {
      // 45 groups across 150 docs; page 2 of 25 per page = 2 total pages
      const buckets = Array.from({ length: 45 }, (_, i) =>
        makeGroupBucket(`standalone::uuid-${i}::host-a`, [makeHitSource()])
      );
      mockCount.mockResolvedValue(esCountResponse(150));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse(buckets, 45));

      const svc = createService();
      const result = await svc.getGroupedPaginatedExecutions(makePaginatedParams({ page: 2, pageSize: 25 }));

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.pageSize).toBe(25);
      expect(result.pagination.totalGroups).toBe(45);
      expect(result.pagination.totalDocuments).toBe(150);
      expect(result.pagination.totalPages).toBe(2); // ceil(45/25)
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(true);
      // Page 2 should return remaining 20 groups (sliced from index 25)
      expect(result.groups).toHaveLength(20);
    });

    it('maps standalone groups correctly', async () => {
      const source = makeHitSource();
      const bucket = makeGroupBucket('standalone::uuid-001::host-a', [source]);

      mockCount.mockResolvedValue(esCountResponse(1));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse([bucket], 1));

      const svc = createService();
      const result = await svc.getGroupedPaginatedExecutions(makePaginatedParams());

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].type).toBe('standalone');
      expect(result.groups[0].groupKey).toBe('standalone::uuid-001::host-a');
      expect(result.groups[0].members).toHaveLength(1);
      expect(result.groups[0].representative.test_uuid).toBe('uuid-001');
    });

    it('maps bundle groups with correct protected/unprotected counts', async () => {
      const ctrl1 = makeHitSource({
        'f0rtika.is_bundle_control': true,
        'f0rtika.bundle_id': 'bundle-001',
        'f0rtika.bundle_name': 'Cyber-Hygiene Bundle',
        'event.ERROR': 126, // protected
      });
      const ctrl2 = makeHitSource({
        'f0rtika.is_bundle_control': true,
        'f0rtika.bundle_id': 'bundle-001',
        'f0rtika.bundle_name': 'Cyber-Hygiene Bundle',
        'event.ERROR': 101, // unprotected
      });
      const ctrl3 = makeHitSource({
        'f0rtika.is_bundle_control': true,
        'f0rtika.bundle_id': 'bundle-001',
        'f0rtika.bundle_name': 'Cyber-Hygiene Bundle',
        'event.ERROR': 105, // protected
      });

      const bucket = makeGroupBucket('bundle::bundle-001::host-a', [ctrl1, ctrl2, ctrl3]);

      mockCount.mockResolvedValue(esCountResponse(3));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse([bucket], 1));

      const svc = createService();
      const result = await svc.getGroupedPaginatedExecutions(makePaginatedParams());

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].type).toBe('bundle');
      expect(result.groups[0].protectedCount).toBe(2);
      expect(result.groups[0].unprotectedCount).toBe(1);
      expect(result.groups[0].totalCount).toBe(3);
      expect(result.groups[0].members).toHaveLength(3);
    });

    it('caps pageSize at 100 and reflects in terms agg size', async () => {
      mockCount.mockResolvedValue(esCountResponse(0));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse([], 0));

      const svc = createService();
      await svc.getGroupedPaginatedExecutions(makePaginatedParams({ pageSize: 500 }));

      const searchCall = mockSearch.mock.calls[0][0];
      // page=1, capped pageSize=100 → terms.size = 1*100 = 100
      expect(searchCall.aggs.display_groups.terms.size).toBe(100);
    });

    it('over-fetches correct number of buckets for later pages', async () => {
      mockCount.mockResolvedValue(esCountResponse(0));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse([], 0));

      const svc = createService();
      await svc.getGroupedPaginatedExecutions(makePaginatedParams({ page: 3, pageSize: 20 }));

      const searchCall = mockSearch.mock.calls[0][0];
      // page=3, pageSize=20 → terms.size = 3*20 = 60 (over-fetch to reach page 3)
      expect(searchCall.aggs.display_groups.terms.size).toBe(60);
    });

    it('returns empty groups for zero results', async () => {
      mockCount.mockResolvedValue(esCountResponse(0));
      mockSearch.mockResolvedValue(makeGroupedSearchResponse([], 0));

      const svc = createService();
      const result = await svc.getGroupedPaginatedExecutions(makePaginatedParams());

      expect(result.groups).toEqual([]);
      expect(result.pagination.totalGroups).toBe(0);
      expect(result.pagination.totalDocuments).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(false);
    });
  });

  // ── Extended filter building (via getPaginatedExecutions) ──
  describe('buildExtendedFilters (via getPaginatedExecutions)', () => {
    beforeEach(() => {
      mockCount.mockResolvedValue(esCountResponse(0));
      mockSearch.mockResolvedValue(esSearchResponse({ hits: [] }));
    });

    it('applies all filter params when provided', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({
        from: '2025-01-01', to: '2025-01-31',
        org: 'org-1', tests: 'TestA', techniques: 'T1055',
        hostnames: 'host1', categories: 'intel-driven',
        severities: 'critical', threatActors: 'APT29',
        tags: 'edr', errorNames: 'ExecutionPrevented',
        errorCodes: '126', result: 'protected',
      });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      // Should have: testData + date + org + tests + techniques + hostnames + categories
      //   + severities + threatActors + tags + errorNames + errorCodes + result
      expect(filters.length).toBeGreaterThanOrEqual(10);
    });

    it('skips null filters for empty/undefined params', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({ from: '2025-01-01', to: '2025-01-31' });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      // Only testData + date = 2 filters
      expect(filters).toHaveLength(2);
    });

    it('buildResultFilter: protected → terms [105,126,127]', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({
        from: '2025-01-01', to: '2025-01-31', result: 'protected',
      });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      expect(filters).toContainEqual({ terms: { 'event.ERROR': [105, 126, 127] } });
    });

    it('buildResultFilter: unprotected → term 101', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({
        from: '2025-01-01', to: '2025-01-31', result: 'unprotected',
      });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      expect(filters).toContainEqual({ term: { 'event.ERROR': 101 } });
    });

    it('buildResultFilter: inconclusive → must_not terms', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({
        from: '2025-01-01', to: '2025-01-31', result: 'inconclusive',
      });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      expect(filters).toContainEqual({
        bool: { must_not: { terms: { 'event.ERROR': [101, 105, 126, 127] } } },
      });
    });

    it('buildErrorNamesFilter: canonical names → error codes', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({
        from: '2025-01-01', to: '2025-01-31',
        errorNames: 'ExecutionPrevented,Unprotected',
      });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      expect(filters).toContainEqual(
        expect.objectContaining({ terms: { 'event.ERROR': expect.arrayContaining([126, 101]) } })
      );
    });

    it('buildErrorNamesFilter: unrecognized names → fallback to f0rtika.error_name', async () => {
      const svc = createService();
      await svc.getPaginatedExecutions({
        from: '2025-01-01', to: '2025-01-31',
        errorNames: 'UnknownCustomError',
      });

      const countCall = mockCount.mock.calls[0][0];
      const filters = countCall.query.bool.filter;
      expect(filters).toContainEqual({ term: { 'f0rtika.error_name': 'UnknownCustomError' } });
    });
  });

  describe('getDefenseScoreByCategoryWithSubcategories', () => {
    it('maps nested subcategory structure with scores', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_category: {
            buckets: [{
              key: 'intel-driven',
              doc_count: 20,
              protected: { doc_count: 15 },
              by_subcategory: {
                buckets: [
                  { key: 'apt-sim', doc_count: 12, protected: { doc_count: 10 } },
                  { key: 'ransomware', doc_count: 8, protected: { doc_count: 5 } },
                ],
              },
            }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByCategoryWithSubcategories(makeParams());

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('intel-driven');
      expect(result[0].score).toBe(75);
      expect(result[0].subcategories).toHaveLength(2);
      // Subcategories sorted by count desc
      expect(result[0].subcategories[0].subcategory).toBe('apt-sim');
      expect(result[0].subcategories[0].count).toBe(12);
    });

    it('sorts categories by score desc', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_category: {
            buckets: [
              { key: 'low-score', doc_count: 10, protected: { doc_count: 2 }, by_subcategory: { buckets: [] } },
              { key: 'high-score', doc_count: 10, protected: { doc_count: 9 }, by_subcategory: { buckets: [] } },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByCategoryWithSubcategories(makeParams());
      expect(result[0].category).toBe('high-score');
      expect(result[1].category).toBe('low-score');
    });

    it('handles category with empty subcategories', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_category: {
            buckets: [{ key: 'cat', doc_count: 5, protected: { doc_count: 3 }, by_subcategory: { buckets: [] } }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByCategoryWithSubcategories(makeParams());
      expect(result[0].subcategories).toEqual([]);
    });
  });

  describe('getThreatActorCoverage', () => {
    it('maps buckets with cardinality sub-agg (testCount)', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_threat_actor: {
            buckets: [{
              key: 'APT29',
              doc_count: 50,
              protected: { doc_count: 35 },
              unique_tests: { value: 12 },
            }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getThreatActorCoverage(makeParams());
      expect(result[0].threatActor).toBe('APT29');
      expect(result[0].coverage).toBe(70);
      expect(result[0].testCount).toBe(12);
      expect(result[0].protectedCount).toBe(35);
      expect(result[0].totalExecutions).toBe(50);
    });

    it('sorts by totalExecutions desc', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_threat_actor: {
            buckets: [
              { key: 'A', doc_count: 10, protected: { doc_count: 5 }, unique_tests: { value: 3 } },
              { key: 'B', doc_count: 50, protected: { doc_count: 30 }, unique_tests: { value: 8 } },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getThreatActorCoverage(makeParams());
      expect(result[0].threatActor).toBe('B');
    });
  });

  describe('getErrorRate', () => {
    it('computes errors/(errors+conclusive)*100 with rounding', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          errors: { doc_count: 15 },
          conclusive: { doc_count: 85 },
        },
      }));
      const svc = createService();
      const result = await svc.getErrorRate(makeParams());
      expect(result.errorRate).toBe(15);
      expect(result.errorCount).toBe(15);
      expect(result.conclusiveCount).toBe(85);
      expect(result.totalTestActivity).toBe(100);
    });

    it('returns errorRate=0 when 0 activity', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { errors: { doc_count: 0 }, conclusive: { doc_count: 0 } },
      }));
      const svc = createService();
      const result = await svc.getErrorRate(makeParams());
      expect(result.errorRate).toBe(0);
      expect(result.totalTestActivity).toBe(0);
    });
  });

  // ================================================================
  // Group 13: Smoke Tests
  // ================================================================
  describe('smoke tests (structurally identical methods)', () => {
    it('getDefenseScoreByTechnique — uses f0rtika.techniques', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_technique: {
            buckets: makeScoreBuckets([{ key: 'T1055', total: 10, protected: 7 }]),
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByTechnique(makeParams());
      expect(result[0].name).toBe('T1055');
      expect(result[0].score).toBe(70);

      const callArg = mockSearch.mock.calls[0][0];
      expect(callArg.aggs.by_technique.terms.field).toBe('f0rtika.techniques');
    });

    it('getResultsByErrorType — resolves error codes', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { by_error_code: { buckets: [{ key: 126, doc_count: 30 }] } },
      }));
      const svc = createService();
      const result = await svc.getResultsByErrorType(makeParams());
      expect(result[0].name).toBe('ExecutionPrevented');
      expect(result[0].code).toBe(126);
      expect(result[0].count).toBe(30);
    });

    it('getTestCoverage — protected/unprotected sub-aggs', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_test: {
            buckets: [{ key: 'T1', doc_count: 10, protected: { doc_count: 7 }, unprotected: { doc_count: 3 } }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getTestCoverage(makeParams());
      expect(result[0]).toEqual({ name: 'T1', protected: 7, unprotected: 3 });
    });

    it('getTechniqueDistribution — field key is "technique"', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_technique: {
            buckets: [{ key: 'T1055', doc_count: 20, protected: { doc_count: 12 }, unprotected: { doc_count: 8 } }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getTechniqueDistribution(makeParams());
      expect(result[0].technique).toBe('T1055');
      expect(result[0].protected).toBe(12);
      expect(result[0].unprotected).toBe(8);
    });

    it('getHostTestMatrix — composite aggregation', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          host_test_matrix: {
            buckets: [{ key: { hostname: 'h1', test_name: 'T1' }, doc_count: 5 }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getHostTestMatrix(makeParams());
      expect(result[0]).toEqual({ hostname: 'h1', testName: 'T1', count: 5 });
    });

    it('getAvailableTests — returns string[]', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { tests: { buckets: [{ key: 'Test A' }, { key: 'Test B' }] } },
      }));
      const svc = createService();
      const result = await svc.getAvailableTests();
      expect(result).toEqual(['Test A', 'Test B']);
    });

    it('getDefenseScoreByOrg — org UUID → name mapping', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_org: {
            buckets: makeScoreBuckets([
              { key: 'b2f8dccb-6d23-492e-aa87-a0a8a6103189', total: 10, protected: 8 },
            ]),
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByOrg(makeParams());
      expect(result[0].orgName).toBe('TPSGL');
      expect(result[0].org).toBe('b2f8dccb-6d23-492e-aa87-a0a8a6103189');
      expect(result[0].score).toBe(80);
    });

    it('getDefenseScoreByHostname — sorted by total desc', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_hostname: {
            buckets: [
              { key: 'h1', doc_count: 5, protected: { doc_count: 3 } },
              { key: 'h2', doc_count: 20, protected: { doc_count: 15 } },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByHostname(makeParams());
      expect(result[0].hostname).toBe('h2');
      expect(result[0].total).toBe(20);
      expect(result[1].hostname).toBe('h1');
    });
  });

  // ================================================================
  // Additional edge cases
  // ================================================================
  describe('getErrorRateTrendRolling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-20T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('computes rolling error rate correctly', async () => {
      const buckets = makeDateBuckets([
        { key: Date.parse('2025-01-18T00:00:00Z'), key_as_string: '2025-01-18', total: 10, errors: 2, conclusive: 8 },
        { key: Date.parse('2025-01-19T00:00:00Z'), key_as_string: '2025-01-19', total: 10, errors: 3, conclusive: 7 },
        { key: Date.parse('2025-01-20T00:00:00Z'), key_as_string: '2025-01-20', total: 10, errors: 5, conclusive: 5 },
      ]);
      mockSearch.mockResolvedValue(esSearchResponse({ aggs: { over_time: { buckets } } }));

      const svc = createService();
      const result = await svc.getErrorRateTrendRolling(makeParams({
        from: 'now-3d', windowDays: 2,
      }));

      // Should have points for visible dates
      expect(result.length).toBeGreaterThan(0);
      // Last point: window=[jan19,jan20] → errors=3+5=8, conclusive=7+5=12, rate=8/20*100=40
      const last = result[result.length - 1];
      expect(last.errorRate).toBe(40);
      expect(last.errorCount).toBe(8);
      expect(last.conclusiveCount).toBe(12);
    });
  });

  describe('getCanonicalTestCount', () => {
    it('returns count, tests list, and days', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          unique_test_count: { value: 3 },
          test_names: { buckets: [{ key: 'A' }, { key: 'B' }, { key: 'C' }] },
        },
      }));
      const svc = createService();
      const result = await svc.getCanonicalTestCount();
      expect(result.count).toBe(3);
      expect(result.tests).toEqual(['A', 'B', 'C']);
      expect(result.days).toBe(90);
    });

    it('defaults to 90 days', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { unique_test_count: { value: 0 }, test_names: { buckets: [] } },
      }));
      const svc = createService();
      await svc.getCanonicalTestCount();

      const callArg = mockSearch.mock.calls[0][0];
      const dateFilter = callArg.query.bool.filter.find(
        (f: any) => f.range?.['routing.event_time']
      );
      expect(dateFilter.range['routing.event_time'].gte).toBe('now-90d');
    });

    it('uses custom days param', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: { unique_test_count: { value: 0 }, test_names: { buckets: [] } },
      }));
      const svc = createService();
      await svc.getCanonicalTestCount({ days: 30 });

      const callArg = mockSearch.mock.calls[0][0];
      const dateFilter = callArg.query.bool.filter.find(
        (f: any) => f.range?.['routing.event_time']
      );
      expect(dateFilter.range['routing.event_time'].gte).toBe('now-30d');
    });
  });

  describe('getDefenseScoreBySeverity', () => {
    it('sorts by severity order (critical first)', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_severity: {
            buckets: [
              { key: 'medium', doc_count: 10, protected: { doc_count: 5 } },
              { key: 'critical', doc_count: 20, protected: { doc_count: 18 } },
              { key: 'low', doc_count: 5, protected: { doc_count: 1 } },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreBySeverity(makeParams());
      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('medium');
      expect(result[2].severity).toBe('low');
    });

    it('computes score and unprotected count', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_severity: {
            buckets: [{ key: 'high', doc_count: 10, protected: { doc_count: 7 } }],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreBySeverity(makeParams());
      expect(result[0].score).toBe(70);
      expect(result[0].unprotected).toBe(3);
      expect(result[0].protected).toBe(7);
    });
  });

  describe('getDefenseScoreByCategory', () => {
    it('sorts by score desc', async () => {
      mockSearch.mockResolvedValue(esSearchResponse({
        aggs: {
          by_category: {
            buckets: [
              { key: 'cyber-hygiene', doc_count: 10, protected: { doc_count: 3 } },
              { key: 'intel-driven', doc_count: 10, protected: { doc_count: 9 } },
            ],
          },
        },
      }));
      const svc = createService();
      const result = await svc.getDefenseScoreByCategory(makeParams());
      expect(result[0].category).toBe('intel-driven');
      expect(result[0].score).toBe(90);
    });
  });
});
