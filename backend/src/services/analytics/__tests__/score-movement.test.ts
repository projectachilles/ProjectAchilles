import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// Score movement: the fetch behind the "What moved the score" card. The real
// queries run against a small in-memory ES, so the reads (prior, period with
// each day's first result, known tests, risk acceptance) are exercised; the
// rules themselves are tested in scoreMovement.test.ts.

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
function stage(at: string, bundleUuid: string, n: number, code: number, o: DocOpts = {}): Doc {
  return {
    'routing.oid': o.org ?? 'org-a',
    'routing.hostname': o.host ?? 'host-1',
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
    'f0rtika.test_uuid': `${bundleUuid}::T${n}`,
    'f0rtika.test_name': `Chain A - Stage ${n}`,
    'f0rtika.bundle_id': bundleUuid,
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

/** One run of an attack chain: one stage document per code. */
function chainRun(at: string, bundleUuid: string, codes: number[], o: DocOpts = {}): Doc[] {
  return codes.map((code, i) => stage(at, bundleUuid, i + 1, code, o));
}

function service() {
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
const RANGE: Params = { from: 'now-30d', to: 'now' };

describe('getScoreMovement', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
    mockExclusion.mockReset();
    mockExclusion.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sees a failure and its fix on the same day', async () => {
    useIndex([single('2026-11-20T08:00:00Z', SOLO, 101), single('2026-11-20T17:00:00Z', SOLO, 126)]);
    const m = await service().getScoreMovement(RANGE);
    expect(m.failures).toMatchObject({ total: 1, fixed: 1 });
    expect(m.newTests).toMatchObject({ pairs: 1, gotThrough: 1, gotThroughFixed: 1 });
  });

  it('counts a chain failure fixed by a block before any stage, and says the score still counts it', async () => {
    useIndex([...chainRun('2026-11-10T10:00:00Z', CHAIN, [101, 101]), single('2026-11-20T10:00:00Z', CHAIN, 126)]);
    const m = await service().getScoreMovement(RANGE);
    expect(m.failures).toMatchObject({ total: 1, fixed: 1, stillFailing: 0, notRetested: 0 });
    expect(m.scoreDifference).toEqual({ fixedButCounted: 1, countedTwice: 0 });
    expect(m.failing.end).toBe(1);
  });

  it('does not read an old test as new when the request filters to one host', async () => {
    useIndex([single('2026-09-20T10:00:00Z', SOLO, 126, { host: 'host-1' }), single('2026-11-20T10:00:00Z', SOLO, 101, { host: 'host-2' })]);
    const m = await service().getScoreMovement({ ...RANGE, hostnames: 'host-2' });
    expect(m.newTests.pairs).toBe(0);
    expect(m.failures.origins).toMatchObject({ newTest: 0, firstOnEndpoint: 1 });
  });

  it('does not read an old test as new when its earlier results are risk-accepted', async () => {
    useIndex([single('2026-09-20T10:00:00Z', SOLO, 126, { host: 'host-1' }), single('2026-11-20T10:00:00Z', SOLO, 101, { host: 'host-2' })]);
    mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'routing.hostname': 'host-1' } }] } });
    const m = await service().getScoreMovement(RANGE);
    expect(m.newTests.pairs).toBe(0);
    expect(m.failures.origins).toMatchObject({ newTest: 0, firstOnEndpoint: 1 });
  });

  it('reads the state before the period up to 365 days back', async () => {
    useIndex([single('2026-08-01T10:00:00Z', SOLO, 101), single('2026-11-20T10:00:00Z', SOLO, 126)]);
    expect((await service().getScoreMovement(RANGE)).failures).toMatchObject({ fixed: 1, origins: { olderRetested: 1 } });
  });

  it('reports open failures hidden by a risk acceptance', async () => {
    useIndex([single('2026-11-20T10:00:00Z', SOLO, 101), single('2026-11-20T10:00:00Z', FAILS, 101)]);
    mockExclusion.mockResolvedValue({ bool: { must_not: [{ term: { 'f0rtika.test_uuid': SOLO } }] } });
    const m = await service().getScoreMovement(RANGE);
    expect(m.failures.total).toBe(1);
    expect(m.riskAccepted).toBe(1);
  });

  it('keeps another organization out', async () => {
    useIndex([single('2026-11-20T10:00:00Z', SOLO, 101, { org: 'org-b' })]);
    expect((await service().getScoreMovement({ ...RANGE, org: 'org-a' })).failures.total).toBe(0);
  });

  it('ignores scoringMode and the outcome filters', async () => {
    useIndex([single('2026-11-20T10:00:00Z', SOLO, 101)]);
    const m = await service().getScoreMovement({ ...RANGE, scoringMode: 'all-stages', result: 'protected' });
    expect(m.failures.total).toBe(1);
  });

  it('rejects a range that ends before it starts', async () => {
    await expect(service().getScoreMovement({ from: 'now', to: 'now-7d' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('leaves the Defense Score requests as they were', async () => {
    useIndex([single('2026-11-20T10:00:00Z', SOLO, 101)]);
    const es = service();
    // The method the /defense-score/trend route calls for basis=latest.
    await es.getDefenseScoreTrendLatest({ ...RANGE, interval: 'day', scoringMode: 'any-stage', basis: 'latest' });
    const afterTrend = mockSearch.mock.calls.length;
    await es.getCoverageMatrix(RANGE, { rows: 'tests' });
    const afterMatrix = mockSearch.mock.calls.length;
    await es.getOutcomeBreakdown({ ...RANGE, scoringMode: 'any-stage' });
    // Each of the three made its own requests, and none asks for each day's first result.
    expect(afterTrend).toBeGreaterThan(0);
    expect(afterMatrix).toBeGreaterThan(afterTrend);
    expect(mockSearch.mock.calls.length).toBeGreaterThan(afterMatrix);
    expect(JSON.stringify(mockSearch.mock.calls)).not.toContain('"earliest"');
  });

  it('shares one load between concurrent calls for the same range, and not with another range', async () => {
    useIndex([single('2026-11-20T10:00:00Z', SOLO, 101)]);
    await service().getScoreMovement(RANGE);
    const perLoad = mockSearch.mock.calls.length;
    mockSearch.mockClear();

    const es = service();
    const [a, b] = await Promise.all([es.getScoreMovement(RANGE), es.getScoreMovement({ ...RANGE })]);
    expect(b).toEqual(a);
    expect(mockSearch.mock.calls.length).toBe(perLoad);

    await es.getScoreMovement({ from: 'now-7d', to: 'now' });
    expect(mockSearch.mock.calls.length).toBe(2 * perLoad);
  });

  it('does not keep a failed load', async () => {
    const es = service();
    mockSearch.mockRejectedValueOnce(new Error('boom'));
    await expect(es.getScoreMovement(RANGE)).rejects.toThrow('boom');
    useIndex([single('2026-11-20T10:00:00Z', SOLO, 101)]);
    expect((await es.getScoreMovement(RANGE)).failures.total).toBe(1);
  });

  // RANGE starts at 2026-10-27T12:00:00.000Z (now - 30 days).
  it('counts a result at exactly the range start as a period result', async () => {
    useIndex([single('2026-10-27T12:00:00.000Z', SOLO, 101)]);
    const m = await service().getScoreMovement(RANGE);
    expect(m.failures).toMatchObject({ total: 1, notRetested: 1, leftUntested: 0, origins: { newTest: 1, openAtStart: 0 } });
    expect(m.newTests).toMatchObject({ pairs: 1, gotThrough: 1 });
  });

  it('counts a result one millisecond before the range start as the prior result', async () => {
    useIndex([single('2026-10-27T11:59:59.999Z', SOLO, 101)]);
    const m = await service().getScoreMovement(RANGE);
    expect(m.failures).toMatchObject({ total: 1, leftUntested: 1, origins: { openAtStart: 1, newTest: 0 } });
    expect(m.newTests.pairs).toBe(0);
  });

  it('does not read a result more than 365 days before the range start', async () => {
    // A failure 365 days and one day before the start, then a pass in the range: a new first result, not a fix.
    useIndex([single('2025-10-26T12:00:00.000Z', SOLO, 101), single('2026-11-20T10:00:00Z', SOLO, 126)]);
    const m = await service().getScoreMovement(RANGE);
    expect(m.failures).toMatchObject({ total: 0, fixed: 0 });
    expect(m.newTests).toMatchObject({ pairs: 1, stopped: 1, gotThrough: 0 });
  });
});
