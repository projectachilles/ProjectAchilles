import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AnalyticsSettings,
  AnalyticsQueryParams,
  ExtendedAnalyticsQueryParams,
  CoverageMatrixTestsResponse,
  CoverageMatrixHostsResponse,
  MatrixCell,
} from '../../../types/analytics.js';

// Coverage matrix: the latest result per test and host. The real queries run
// against a small in-memory ES, so the fetch (latest-basis snapshot, pairs
// without a verdict, risk acceptance) is exercised; the pivot itself is
// tested in coverageMatrix.test.ts.

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

const SOLO = 'a0000000-1234-4abc-8def-000000000001';
const FAILS = 'a0000000-1234-4abc-8def-000000000002';
const CHAIN = 'c0ffee00-1234-4abc-8def-000000000001';
const HYGIENE = 'b0000000-1234-4abc-8def-000000000001';

const WIDE = { 'f0rtika.crowdstrike_detected': true };
const OWN = { 'f0rtika.crowdstrike_detected': true, 'f0rtika.crowdstrike_stage_detected': true };

interface DocOpts {
  host?: string;
  org?: string;
  name?: string;
  flags?: Doc;
}

/** A standalone test's result. */
function single(at: string, uuid: string, code: number, o: DocOpts = {}): Doc {
  return {
    'routing.oid': o.org ?? 'org-a',
    'routing.hostname': o.host ?? 'host-1',
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
    'f0rtika.test_uuid': uuid,
    'f0rtika.test_name': o.name ?? 'Solo test',
    'f0rtika.techniques': ['T1059'],
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126,
    ...(o.flags ?? {}),
  };
}

/** One stage of an attack chain's run. */
function stage(at: string, n: number, code: number, o: DocOpts = {}): Doc {
  return {
    'routing.oid': o.org ?? 'org-a',
    'routing.hostname': o.host ?? 'host-1',
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
    'f0rtika.test_uuid': `${CHAIN}::T${n}`,
    'f0rtika.test_name': `Chain A - Stage ${n}`,
    'f0rtika.bundle_id': CHAIN,
    'f0rtika.bundle_name': 'Chain A',
    'f0rtika.is_bundle_control': true,
    'f0rtika.control_id': `T${n}`,
    'f0rtika.control_validator': `Stage ${n}`,
    'f0rtika.techniques': [`T100${n}`],
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126,
    ...(o.flags ?? {}),
  };
}

/** One control of a cyber-hygiene bundle's run. code 0 = not assessed. */
function control(at: string, id: string, code: number, o: DocOpts = {}): Doc {
  return {
    'routing.oid': o.org ?? 'org-a',
    'routing.hostname': o.host ?? 'host-1',
    'routing.event_time': at,
    'f0rtika.category': 'cyber-hygiene',
    'f0rtika.test_uuid': `${HYGIENE}::${id}`,
    'f0rtika.test_name': `Control ${id}`,
    'f0rtika.bundle_id': HYGIENE,
    'f0rtika.bundle_name': 'Baseline',
    'f0rtika.is_bundle_control': true,
    'f0rtika.control_id': id,
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126,
    ...(code === 0 ? { 'f0rtika.skipped': true } : {}),
  };
}

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
const RANGE: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z' };
const T0 = '2025-01-10T09:00:00Z';
const T1 = '2025-01-20T09:00:00Z';
const iso = (at: string) => new Date(at).toISOString();

/** A standalone test, a chain and a cyber-hygiene bundle, each on two hosts. */
const FLEET: Doc[] = [
  single(T0, SOLO, 126),
  single(T0, SOLO, 101, { host: 'host-2' }),
  // host-1: stage 2 blocked. host-2: nothing blocked, an alert named the chain.
  stage(T0, 1, 101),
  stage(T0, 2, 126),
  stage(T0, 3, 101),
  stage(T0, 1, 101, { host: 'host-2' }),
  stage(T0, 2, 101, { host: 'host-2', flags: WIDE }),
  stage(T0, 3, 101, { host: 'host-2' }),
  control(T0, 'CH-1', 126),
  control(T0, 'CH-2', 126),
  control(T0, 'CH-3', 101),
  control(T0, 'CH-1', 101, { host: 'host-2' }),
  control(T0, 'CH-2', 0, { host: 'host-2' }),
];

const matrix = async (docs: Doc[], params: Params = RANGE, es = createService()) => {
  useIndex(docs);
  return (await es.getCoverageMatrix(params, { rows: 'tests' })) as CoverageMatrixTestsResponse;
};

