import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// Latest-basis pair runs carry an `edrPrevented` bit (doc path: a vendor
// `_prevented` flag on the latest doc; bundle path: a `prevented` filter agg),
// and `excludeCyberHygiene` scopes the posture requests.

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
const { edrPreventedTerms } = await import('../../outcomes/vendors.js');

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
const T = '2025-01-10T09:00:00Z';
const P: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z', basis: 'latest' };
const HYGIENE_CLAUSE = { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } };

function docBucket(test: string, metrics: Record<string, unknown>) {
  return {
    key: { oid: 'org-a', test, host: 'HOST-01' },
    doc_count: 1,
    latest: { top: [{ sort: [T], metrics: { 'routing.event_time': T, 'event.ERROR': 101, ...metrics } }] },
  };
}

function bundleBucket(extra: Record<string, unknown>) {
  return {
    key: { oid: 'org-a', bundle: 'bundle-1', host: 'HOST-01', ts: Date.parse(T) },
    doc_count: 2,
    combined: { doc_count: 1 },
    strict: { doc_count: 0, stages: { buckets: [] } },
    alerted_unblocked: { doc_count: 0, stages: { buckets: [] } },
    codes: { buckets: [{ key: 101 }] },
    names: { buckets: [] },
    edr_terminated: { doc_count: 0 },
    ...extra,
  };
}

/** Answers composite requests by their agg name; records every body. */
function mockEs(buckets: { pairs?: any[]; bundle_runs?: any[] }) {
  mockSearch.mockImplementation(async (body: any) => {
    const aggs = body?.aggs ?? {};
    const name = Object.keys(aggs)[0];
    if (name === 'pairs' || name === 'bundle_runs') {
      return { aggregations: { [name]: { buckets: (buckets as any)[name] ?? [] } } };
    }
    return { aggregations: {} };
  });
}

const bodies = () => mockSearch.mock.calls.map((c) => c[0]).filter(Boolean);
const aggOf = (name: string) => bodies().map((b) => b.aggs?.[name]).find(Boolean);

describe('edrPrevented on latest-basis pair runs', () => {
  beforeEach(() => mockSearch.mockReset());

  it('doc path: a latest doc with a vendor _prevented flag yields edrPrevented true', async () => {
    mockEs({
      pairs: [
        docBucket('t-1', { 'f0rtika.defender_prevented': true, 'f0rtika.defender_detected': true }),
        docBucket('t-2', { 'f0rtika.defender_detected': true }),
      ],
    });
    const runs: any[] = await createService().getLatestPairs(P);
    const byTest = (name: string) => runs.find((r) => r.pairKey.includes(`|${name}|`));
    expect(byTest('t-1').edrPrevented).toBe(true);
    expect(byTest('t-2').edrPrevented).toBe(false);
    const fields = aggOf('pairs').aggs.latest.top_metrics.metrics.map((m: any) => m.field);
    expect(fields).toContain('f0rtika.defender_prevented');
  });

  it('bundle path: a prevented filter agg drives edrPrevented', async () => {
    mockEs({ bundle_runs: [bundleBucket({ prevented: { doc_count: 1 } })] });
    const runs: any[] = await createService().getLatestPairs({ ...P, scoringMode: 'any-stage' });
    const bundle = runs.find((r) => r.pairKey.includes('bundle-1'));
    expect(bundle.edrPrevented).toBe(true);
    expect(aggOf('bundle_runs').aggs.prevented.filter.bool.should).toEqual(edrPreventedTerms());

    mockSearch.mockReset();
    mockEs({ bundle_runs: [bundleBucket({ prevented: { doc_count: 0 } })] });
    const none: any[] = await createService().getLatestPairs({ ...P, scoringMode: 'any-stage' });
    expect(none.find((r) => r.pairKey.includes('bundle-1')).edrPrevented).toBe(false);
  });
});

