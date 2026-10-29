import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';
import { useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

// EDR-killed runs (design spec): the stages are unknown, so a kill doc counts
// for its test as a whole but never for a technique. The latest-basis readers
// run against a small in-memory ES; the executions-basis ones are checked by
// the query they send.

const mockSearch = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
  }),
}));

vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService } = await import('../elasticsearch.js');
const { NOT_STAGELESS } = await import('../enrichment-eligibility.js');

const useIndex = (docs: Doc[]) => useIndexOn(mockSearch, docs);

const LOCKBIT = 'c3f1a2b4-0000-4000-8000-000000000001';
const STANDALONE = 'd4e5f6a7-0000-4000-8000-000000000002';

const base = (at: string, host = 'h1'): Doc => ({
  'routing.oid': 'org-a',
  'routing.hostname': host,
  'routing.event_time': at,
  'f0rtika.category': 'intel-driven',
});

const stage = (at: string, n: number, code: number, technique: string, host = 'h1'): Doc => ({
  ...base(at, host),
  'f0rtika.test_uuid': `${LOCKBIT}::LB-00${n}`,
  'f0rtika.test_name': `LockBit - Stage ${n}`,
  'f0rtika.bundle_id': LOCKBIT,
  'f0rtika.bundle_name': 'LockBit',
  'f0rtika.is_bundle_control': true,
  'f0rtika.control_id': `LB-00${n}`,
  'f0rtika.control_validator': `Stage ${n}`,
  'f0rtika.techniques': [technique],
  'event.ERROR': code,
  'f0rtika.is_protected': code === 126,
});

const bundleKill = (at: string, host = 'h1'): Doc => ({
  ...base(at, host),
  'f0rtika.test_uuid': LOCKBIT,
  'f0rtika.test_name': 'LockBit',
  'f0rtika.bundle_id': LOCKBIT,
  'f0rtika.bundle_name': 'LockBit',
  'f0rtika.techniques': ['T1486', 'T1490'],
  'event.ERROR': 126,
  'f0rtika.is_protected': true,
  'f0rtika.edr_terminated': true,
});

const standaloneKill = (at: string, host = 'h1'): Doc => ({
  ...base(at, host),
  'f0rtika.test_uuid': STANDALONE,
  'f0rtika.test_name': 'Credential Dump',
  'f0rtika.techniques': ['T1003'],
  'event.ERROR': 126,
  'f0rtika.is_protected': true,
  'f0rtika.edr_terminated': true,
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
const LATEST: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z', basis: 'latest' };
const RANGE = { from: LATEST.from, to: LATEST.to };
const T0 = '2025-01-10T09:00:00Z';
const T1 = '2025-01-20T09:00:00Z';

describe('technique views and EDR-killed runs', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
  });

  describe('executions basis', () => {
    const filterOf = () => mockSearch.mock.calls[0][0].query.bool.filter as unknown[];

    it('getDefenseScoreByTechnique excludes edr_terminated docs', async () => {
      await createService().getDefenseScoreByTechnique(RANGE);
      expect(filterOf()).toContainEqual(NOT_STAGELESS);
    });

    it('getTechniqueDistribution excludes edr_terminated docs', async () => {
      await createService().getTechniqueDistribution(RANGE);
      expect(filterOf()).toContainEqual(NOT_STAGELESS);
    });
  });

  it('getAvailableTechniques excludes edr_terminated docs', async () => {
    await createService().getAvailableTechniques();
    expect(mockSearch.mock.calls[0][0].query.bool.filter).toContainEqual(NOT_STAGELESS);
  });

  describe('basis=latest', () => {
    it('getTechniqueDistributionLatest: a kill-doc pair contributes no technique', async () => {
      useIndex([stage(T0, 1, 101, 'T1486'), bundleKill(T1), standaloneKill(T1)]);
      const items = await createService().getTechniqueDistributionLatest(LATEST);
      // Kill docs are excluded from the pair runs, so the real stage run stands.
      expect(items).toEqual([{ technique: 'T1486', protected: 0, unprotected: 1 }]);
    });

    it('getTechniqueDistributionLatest: kill docs alone give no technique', async () => {
      useIndex([bundleKill(T1), standaloneKill(T1)]);
      expect(await createService().getTechniqueDistributionLatest(LATEST)).toEqual([]);
    });

    it('getTechniqueOutcomes: a kill-doc pair contributes no technique', async () => {
      useIndex([bundleKill(T1), standaloneKill(T1), stage(T0, 1, 126, 'T1486', 'h2')]);
      const items = await createService().getTechniqueOutcomes(LATEST);
      expect(items.map(i => [i.technique, i.protected, i.unprotected])).toEqual([['T1486', 1, 0]]);
    });

    it('the kill run still counts for the test in the Defense Score', async () => {
      useIndex([stage(T0, 1, 101, 'T1486'), bundleKill(T1)]);
      const res = await createService().getDefenseScoreLatest({ ...LATEST, scoringMode: 'any-stage' });
      expect(res.score).toBe(100);
    });
  });

  describe('posture cache', () => {
    it('technique views do not share the tile\'s posture cache entry', async () => {
      const svc = createService() as any;
      const tile = await svc.resolvePostureScope({ ...LATEST, scoringMode: 'any-stage' });
      const tech = await svc.resolvePostureScope({ ...LATEST, scoringMode: 'any-stage', excludeEdrTerminated: true });
      expect(JSON.stringify(tech.keyBase)).not.toBe(JSON.stringify(tile.keyBase));
      expect(tech.keyBase.excludeEdrTerminated).toBe(true);
      expect(tile.keyBase).not.toHaveProperty('excludeEdrTerminated');
      expect(tile.clauses).not.toContainEqual(NOT_STAGELESS);
    });

    it('a technique read does not reuse a test-level breakdown snapshot, and leaves it intact', async () => {
      // getDefenseScoreByHostnameLatest reads the same metadata/all-stages scope as the technique views.
      useIndex([standaloneKill(T1)]);
      const svc = createService();
      const params = { ...LATEST, scoringMode: 'all-stages' as const };
      expect(await svc.getDefenseScoreByHostnameLatest(params)).toMatchObject([{ hostname: 'h1', score: 100 }]);

      const before = mockSearch.mock.calls.length;
      expect(await svc.getTechniqueOutcomes(params)).toEqual([]);
      expect(mockSearch.mock.calls.length).toBeGreaterThan(before);

      const again = mockSearch.mock.calls.length;
      expect(await svc.getDefenseScoreByHostnameLatest(params)).toMatchObject([{ hostname: 'h1', score: 100 }]);
      expect(mockSearch.mock.calls.length).toBe(again);
    });
  });
});