function cell(view: CoverageMatrixTestsResponse, testUuid: string, hostname: string, org = 'org-a'): MatrixCell | undefined {
  const row = view.tests.find((t) => t.testUuid === testUuid);
  const i = view.hosts.findIndex((h) => h.hostname === hostname && h.org === org);
  return row?.cells?.find((c) => c.i === i);
}

describe('getCoverageMatrix', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
    mockExclusion.mockReset();
    mockExclusion.mockResolvedValue(null);
  });

  it('draws a test, a chain and a cyber-hygiene bundle on two hosts', async () => {
    const view = await matrix(FLEET);

    expect(view).toMatchObject({ rows: 'tests', windowLabel: '30d', hostCount: 2, testCount: 3, cellsIncluded: true, truncated: false });
    expect(view.hosts.map((h) => h.hostname)).toEqual(['host-2', 'host-1']);
    expect(view.tests.map((t) => [t.testUuid, t.name, t.kind])).toEqual([
      [SOLO, 'Solo test', 'test'],
      [CHAIN, 'Chain A', 'chain'],
      [HYGIENE, 'Baseline', 'controls'],
    ]);
    expect(cell(view, SOLO, 'host-1')).toEqual({ i: 1, verdict: 'protected', at: iso(T0) });
    expect(cell(view, SOLO, 'host-2')).toEqual({ i: 0, verdict: 'unprotected', at: iso(T0) });
    expect(cell(view, CHAIN, 'host-1')).toEqual({ i: 1, verdict: 'protected', at: iso(T0) });
    expect(cell(view, CHAIN, 'host-2')).toEqual({ i: 0, verdict: 'detected', at: iso(T0) });
    expect(cell(view, HYGIENE, 'host-1')).toEqual({ i: 1, ratio: { compliant: 2, evaluated: 3, notAssessed: 0, accepted: 0 }, at: iso(T0) });
    expect(cell(view, HYGIENE, 'host-2')).toEqual({ i: 0, ratio: { compliant: 0, evaluated: 1, notAssessed: 1, accepted: 0 }, at: iso(T0) });
    expect(view.tests[2]).toMatchObject({ category: 'cyber-hygiene', ratio: { compliant: 2, evaluated: 4, notAssessed: 1, accepted: 0 } });
  });

  it('adds up to the Defense Score of the same results', async () => {
    const es = createService();
    const view = await matrix(FLEET, RANGE, es);
    const score = await es.getDefenseScoreLatest({ ...RANGE, basis: 'latest', scoringMode: 'any-stage' });

    const attack = view.tests.filter((t) => t.kind !== 'controls');
    const caught = attack.reduce((n, t) => n + t.counts.protected + t.counts.detected, 0);
    const judged = attack.reduce((n, t) => n + t.counts.protected + t.counts.detected + t.counts.unprotected, 0);
    const compliant = view.tests.reduce((n, t) => n + (t.ratio?.compliant ?? 0), 0);
    const evaluated = view.tests.reduce((n, t) => n + (t.ratio?.evaluated ?? 0), 0);

    expect(score.pairCount).toBe(8);
    expect(caught + compliant).toBe(score.protectedCount + score.detectedCount);
    expect(judged + evaluated).toBe(score.pairCount);
  });

  it('lists a test whose every result is non-conclusive, by name, as "no verdict"', async () => {
    const view = await matrix([single(T0, FAILS, 999, { name: 'Always fails' }), single(T1, FAILS, 999, { name: 'Always fails' })]);

    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]).toMatchObject({ testUuid: FAILS, name: 'Always fails', kind: 'test', counts: { noVerdict: 1 } });
    expect(cell(view, FAILS, 'host-1')).toEqual({ i: 0, verdict: 'no_verdict', at: iso(T1) });
  });

  it('shows the older conclusive result under a newer run without a verdict', async () => {
    const view = await matrix([single(T0, SOLO, 126), single(T1, SOLO, 999)]);

    expect(cell(view, SOLO, 'host-1')).toEqual({ i: 0, verdict: 'protected', at: iso(T0) });
  });

  it('lists the earlier results of a pair, one per day', async () => {
    const view = await matrix([
      single('2025-01-05T09:00:00Z', SOLO, 101),
      single('2025-01-08T07:00:00Z', SOLO, 126),
      single('2025-01-08T18:00:00Z', SOLO, 101, { flags: OWN }),
      single(T1, SOLO, 126),
      stage('2025-01-06T09:00:00Z', 1, 101),
      stage(T1, 1, 126),
    ]);

    expect(cell(view, SOLO, 'host-1')).toEqual({ i: 0, verdict: 'protected', at: iso(T1), earlier: ['detected', 'unprotected'] });
    expect(cell(view, CHAIN, 'host-1')).toEqual({ i: 0, verdict: 'protected', at: iso(T1), earlier: ['unprotected'] });
  });

  it('counts a run the EDR stopped before any stage as the chain\'s cell', async () => {
    const view = await matrix([
      stage(T0, 1, 101),
      {
        ...single(T1, CHAIN, 126, { name: 'Chain A' }),
        'f0rtika.bundle_id': CHAIN,
        'f0rtika.bundle_name': 'Chain A',
        'f0rtika.edr_terminated': true,
      },
    ]);

    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]).toMatchObject({ kind: 'chain', name: 'Chain A' });
    expect(cell(view, CHAIN, 'host-1')).toMatchObject({ verdict: 'protected', at: iso(T1), earlier: ['unprotected'] });
  });

  it('ignores outcome filters, basis and scoring mode', async () => {
    const plain = await matrix(FLEET);

    const filtered = await matrix(FLEET, { ...RANGE, result: 'unprotected', errorCodes: '101', errorNames: 'Unprotected', basis: 'executions', scoringMode: 'all-stages' });

    expect(filtered).toEqual(plain);
  });

  it('applies scope filters', async () => {
    const view = await matrix(FLEET, { ...RANGE, hostnames: 'host-1' });

    expect(view.hosts.map((h) => h.hostname)).toEqual(['host-1']);
    expect(view.tests.map((t) => t.counts.neverRun)).toEqual([0, 0, 0]);
  });

  it('keeps one hostname of two organizations apart', async () => {
    const view = await matrix([single(T0, SOLO, 126), single(T0, SOLO, 101, { org: 'org-b' })]);

    expect(view.hosts.map((h) => [h.key, h.org])).toEqual([['org-b|host-1', 'org-b'], ['org-a|host-1', 'org-a']]);
    expect(cell(view, SOLO, 'host-1', 'org-a')).toMatchObject({ verdict: 'protected' });
    expect(cell(view, SOLO, 'host-1', 'org-b')).toMatchObject({ verdict: 'unprotected' });
  });

  describe('risk acceptance', () => {
    it('marks a pair whose test is accepted on that host, and no other', async () => {
      mockExclusion.mockResolvedValue({
        bool: { must_not: [{ bool: { must: [{ term: { 'f0rtika.test_name': 'Solo test' } }, { term: { 'routing.hostname': 'host-2' } }] } }] },
      });

      const view = await matrix(FLEET);

      expect(cell(view, SOLO, 'host-2')).toEqual({ i: view.hosts.findIndex((h) => h.hostname === 'host-2'), verdict: 'risk_accepted', at: iso(T0) });
      expect(cell(view, SOLO, 'host-1')).toMatchObject({ verdict: 'protected' });
      expect(view.tests.find((t) => t.testUuid === SOLO)!.counts).toMatchObject({ protected: 1, unprotected: 0, riskAccepted: 1 });
    });

    it('keeps a chain\'s verdict when one of its stages is accepted', async () => {
      mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.control_id': 'T2' } }] } });

      // Without stage 2 (blocked) the run is judged by its other stages: stage 3's own alert.
      const view = await matrix([stage(T0, 1, 101), stage(T0, 2, 126), stage(T0, 3, 101, { flags: OWN })]);

      expect(cell(view, CHAIN, 'host-1')).toEqual({ i: 0, verdict: 'detected', at: iso(T0) });
    });

    it('marks an accepted test that never had a verdict on that host', async () => {
      mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.test_name': 'Not applicable here' } }] } });

      const view = await matrix([single(T0, SOLO, 126), single(T1, FAILS, 999, { name: 'Not applicable here' })]);

      expect(cell(view, FAILS, 'host-1')).toEqual({ i: 0, verdict: 'risk_accepted', at: iso(T1) });
      expect(view.tests.find((t) => t.testUuid === FAILS)).toMatchObject({ name: 'Not applicable here' });
    });

    it('reads a chain as "no verdict" when its only conclusive stage is accepted', async () => {
      mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.control_id': 'T2' } }] } });

      const view = await matrix([stage(T0, 1, 999), stage(T0, 2, 126), stage(T0, 3, 999)]);

      expect(cell(view, CHAIN, 'host-1')).toEqual({ i: 0, verdict: 'no_verdict', at: iso(T0) });
    });

    it('reads the unfiltered results only when a risk is accepted', async () => {
      await matrix(FLEET);
      const without = mockSearch.mock.calls.length;
      mockSearch.mockClear();
      mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.control_id': 'CH-3' } }] } });

      await matrix(FLEET);

      // Each of the two fetches (conclusive, no verdict) runs once more without the exclusion.
      expect(mockSearch.mock.calls.length).toBe(2 * without);
    });

    it('counts an accepted control in its bundle\'s ratio', async () => {
      mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.control_id': 'CH-3' } }] } });

      const view = await matrix(FLEET);

      expect(cell(view, HYGIENE, 'host-1')).toMatchObject({ ratio: { compliant: 2, evaluated: 2, notAssessed: 0, accepted: 1 } });
    });
  });

  describe('bounded work', () => {
    const fleet = (hosts: number): Doc[] =>
      Array.from({ length: hosts }, (_, i) => [
        single(T0, SOLO, i % 2 ? 126 : 101, { host: `host-${i}` }),
        stage(T0, 1, 101, { host: `host-${i}` }),
        control(T0, 'CH-1', 126, { host: `host-${i}` }),
      ]).flat();

    it('makes the same number of searches for 2 hosts and for 40', async () => {
      await matrix(fleet(2));
      const forTwo = mockSearch.mock.calls.length;
      mockSearch.mockClear();

      const view = await matrix(fleet(40));

      expect(view.hostCount).toBe(40);
      expect(forTwo).toBeGreaterThan(0);
      expect(mockSearch.mock.calls.length).toBe(forTwo);
    });

    it('answers a second request from its short cache, and a different scope from Elasticsearch', async () => {
      const es = createService();
      await matrix(FLEET, RANGE, es);
      mockSearch.mockClear();

      const again = (await es.getCoverageMatrix(RANGE, { rows: 'hosts', page: 1, pageSize: 25 })) as CoverageMatrixHostsResponse;

      expect(again.hostCount).toBe(2);
      expect(mockSearch).not.toHaveBeenCalled();

      await es.getCoverageMatrix({ ...RANGE, hostnames: 'host-1' }, { rows: 'tests' });
      expect(mockSearch).toHaveBeenCalled();
    });

    it('reads the window and nothing before it', async () => {
      await matrix(FLEET);

      const lowerBounds = mockSearch.mock.calls.map(([req]) => req.query.bool.filter.find((f: any) => f.range)?.range['routing.event_time'].gte);
      expect(new Set(lowerBounds)).toEqual(new Set(['2025-01-01T00:00:00.000Z']));
    });

    it('caps the window at 365 days', async () => {
      const view = await matrix([], { from: 'now-400d', to: 'now' });

      expect(view).toMatchObject({ windowLabel: 'last 365d', hosts: [], tests: [] });
    });
  });

  describe('rows = hosts', () => {
    it('returns a page of hosts with their cells', async () => {
      useIndex(FLEET);

      const view = (await createService().getCoverageMatrix(RANGE, { rows: 'hosts', page: 1, pageSize: 1 })) as CoverageMatrixHostsResponse;

      expect(view).toMatchObject({ rows: 'hosts', hostCount: 2, testCount: 3, page: 1, pageSize: 1 });
      expect(view.hosts.map((h) => h.hostname)).toEqual(['host-2']);
      expect(view.hosts[0].cells.map((c) => [c.i, c.verdict ?? 'ratio'])).toEqual([[0, 'unprotected'], [1, 'detected'], [2, 'ratio']]);
    });

    it('for one test and verdict, reads only that test and lists the hosts of that segment', async () => {
      useIndex(FLEET);

      const view = (await createService().getCoverageMatrix(RANGE, {
        rows: 'hosts', page: 1, pageSize: 25, testUuid: SOLO, verdict: 'unprotected',
      })) as CoverageMatrixHostsResponse;

      expect(view.tests.map((t) => t.testUuid)).toEqual([SOLO]);
      expect(view.hosts.map((h) => h.hostname)).toEqual(['host-2']);
      expect(view.hostCount).toBe(1);
      // Every search was scoped to the test (or bundle) id.
      const scoped = { bool: { should: [{ term: { 'f0rtika.test_uuid': SOLO } }, { term: { 'f0rtika.bundle_id': SOLO } }], minimum_should_match: 1 } };
      for (const [req] of mockSearch.mock.calls) expect(req.query.bool.filter).toContainEqual(scoped);
    });

    it('finds a chain by its bundle id', async () => {
      useIndex(FLEET);

      const view = (await createService().getCoverageMatrix(RANGE, { rows: 'hosts', page: 1, pageSize: 25, testUuid: CHAIN })) as CoverageMatrixHostsResponse;

      expect(view.tests.map((t) => [t.testUuid, t.kind])).toEqual([[CHAIN, 'chain']]);
      // Only the chain is read, and neither host is unprotected on it: hosts by name.
      expect(view.hosts.map((h) => [h.hostname, h.cells[0].verdict])).toEqual([['host-1', 'protected'], ['host-2', 'detected']]);
    });
  });
});
