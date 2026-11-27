import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';
import { activityBuckets } from '../activityBuckets.js';

// Runs per time bucket for the strip above All Executions (getExecutionsActivity),
// and that it counts by the same rules as the Dashboard's cadence card.

const mockSearch = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
    this.count = vi.fn();
    this.info = vi.fn();
    this.indices = { exists: vi.fn(), create: vi.fn() };
  }),
}));

vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService, COMPOSITE_MAX_PAGES, STRIP_CACHE_TTL_MS } = await import('../elasticsearch.js');

const settings: AnalyticsSettings = {
  connectionType: 'direct',
  node: 'http://localhost:9200',
  apiKey: 'test-key',
  indexPattern: 'f0rtika-*',
  configured: true,
};
const createService = () => new ElasticsearchService(settings);

const TZ = 'America/Santo_Domingo';
const FROM = '2026-11-10T12:00:00.000Z';
const TO = '2026-11-13T12:00:00.000Z';
const WINDOW = { from: FROM, to: TO };
/** Four whole days: local midnight is 04:00 UTC. The first and last reach past the window. */
const BOUNDS = activityBuckets(Date.parse(FROM), Date.parse(TO), TZ).buckets;

const rangeBucket = (index: number, p: number, u: number, i: number) => ({
  from: BOUNDS[index].from,
  to: BOUNDS[index].to + 1,
  doc_count: p + u + i,
  protected: { doc_count: p },
  unprotected: { doc_count: u },
  inconclusive: { doc_count: i },
});
/** One bundle run as the composite returns it. */
const run = (r: { ts: string | number; stages: number; conclusive: number; protected: number; hygiene?: boolean; host?: string }) => ({
  key: { oid: 'org-a', bundle: 'b1', host: r.host ?? 'HOST-1', ts: typeof r.ts === 'number' ? r.ts : Date.parse(r.ts) },
  doc_count: r.stages,
  conclusive: { doc_count: r.conclusive },
  protected: { doc_count: r.protected },
  hygiene: { doc_count: r.hygiene ? r.stages : 0 },
});

function route(opts: { standalone?: unknown[]; runs?: unknown[][] } = {}) {
  const pages = [...(opts.runs ?? [[]])];
  mockSearch.mockImplementation(async (req: any) => {
    if (req.aggs?.strip_runs) {
      const p = (pages.shift() ?? []) as any[];
      return { aggregations: { strip_runs: p.length ? { buckets: p, after_key: p[p.length - 1].key } : { buckets: [] } } };
    }
    if (req.aggs?.activity_runs) return { aggregations: { activity_runs: { buckets: [] } } };
    return {
      aggregations: {
        standalone: { per_bucket: { buckets: opts.standalone ?? [] }, per_day: { buckets: [] } },
        all_time: { org: { last: { value: null } } },
        last_7d: { endpoints: { value: 0 } },
      },
    };
  });
}
const searches = () => mockSearch.mock.calls.map((c) => c[0]);
const standaloneSearch = () => searches().find((r: any) => r.aggs?.standalone?.aggs?.per_bucket);
const runSearch = () => searches().find((r: any) => r.aggs?.strip_runs);

beforeEach(() => {
  mockSearch.mockReset();
});

