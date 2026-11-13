import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// The Defense Score alert reads the latest-result score through
// getLatestScoreSummary: the tile's number, from the lightest snapshot.
// The real queries run against a small in-memory ES.

const mockSearch = vi.fn();
const mockExclusion = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
  }),
}));

vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = mockExclusion;
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService } = await import('../elasticsearch.js');

import { useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

const useIndex = (docs: Doc[]) => useIndexOn(mockSearch, docs);

const CHAIN = 'c0ffee00-1234-4abc-8def-000000000001';

const base = (at: string, host: string): Doc => ({
  'routing.oid': 'org-a',
  'routing.hostname': host,
  'routing.event_time': at,
});

const single = (at: string, uuid: string, code: number, host = 'host-1'): Doc => ({
  ...base(at, host),
  'f0rtika.category': 'intel-driven',
  'f0rtika.test_uuid': uuid,
  'f0rtika.test_name': `Test ${uuid.slice(-1)}`,
  'event.ERROR': code,
  'f0rtika.is_protected': code === 126,
});

const stage = (at: string, n: number, code: number, host = 'host-1'): Doc => ({
  ...base(at, host),
  'f0rtika.category': 'intel-driven',
  'f0rtika.test_uuid': `${CHAIN}::T${n}`,
  'f0rtika.test_name': `Chain A - Stage ${n}`,
  'f0rtika.bundle_id': CHAIN,
  'f0rtika.bundle_name': 'Chain A',
  'f0rtika.is_bundle_control': true,
  'f0rtika.control_id': `T${n}`,
  'f0rtika.control_validator': `Stage ${n}`,
  'event.ERROR': code,
  'f0rtika.is_protected': code === 126,
});

function createService() {
  const settings: AnalyticsSettings = {
    connectionType: 'direct',
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'achilles-results-*',
    configured: true,
  };
  return new ElasticsearchService(settings);
}

type Params = AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>;
const RANGE: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z', scoringMode: 'any-stage' };
const T0 = '2025-01-10T09:00:00Z';
const T1 = '2025-01-20T09:00:00Z';
const A = 'c0ffee00-1234-4abc-8def-00000000000a';
const B = 'c0ffee00-1234-4abc-8def-00000000000b';

describe('getLatestScoreSummary', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
    mockExclusion.mockReset();
    mockExclusion.mockResolvedValue(null);
  });

  it('gives the same score and pair count as the dashboard tile', async () => {
    useIndex([
      single(T0, A, 126), single(T0, B, 101),
      stage(T0, 1, 101), stage(T0, 2, 126), stage(T0, 3, 101), // one chain, protected by one stage
      single(T0, A, 101, 'host-2'),
    ]);
    const summary = await createService().getLatestScoreSummary(RANGE);
    const tile = await createService().getDefenseScoreLatest({ ...RANGE, basis: 'latest' });
    expect(summary.pairCount).toBe(4);
    expect(summary.score).toBe(50);
    expect([summary.score, summary.pairCount]).toEqual([tile.score, tile.pairCount]);
  });

  it('drops as soon as the newest run of a chain is unprotected', async () => {
    useIndex([stage(T0, 1, 126), stage(T0, 2, 101)]);
    expect((await createService().getLatestScoreSummary(RANGE)).score).toBe(100);

    useIndex([stage(T0, 1, 126), stage(T0, 2, 101), stage(T1, 1, 101), stage(T1, 2, 101)]);
    expect(await createService().getLatestScoreSummary(RANGE)).toMatchObject({ score: 0, pairCount: 1 });
  });

  it('has no score when nothing reached a verdict', async () => {
    useIndex([single(T0, A, 999), single(T0, B, 260)]);
    expect(await createService().getLatestScoreSummary(RANGE)).toMatchObject({ score: null, pairCount: 0 });
  });

  it('ignores outcome filters: the alert scores every pair', async () => {
    useIndex([single(T0, A, 126), single(T0, B, 101)]);
    const summary = await createService().getLatestScoreSummary({ ...RANGE, result: 'unprotected', errorCodes: '101' });
    expect(summary).toMatchObject({ score: 50, pairCount: 2 });
  });

  it('leaves out risk-accepted results, like the tile', async () => {
    mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.test_uuid': B } }] } });
    useIndex([single(T0, A, 126), single(T0, B, 101)]);
    expect(await createService().getLatestScoreSummary(RANGE)).toMatchObject({ score: 100, pairCount: 1 });
  });

  it('names its window', async () => {
    useIndex([single(T0, A, 126)]);
    expect((await createService().getLatestScoreSummary(RANGE)).windowLabel).toBe('30d');
  });
});