describe('excludeCyberHygiene scope option', () => {
  beforeEach(() => mockSearch.mockReset());

  // Top-level filter only: PER_BUNDLE_FILTER embeds the same clause one level down.
  const hasClause = (b: any) => (b.query.bool.filter as unknown[]).some((f) => JSON.stringify(f) === JSON.stringify(HYGIENE_CLAUSE));

  it('adds the must_not category clause to every posture request', async () => {
    mockEs({});
    await createService().getLatestPairs({ ...P, scoringMode: 'any-stage', excludeCyberHygiene: true });
    expect(mockSearch).toHaveBeenCalled();
    for (const b of bodies()) expect(hasClause(b)).toBe(true);
  });

  it('leaves requests alone, and the cache key unchanged, when unset', async () => {
    mockEs({});
    await createService().getLatestPairs({ ...P, scoringMode: 'any-stage' });
    expect(mockSearch).toHaveBeenCalled();
    for (const b of bodies()) expect(hasClause(b)).toBe(false);
    const svc = createService() as any;
    const scope = await svc.resolvePostureScope({ ...P });
    expect(scope.keyBase).not.toHaveProperty('excludeCyberHygiene');
  });
});

describe('getOutcomeBreakdown', () => {
  beforeEach(() => mockSearch.mockReset());

  /** Answers the conclusive pass with `pairs` and the no-conclusive pass (its must_not filter) with `noConc`. */
  function mockBreakdownEs(pairs: any[], noConc: any[] = []) {
    const marker = JSON.stringify({ bool: { must_not: [(createService() as any).buildConclusiveResultsFilter()] } });
    mockSearch.mockImplementation(async (body: any) => {
      const name = Object.keys(body?.aggs ?? {})[0];
      if (name !== 'pairs') return { aggregations: {} };
      const isNoConc = JSON.stringify(body.query).includes(marker);
      return { aggregations: { pairs: { buckets: isNoConc ? noConc : pairs } } };
    });
  }

  const dataset = () => [
    docBucket('t-1', { 'f0rtika.is_protected': true }),
    docBucket('t-2', { 'f0rtika.defender_detected': true, 'f0rtika.defender_prevented': true }),
    docBucket('t-3', { 'f0rtika.defender_detected': true }),
    docBucket('t-4', {}),
    docBucket('t-5', { 'f0rtika.defender_prevented': true }),
  ];

  it('matches getDefenseScoreLatest on the same dataset', async () => {
    mockBreakdownEs(dataset());
    const svc = createService();
    const score = await svc.getDefenseScoreLatest(P);
    const b = await svc.getOutcomeBreakdown(P);
    expect(b.pairCount).toBe(score.totalExecutions);
    expect(b.protected + b.prevented + b.detected).toBe(score.protectedCount + score.detectedCount);
    expect(b.silent).toBe(score.unprotectedCount);
    expect(b).toMatchObject({ protected: 1, prevented: 1, detected: 1, silent: 2, noConclusive: 0, riskAccepted: 0 });
    expect(typeof b.windowLabel).toBe('string');
  });

  it('ignores outcome filters', async () => {
    mockBreakdownEs(dataset());
    const base = await createService().getOutcomeBreakdown(P);
    const filtered = await createService().getOutcomeBreakdown({ ...P, result: 'protected', errorCodes: '101' });
    expect(filtered).toEqual(base);
  });

  it('counts a pair with only an inconclusive doc as noConclusive', async () => {
    mockBreakdownEs([], [docBucket('t-9', { 'event.ERROR': 999 })]);
    expect((await createService().getOutcomeBreakdown(P)).noConclusive).toBe(1);
  });

  it('does not count a pair that also has a conclusive run', async () => {
    mockBreakdownEs([docBucket('t-9', {})], [docBucket('t-9', { 'event.ERROR': 999 })]);
    const b = await createService().getOutcomeBreakdown(P);
    expect(b.noConclusive).toBe(0);
    expect(b.pairCount).toBe(1);
  });

  it('riskAccepted = pairs only present without the exclusion filter', async () => {
    const svc = createService() as any;
    svc.getRiskAcceptanceService = () => ({ buildExclusionFilter: async () => ({ bool: { must_not: [{ term: { x: 1 } }] } }) });
    mockSearch.mockImplementation(async (body: any) => {
      const name = Object.keys(body?.aggs ?? {})[0];
      if (name !== 'pairs') return { aggregations: {} };
      const excluded = JSON.stringify(body.query).includes('"x":1');
      const all = [docBucket('t-1', {}), docBucket('t-2', {}), docBucket('t-3', {})];
      return { aggregations: { pairs: { buckets: JSON.stringify(body.query).includes('must_not') && excluded ? all.slice(0, 2) : all } } };
    });
    const b = await svc.getOutcomeBreakdown(P);
    expect(b.pairCount).toBe(2);
    expect(b.riskAccepted).toBe(1);
  });
});