describe('getExecutionsActivity', () => {
  // Identical questions, at once or within a few seconds, are read from Elasticsearch once.
  it('shares one read between identical requests, briefly', async () => {
    // The cache drops an answer with a timer.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      route();
      const es = createService();

      const [a, b] = await Promise.all([es.getExecutionsActivity(WINDOW, TZ), es.getExecutionsActivity(WINDOW, TZ)]);
      expect(b).toEqual(a);
      // One standalone search and one bundle-run page.
      expect(mockSearch).toHaveBeenCalledTimes(2);

      await es.getExecutionsActivity({ ...WINDOW, hostnames: 'HOST-1' }, TZ);
      await es.getExecutionsActivity(WINDOW, 'UTC');
      expect(mockSearch).toHaveBeenCalledTimes(6);

      vi.advanceTimersByTime(STRIP_CACHE_TTL_MS + 1);
      await es.getExecutionsActivity(WINDOW, TZ);
      expect(mockSearch).toHaveBeenCalledTimes(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers one entry per bucket of the window, zero-filled, with the interval and the zone', async () => {
    route({ standalone: [rangeBucket(0, 3, 2, 1), rangeBucket(2, 5, 0, 0)] });

    const result = await createService().getExecutionsActivity(WINDOW, TZ);

    expect(result).toEqual({
      interval: 'day',
      timeZone: TZ,
      buckets: [
        { from: '2026-11-10T04:00:00.000Z', to: '2026-11-11T03:59:59.999Z', protected: 3, unprotected: 2, noVerdict: 1 },
        { from: '2026-11-11T04:00:00.000Z', to: '2026-11-12T03:59:59.999Z', protected: 0, unprotected: 0, noVerdict: 0 },
        { from: '2026-11-12T04:00:00.000Z', to: '2026-11-13T03:59:59.999Z', protected: 5, unprotected: 0, noVerdict: 0 },
        { from: '2026-11-13T04:00:00.000Z', to: '2026-11-14T03:59:59.999Z', protected: 0, unprotected: 0, noVerdict: 0 },
      ],
    });
  });

  it('counts standalone results in ranges that are exactly the buckets', async () => {
    route();
    await createService().getExecutionsActivity(WINDOW, TZ);

    const agg = standaloneSearch().aggs.standalone.aggs.per_bucket.date_range;
    expect(agg.field).toBe('routing.event_time');
    // A range's `to` is exclusive in Elasticsearch: the next bucket's start.
    expect(agg.ranges).toEqual(BOUNDS.map((b) => ({ from: b.from, to: b.to + 1 })));
    expect(agg.format).toBe('epoch_millis');
  });

  it('reads every bucket whole, in both searches: a bar must equal what its click lists', async () => {
    route();
    await createService().getExecutionsActivity(WINDOW, TZ);

    // Not the window's own instants: the first and the last day are counted from midnight to midnight.
    const range = { range: { 'routing.event_time': { gte: '2026-11-10T04:00:00.000Z', lte: '2026-11-14T03:59:59.999Z' } } };
    expect(standaloneSearch().query.bool.filter).toContainEqual(range);
    expect(runSearch().query.bool.filter).toContainEqual(range);
    expect(runSearch().query.bool.filter).toContainEqual({ exists: { field: 'f0rtika.bundle_id' } });
    expect(standaloneSearch().aggs.standalone.filter).toEqual({ bool: { must_not: [{ exists: { field: 'f0rtika.bundle_id' } }] } });
  });

  it('follows the filter bar, but not its outcome filters', async () => {
    route();
    await createService().getExecutionsActivity({ ...WINDOW, hostnames: 'HOST-1', org: 'org-1' }, TZ);
    const plain = standaloneSearch().query;
    const plainRuns = runSearch().query;
    expect(JSON.stringify(plain)).toContain('HOST-1');
    expect(JSON.stringify(plain)).toContain('{"term":{"routing.oid":"org-1"}}');
    expect(JSON.stringify(plainRuns)).toContain('HOST-1');

    mockSearch.mockClear();
    await createService().getExecutionsActivity(
      { ...WINDOW, hostnames: 'HOST-1', org: 'org-1', result: 'unprotected', errorCodes: '101', errorNames: 'Unprotected' },
      TZ,
    );
    expect(standaloneSearch().query).toEqual(plain);
    expect(runSearch().query).toEqual(plainRuns);
  });

  it('counts a bundle run once, by its chain-level verdict, in the bucket of its time', async () => {
    route({
      runs: [[
        // An attack bundle: one protected stage of three is a protected run.
        run({ ts: '2026-11-11T10:00:00.000Z', stages: 3, conclusive: 3, protected: 1 }),
        // Stages ran, none protected.
        run({ ts: '2026-11-11T11:00:00.000Z', stages: 3, conclusive: 2, protected: 0 }),
        // No conclusive stage.
        run({ ts: '2026-11-11T12:00:00.000Z', stages: 3, conclusive: 0, protected: 0 }),
        // Cyber-hygiene: every conclusive control must pass.
        run({ ts: '2026-11-12T10:00:00.000Z', stages: 10, conclusive: 10, protected: 9, hygiene: true }),
        run({ ts: '2026-11-12T11:00:00.000Z', stages: 10, conclusive: 10, protected: 10, hygiene: true }),
      ]],
    });

    const { buckets } = await createService().getExecutionsActivity(WINDOW, TZ);

    expect(buckets.map((b) => [b.protected, b.unprotected, b.noVerdict])).toEqual([
      [0, 0, 0],
      [1, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ]);
  });

  it('adds bundle runs to the standalone results of the same bucket', async () => {
    route({
      standalone: [rangeBucket(1, 2, 1, 0)],
      runs: [[run({ ts: '2026-11-11T10:00:00.000Z', stages: 3, conclusive: 3, protected: 1 })]],
    });

    const { buckets } = await createService().getExecutionsActivity(WINDOW, TZ);

    expect(buckets[1]).toMatchObject({ protected: 3, unprotected: 1, noVerdict: 0 });
  });

  it('counts a run on a bucket boundary in the later bucket only, and drops one outside the window', async () => {
    route({
      runs: [[
        run({ ts: BOUNDS[1].from, stages: 2, conclusive: 2, protected: 2 }),
        run({ ts: BOUNDS[1].from - 1, stages: 2, conclusive: 2, protected: 0, host: 'HOST-2' }),
        run({ ts: BOUNDS[3].to + 1, stages: 2, conclusive: 2, protected: 2, host: 'HOST-3' }),
      ]],
    });

    const { buckets } = await createService().getExecutionsActivity(WINDOW, TZ);

    expect(buckets.map((b) => [b.protected, b.unprotected])).toEqual([[0, 1], [1, 0], [0, 0], [0, 0]]);
  });

  it('says when the bundle-run cap was reached: the counts are a lower bound', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => run({ ts: '2026-11-11T10:00:00.000Z', stages: 1, conclusive: 1, protected: 1, host: `H-${i}` }));
    mockSearch.mockImplementation(async (req: any) => {
      if (req.aggs?.strip_runs) return { aggregations: { strip_runs: { buckets: full, after_key: full[full.length - 1].key } } };
      return { aggregations: { standalone: { per_bucket: { buckets: [] } } } };
    });

    const result = await createService().getExecutionsActivity(WINDOW, TZ);

    expect(result.truncated).toBe(true);
    expect(searches().filter((r: any) => r.aggs?.strip_runs)).toHaveLength(COMPOSITE_MAX_PAGES);
  });

  it('has no truncated or capped key otherwise', async () => {
    route();
    const result = await createService().getExecutionsActivity(WINDOW, TZ);
    expect(result).not.toHaveProperty('truncated');
    expect(result).not.toHaveProperty('capped');
  });

  it('draws the last 365 days of a longer window, and says so', async () => {
    route();
    const result = await createService().getExecutionsActivity({ from: '2025-01-01T00:00:00.000Z', to: TO }, 'UTC');

    expect(result.capped).toBe(true);
    expect(result.interval).toBe('week');
    // The week that holds the instant 365 days back, from its Monday.
    const yearBack = Date.parse(TO) - 365 * 86_400_000;
    expect(Date.parse(result.buckets[0].from)).toBeLessThanOrEqual(yearBack);
    expect(Date.parse(result.buckets[0].to)).toBeGreaterThanOrEqual(yearBack);
    // What is not drawn is not read either.
    expect(standaloneSearch().query.bool.filter).toContainEqual({
      range: { 'routing.event_time': { gte: result.buckets[0].from, lte: result.buckets[result.buckets.length - 1].to } },
    });
  });

  describe('the window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse('2026-11-26T15:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('is the last 7 days when none is given, as for the other analytics endpoints', async () => {
      route();
      const result = await createService().getExecutionsActivity({}, 'UTC');

      expect(result.interval).toBe('day');
      expect(result.buckets[0].from).toBe('2026-11-19T00:00:00.000Z');
      expect(result.buckets[result.buckets.length - 1].to).toBe('2026-11-26T23:59:59.999Z');
      expect(result.buckets).toHaveLength(8);
    });

    it('counts the 7 days before an end given alone, as the coverage matrix does', async () => {
      route();
      const result = await createService().getExecutionsActivity({ to: '2026-10-10T12:00:00.000Z' }, 'UTC');

      expect(result.buckets[0].from).toBe('2026-10-03T00:00:00.000Z');
      expect(result.buckets[result.buckets.length - 1].to).toBe('2026-10-10T23:59:59.999Z');
    });

    it('accepts the relative form the filter bar can send', async () => {
      route();
      const result = await createService().getExecutionsActivity({ from: 'now-24h' }, 'UTC');

      expect(result.interval).toBe('hour');
      expect(result.buckets[0].from).toBe('2026-11-25T15:00:00.000Z');
      expect(result.buckets).toHaveLength(25);
    });

    it('answers the same buckets a minute later: a selected bucket keeps matching its bar', async () => {
      route();
      const first = await createService().getExecutionsActivity({ from: 'now-30d' }, TZ);
      vi.setSystemTime(Date.parse('2026-11-26T15:01:00.000Z'));
      const later = await createService().getExecutionsActivity({ from: 'now-30d' }, TZ);

      expect(later.buckets.map((b) => [b.from, b.to])).toEqual(first.buckets.map((b) => [b.from, b.to]));
    });
  });

  it.each([
    ['a date given twice', { from: ['2026-11-01', '2026-11-02'] as unknown as string, to: TO }],
    ['a date beyond what a date can hold', { from: FROM, to: '+275760-09-13T00:00:00.000Z' }],
    ['a date before the calendar', { from: '-271821-04-20T00:00:00.000Z', to: TO }],
  ])('refuses %s as a bad request, not a server error', async (_name, params) => {
    route();
    await expect(createService().getExecutionsActivity(params, TZ)).rejects.toMatchObject({ statusCode: 400, message: 'Invalid date range' });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('refuses a date it cannot read', async () => {
    route();
    await expect(createService().getExecutionsActivity({ from: 'yesterday-ish', to: TO }, TZ)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid date range',
    });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('asks nothing for a window that is empty', async () => {
    route();
    const result = await createService().getExecutionsActivity({ from: TO, to: FROM }, TZ);
    expect(result.buckets).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe('the strip counts as the cadence card counts', () => {
  it('uses the card\'s rules for what is counted and for each outcome', async () => {
    route();
    const svc = createService();
    await svc.getExecutionsActivity({ ...WINDOW, org: 'org-1' }, TZ);
    await svc.getExecutionActivity({ org: 'org-1', days: 14 });

    const strip = standaloneSearch();
    const card = searches().find((r: any) => r.aggs?.standalone?.aggs?.per_day);
    const counted = (r: any) => r.query.bool.filter.find((f: any) => f.bool?.must_not);
    // Real test results only: no upload confirmations, no skipped bundle stages.
    expect(counted(strip)).toEqual(counted(card));
    expect(counted(strip)).toBeDefined();
    // Protected, unprotected, no verdict of a standalone result.
    expect(strip.aggs.standalone.aggs.per_bucket.aggs).toEqual(card.aggs.standalone.aggs.per_day.aggs);

    const stripRuns = runSearch();
    const cardRuns = searches().find((r: any) => r.aggs?.activity_runs);
    expect(stripRuns.aggs.strip_runs.aggs).toEqual(cardRuns.aggs.activity_runs.aggs);
    expect(stripRuns.aggs.strip_runs.composite.sources).toEqual(cardRuns.aggs.activity_runs.composite.sources);
  });
});
