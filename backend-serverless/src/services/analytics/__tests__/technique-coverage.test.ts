import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';
import {
  COVERAGE_DEFAULT_DAYS,
  defaultCoverageWindow,
  detectedClause,
  getTechniqueCoverage,
  preventedClause,
} from '../technique-coverage.js';
import type { CoverageHostScope, CoverageVendor } from '../technique-coverage.js';
import { ENRICHMENT_ELIGIBLE_ERROR_CODES } from '../enrichment-eligibility.js';
import { attackSimulationExclusions } from '../attack-simulation-filter.js';

const mockSearch = vi.fn();
const client = { search: mockSearch } as unknown as Client;

const WINDOW = { from: '2026-09-20T00:00:00Z', to: '2026-10-20T00:00:00Z' };

function opts(vendor: CoverageVendor = 'crowdstrike') {
  return { vendor, resultsIndex: 'achilles-results-*', alertIndex: `achilles-${vendor}`, window: WINDOW };
}

interface TechniqueFixture { key: string; doc_count: number; prevented: number; detected: number }

function resultsResponse(
  total: number,
  overall: { prevented: number; detected: number },
  techniques: TechniqueFixture[],
  hosts = 0,
) {
  return {
    hits: { total: { value: total, relation: 'eq' }, hits: [] },
    aggregations: {
      overall: { buckets: { prevented: { doc_count: overall.prevented }, detected: { doc_count: overall.detected } } },
      host_count: { value: hosts },
      techniques: {
        list: {
          buckets: techniques.map((t) => ({
            key: t.key,
            doc_count: t.doc_count,
            outcome: { buckets: { prevented: { doc_count: t.prevented }, detected: { doc_count: t.detected } } },
          })),
        },
      },
    },
  };
}

/** The host-scope lookup: distinct routing.hostname values among the counted results. */
function hostValuesResponse(hostnames: string[]) {
  return {
    hits: { total: { value: 0, relation: 'eq' }, hits: [] },
    aggregations: { hosts: { buckets: hostnames.map((key) => ({ key, doc_count: 1 })) } },
  };
}

function alertResponse(counts: Record<string, number>) {
  return {
    hits: { total: { value: 0, relation: 'eq' }, hits: [] },
    aggregations: {
      techniques: {
        buckets: Object.fromEntries(Object.entries(counts).map(([key, doc_count]) => [key, { doc_count }])),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal evaluator for the ES query DSL subset the predicates use, so the
// tests pin the predicate's *semantics* against concrete documents, not just
// its shape. Supports term (multi-valued fields too), prefix, exists and bool (filter/must/should/must_not,
// minimum_should_match).
// ---------------------------------------------------------------------------
type Doc = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function matches(q: QueryDslQueryContainer, doc: Doc): boolean {
  if (q.term) {
    const [field, value] = Object.entries(q.term)[0];
    const v = doc[field];
    return Array.isArray(v) ? v.includes(value) : field in doc && v === value;
  }
  if (q.prefix) {
    const [field, value] = Object.entries(q.prefix)[0];
    const prefix = typeof value === 'string' ? value : String((value as { value: string }).value);
    return asArray(doc[field] as string | string[] | undefined).some((x) => typeof x === 'string' && x.startsWith(prefix));
  }
  if (q.exists) return q.exists.field in doc && doc[q.exists.field] !== null && doc[q.exists.field] !== undefined;
  if (q.bool) {
    const b = q.bool;
    const required = [...asArray(b.filter), ...asArray(b.must)];
    if (!required.every((c) => matches(c, doc))) return false;
    if (asArray(b.must_not).some((c) => matches(c, doc))) return false;
    const should = asArray(b.should);
    if (should.length > 0) {
      const min = Number(b.minimum_should_match ?? (required.length > 0 ? 0 : 1));
      if (should.filter((c) => matches(c, doc)).length < min) return false;
    }
    return true;
  }
  throw new Error(`unsupported clause: ${JSON.stringify(q)}`);
}

describe('technique coverage', () => {
  beforeEach(() => mockSearch.mockReset());

  describe.each<CoverageVendor>(['crowdstrike', 'defender'])('predicates for %s', (v) => {
    const stage = `f0rtika.${v}_stage_detected`;
    const wide = `f0rtika.${v}_detected`;
    const prev = `f0rtika.${v}_prevented`;
    const killed = { term: { 'f0rtika.edr_terminated_vendors': v } };

    const bundle = 'f0rtika.is_bundle_control';

    it(`builds the R13 detected predicate for ${v}`, () => {
      expect(detectedClause(v)).toEqual({
        bool: {
          should: [
            { term: { [stage]: true } },
            { bool: { filter: [{ term: { [wide]: true } }], must_not: [{ term: { [bundle]: true } }] } },
            { term: { [prev]: true } },
            killed,
          ],
          minimum_should_match: 1,
        },
      });
      expect(preventedClause(v)).toEqual({ bool: { should: [{ term: { [prev]: true } }, killed], minimum_should_match: 1 } });
    });

    // An agent-killed run's whole-test doc carries no vendor flags, only the vendors that killed it.
    it('an agent this vendor killed counts as prevented and detected; another vendor\'s kill does not', () => {
      const other = v === 'crowdstrike' ? 'defender' : 'crowdstrike';
      const kill = (vendors: string[]) => ({ 'f0rtika.edr_terminated': true, 'f0rtika.edr_terminated_vendors': vendors });
      expect(matches(preventedClause(v), kill([v]))).toBe(true);
      expect(matches(detectedClause(v), kill([other, v]))).toBe(true);
      expect(matches(preventedClause(v), kill([other]))).toBe(false);
      expect(matches(detectedClause(v), kill([other]))).toBe(false);
    });

    // Enrichment only ever writes the flags as `true`; a missing flag means "not matched".
    it('does NOT credit a bundle stage matched only by the wide (bundle-UUID) query', () => {
      expect(matches(detectedClause(v), { [bundle]: true, [wide]: true })).toBe(false);
      expect(matches(preventedClause(v), { [bundle]: true, [wide]: true })).toBe(false);
    });

    it('credits a bundle stage by its own stage flag', () => {
      expect(matches(detectedClause(v), { [bundle]: true, [stage]: true })).toBe(true);
      expect(matches(detectedClause(v), { [bundle]: true, [wide]: true, [stage]: true })).toBe(true);
    });

    it('credits a standalone test by its own detection flag', () => {
      expect(matches(detectedClause(v), { [wide]: true })).toBe(true);
      expect(matches(detectedClause(v), { [bundle]: false, [wide]: true })).toBe(true);
      expect(matches(detectedClause(v), { [stage]: true })).toBe(true);
      expect(matches(detectedClause(v), {})).toBe(false);
      expect(matches(detectedClause(v), { [bundle]: true })).toBe(false);
    });

    it('a vendor-confirmed prevention counts as prevented and detected', () => {
      expect(matches(preventedClause(v), { [prev]: true })).toBe(true);
      expect(matches(detectedClause(v), { [prev]: true })).toBe(true);
      expect(matches(detectedClause(v), { [bundle]: true, [prev]: true })).toBe(true);
      expect(matches(preventedClause(v), { [stage]: true })).toBe(false);
      expect(matches(preventedClause(v), { [wide]: true })).toBe(false);
    });

    it(`puts the ${v} predicates into both the overall and per-technique filters aggs`, async () => {
      mockSearch
        .mockResolvedValueOnce(resultsResponse(1, { prevented: 0, detected: 1 }, [{ key: 'T1486', doc_count: 1, prevented: 0, detected: 1 }]))
        .mockResolvedValueOnce(alertResponse({}));
      await getTechniqueCoverage(client, opts(v));

      const req = mockSearch.mock.calls[0][0];
      const expected = { filters: { prevented: preventedClause(v), detected: detectedClause(v) } };
      expect(req.aggs.overall.filters).toEqual(expected);
      expect(req.aggs.techniques.aggs.list.terms).toEqual({ field: 'f0rtika.techniques', size: 500 });
      expect(req.aggs.techniques.aggs.list.aggs.outcome.filters).toEqual(expected);
      const other = v === 'crowdstrike' ? 'defender' : 'crowdstrike';
      expect(JSON.stringify(req)).not.toContain(other);
    });
  });

  it('applies eligibility, exclusions and the window to the results query', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(1, { prevented: 0, detected: 0 }, [{ key: 'T1486', doc_count: 1, prevented: 0, detected: 0 }]))
      .mockResolvedValueOnce(alertResponse({}));
    await getTechniqueCoverage(client, opts());

    const req = mockSearch.mock.calls[0][0];
    expect(req.index).toBe('achilles-results-*');
    expect(req.size).toBe(0);
    expect(req.track_total_hits).toBe(true);
    expect(req.query.bool.filter).toEqual([
      { range: { 'routing.event_time': { gte: WINDOW.from, lte: WINDOW.to } } },
      { terms: { 'event.ERROR': ENRICHMENT_ELIGIBLE_ERROR_CODES } },
    ]);
    expect(req.query.bool.must_not).toEqual(attackSimulationExclusions());
    expect(req.aggs.host_count).toEqual({ cardinality: { field: 'routing.hostname' } });
  });

  it('counts stageless runs (launch-blocked, agent-killed) in the totals but never under a technique', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(1, { prevented: 0, detected: 0 }, []))
      .mockResolvedValueOnce(alertResponse({}));
    await getTechniqueCoverage(client, opts());

    const req = mockSearch.mock.calls[0][0];
    // Nothing in the query itself drops them, so `overall` and hits.total include them...
    expect(JSON.stringify(req.query)).not.toContain('edr_launch_blocked');
    expect(JSON.stringify(req.query)).not.toContain('edr_terminated');
    // ...while the technique rows only see docs where stages ran.
    const rowFilter = req.aggs.techniques.filter as QueryDslQueryContainer;
    const staged: Doc = { 'f0rtika.techniques': ['T1486'] };
    expect(matches(rowFilter, staged)).toBe(true);
    expect(matches(rowFilter, { ...staged, 'f0rtika.edr_launch_blocked': true })).toBe(false);
    expect(matches(rowFilter, { ...staged, 'f0rtika.edr_terminated': true })).toBe(false);
  });

  describe('host scope', () => {
    const scope = (hostnames: string[]): CoverageHostScope => ({ source: 'inventory', hostnames });

    it('without a host scope counts every host and says so', async () => {
      mockSearch
        .mockResolvedValueOnce(resultsResponse(4, { prevented: 0, detected: 1 }, [{ key: 'T1486', doc_count: 4, prevented: 0, detected: 1 }], 3))
        .mockResolvedValueOnce(alertResponse({}));
      const res = await getTechniqueCoverage(client, opts());
      expect(res.scope).toEqual({ source: 'fleet', hosts: 3 });
      expect(JSON.stringify(mockSearch.mock.calls[0][0].query)).not.toContain('routing.hostname');
    });

    it('limits the results to the scope\'s hosts, matching short names case-insensitively', async () => {
      mockSearch
        .mockResolvedValueOnce(hostValuesResponse(['WS-01.corp.example', 'ws-02', 'OTHER-HOST', 'WS-010']))
        .mockResolvedValueOnce(resultsResponse(2, { prevented: 0, detected: 1 }, [{ key: 'T1486', doc_count: 2, prevented: 0, detected: 1 }], 2))
        .mockResolvedValueOnce(alertResponse({}));
      const res = await getTechniqueCoverage(client, {
        ...opts('sentinelone'),
        hostScope: scope(['ws-01', 'WS-02.corp.example', 'never-tested']),
      });

      const hostQuery = mockSearch.mock.calls[0][0];
      expect(hostQuery.size).toBe(0);
      expect(hostQuery.aggs.hosts.terms.field).toBe('routing.hostname');
      const results = mockSearch.mock.calls[1][0];
      // Same counted set as the results query, before the host filter.
      expect(hostQuery.query).toEqual({ bool: { ...results.query.bool, filter: results.query.bool.filter.slice(0, -1) } });
      expect(results.query.bool.filter.at(-1)).toEqual({ terms: { 'routing.hostname': ['WS-01.corp.example', 'ws-02'] } });
      expect(res.scope).toEqual({ source: 'inventory', hosts: 2 });
      expect(res.overall.executions).toBe(2);
    });

    it('a scope none of whose hosts ran a test counts nothing (an empty terms filter matches no doc)', async () => {
      mockSearch
        .mockResolvedValueOnce(hostValuesResponse(['OTHER-HOST']))
        .mockResolvedValueOnce({ hits: { total: { value: 0, relation: 'eq' }, hits: [] }, aggregations: undefined });
      const res = await getTechniqueCoverage(client, { ...opts('sophos'), hostScope: { source: 'alerts', hostnames: ['ws-01'] } });
      expect(mockSearch.mock.calls[1][0].query.bool.filter.at(-1)).toEqual({ terms: { 'routing.hostname': [] } });
      expect(res.scope).toEqual({ source: 'alerts', hosts: 0 });
      expect(res.overall.executions).toBe(0);
    });
  });

  const rowFilter = (t: string) => ({
    bool: { should: [{ term: { mitre_techniques: t } }, { prefix: { mitre_techniques: `${t}.` } }], minimum_should_match: 1 },
  });

  it('counts alerts per row by the id or its sub-techniques in the created_at window, doc_type alert only', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(3, { prevented: 0, detected: 0 }, [
        { key: 'T1486', doc_count: 2, prevented: 0, detected: 0 },
        { key: 'T1574.002', doc_count: 1, prevented: 0, detected: 0 },
      ]))
      .mockResolvedValueOnce(alertResponse({ T1486: 4, 'T1574.002': 0 }));
    const res = await getTechniqueCoverage(client, opts('defender'));

    const req = mockSearch.mock.calls[1][0];
    expect(req.index).toBe('achilles-defender');
    expect(req.size).toBe(0);
    expect(req.query.bool.filter).toEqual([
      { term: { doc_type: 'alert' } },
      { range: { created_at: { gte: WINDOW.from, lte: WINDOW.to } } },
    ]);
    // One filters bucket per tested technique: the same rule as getAlerts({ techniques: [t] }).
    expect(req.aggs.techniques).toEqual({
      filters: { filters: { T1486: rowFilter('T1486'), 'T1574.002': rowFilter('T1574.002') } },
    });
    expect(res.byTechnique.find((t) => t.technique === 'T1574.002')?.alerts).toBe(0);
    expect(res.byTechnique.find((t) => t.technique === 'T1486')?.alerts).toBe(4);
  });

  it('rolls sub-technique alerts up into the parent row (distinct alerts), never parent alerts down', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(2, { prevented: 0, detected: 0 }, [
        { key: 'T1574', doc_count: 1, prevented: 0, detected: 0 },
        { key: 'T1574.002', doc_count: 1, prevented: 0, detected: 0 },
      ]))
      .mockResolvedValueOnce(alertResponse({ T1574: 3, 'T1574.002': 2 }));
    const res = await getTechniqueCoverage(client, opts('crowdstrike'));

    const filters = mockSearch.mock.calls[1][0].aggs.techniques.filters.filters as Record<string, QueryDslQueryContainer>;
    const alerts: Doc[] = [
      { mitre_techniques: ['T1574'] },                     // parent only
      { mitre_techniques: ['T1574.002'] },                 // sub-technique
      { mitre_techniques: ['T1574.001', 'T1574.002'] },    // two subs, one alert
      { mitre_techniques: ['T15740'] },                    // a different id sharing the prefix digits
    ];
    const count = (t: string) => alerts.filter((a) => matches(filters[t], a)).length;
    expect(count('T1574')).toBe(3);
    expect(count('T1574.002')).toBe(2);
    expect(res.byTechnique.find((t) => t.technique === 'T1574')?.alerts).toBe(3);
    expect(res.byTechnique.find((t) => t.technique === 'T1574.002')?.alerts).toBe(2);
  });

  it('derives detectedOnly = detected - prevented and missed = executions - detected per technique and overall', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(98, { prevented: 5, detected: 8 }, [
        { key: 'T1486', doc_count: 17, prevented: 5, detected: 8 },
      ]))
      .mockResolvedValueOnce(alertResponse({}));
    const res = await getTechniqueCoverage(client, opts());

    expect(res.byTechnique[0]).toMatchObject({ technique: 'T1486', executions: 17, prevented: 5, detectedOnly: 3, missed: 9 });
    expect(res.overall).toMatchObject({ executions: 98, prevented: 5, detectedOnly: 3, missed: 90 });
  });

  it('computes rates on distinct executions with 1 dp', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(98, { prevented: 5, detected: 8 }, [
        // Rows can sum past the distinct total (multi-technique executions); rates ignore them.
        { key: 'T1486', doc_count: 60, prevented: 5, detected: 8 },
        { key: 'T1059', doc_count: 70, prevented: 5, detected: 8 },
      ]))
      .mockResolvedValueOnce(alertResponse({}));
    const res = await getTechniqueCoverage(client, opts());

    expect(res.overall.detectionRate).toBe(8.2);
    expect(res.overall.preventionRate).toBe(5.1);
    expect(res.overall.executions).toBe(98);
    expect(res.overall.testedTechniques).toBe(2);
    expect(res.overall.detectedTechniques).toBe(2);
  });

  it('accepts a numeric hits.total', async () => {
    const r = resultsResponse(0, { prevented: 1, detected: 2 }, []);
    mockSearch.mockResolvedValueOnce({ ...r, hits: { total: 10, hits: [] } });
    const res = await getTechniqueCoverage(client, opts());
    expect(res.overall).toMatchObject({ executions: 10, prevented: 1, detectedOnly: 1, missed: 8, detectionRate: 20 });
  });

  it('returns zeros, not NaN, for an empty window', async () => {
    mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0, relation: 'eq' }, hits: [] }, aggregations: undefined });
    const res = await getTechniqueCoverage(client, opts());

    expect(res).toEqual({
      overall: {
        executions: 0, prevented: 0, detectedOnly: 0, missed: 0,
        detectionRate: 0, preventionRate: 0, testedTechniques: 0, detectedTechniques: 0,
      },
      byTechnique: [],
      scope: { source: 'fleet', hosts: 0 },
    });
    // No tested techniques → nothing to count alerts for.
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('attaches alert counts and technique names', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(3, { prevented: 0, detected: 1 }, [
        { key: 'T1486', doc_count: 2, prevented: 0, detected: 1 },
        { key: 'T9999', doc_count: 1, prevented: 0, detected: 0 },
      ]))
      .mockResolvedValueOnce(alertResponse({ T1486: 6 }));
    const res = await getTechniqueCoverage(client, opts());

    expect(res.byTechnique).toEqual([
      { technique: 'T1486', name: 'Data Encrypted for Impact', executions: 2, prevented: 0, detectedOnly: 1, missed: 1, alerts: 6 },
      { technique: 'T9999', name: null, executions: 1, prevented: 0, detectedOnly: 0, missed: 1, alerts: 0 },
    ]);
  });

  it('sorts detected techniques first, then by executions', async () => {
    mockSearch
      .mockResolvedValueOnce(resultsResponse(100, { prevented: 1, detected: 3 }, [
        { key: 'T1059', doc_count: 50, prevented: 0, detected: 0 },
        { key: 'T1003', doc_count: 5, prevented: 1, detected: 1 },
        { key: 'T1486', doc_count: 20, prevented: 0, detected: 2 },
        { key: 'T1105', doc_count: 30, prevented: 0, detected: 0 },
      ]))
      .mockResolvedValueOnce(alertResponse({}));
    const res = await getTechniqueCoverage(client, opts());

    expect(res.byTechnique.map((t) => t.technique)).toEqual(['T1486', 'T1003', 'T1059', 'T1105']);
  });

  it('defaults the window to the last 30 days', () => {
    const now = Date.parse('2026-10-20T12:00:00.000Z');
    expect(COVERAGE_DEFAULT_DAYS).toBe(30);
    expect(defaultCoverageWindow(now)).toEqual({ from: '2026-09-20T12:00:00.000Z', to: '2026-10-20T12:00:00.000Z' });
  });
});
