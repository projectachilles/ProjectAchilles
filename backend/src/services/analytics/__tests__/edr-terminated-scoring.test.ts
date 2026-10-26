import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// EDR-killed agent runs (design spec §5.2): a kill doc is a whole-test result
// (event.ERROR 126, is_protected) with f0rtika.edr_terminated, and — for a
// multi-stage test — f0rtika.bundle_id but never is_bundle_control. These
// tests run the real queries against a small in-memory ES, so the routing
// filters (PER_DOC_FILTER / PER_BUNDLE_FILTER) are exercised, not mocked.

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

// ─── In-memory ES ─────────────────────────────────────────────────
// Covers the query DSL and aggregations the posture, executions-score and
// chain-depth paths issue: term/terms/exists/range/bool queries; filter,
// terms (field or the bundle-group script), composite, top_metrics and
// top_hits aggregations. Docs are flat (dotted keys). One composite page
// holds every bucket (no after_key), which ends paginateComposite.

type Doc = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const DAY = 86_400_000;

function matches(q: any, doc: Doc): boolean {
  if (q.term) {
    const [field, value] = Object.entries(q.term)[0];
    return asArray(doc[field]).includes(value);
  }
  if (q.terms) {
    const [field, values] = Object.entries(q.terms)[0] as [string, unknown[]];
    return asArray(doc[field]).some(v => values.includes(v));
  }
  if (q.exists) return doc[q.exists.field] !== undefined && doc[q.exists.field] !== null;
  if (q.range) {
    const [field, r] = Object.entries(q.range)[0] as [string, { gte?: string; lte?: string }];
    const t = Date.parse(String(doc[field]));
    if (!Number.isFinite(t)) return false;
    return (r.gte === undefined || t >= Date.parse(r.gte)) && (r.lte === undefined || t <= Date.parse(r.lte));
  }
  if (q.bool) {
    const b = q.bool;
    const required = [...asArray(b.filter), ...asArray(b.must)];
    if (!required.every((c: any) => matches(c, doc))) return false;
    if (asArray(b.must_not).some((c: any) => matches(c, doc))) return false;
    const should = asArray(b.should);
    if (should.length > 0) {
      const min = Number(b.minimum_should_match ?? (required.length > 0 ? 0 : 1));
      if (should.filter((c: any) => matches(c, doc)).length < min) return false;
    }
    return true;
  }
  throw new Error(`unsupported query: ${JSON.stringify(q)}`);
}

function runAggs(aggs: Record<string, any> | undefined, docs: Doc[]): Record<string, any> {
  return Object.fromEntries(Object.entries(aggs ?? {}).map(([name, def]) => [name, runAgg(def, docs)]));
}

const byTimeDesc = (a: Doc, b: Doc) => Date.parse(String(b['routing.event_time'])) - Date.parse(String(a['routing.event_time']));
// top_metrics reports booleans as "true"/"false" strings and a missing field as null.
const metricValue = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? String(v) : v);

function runAgg(def: any, docs: Doc[]): any {
  if (def.filter) {
    const sub = docs.filter(d => matches(def.filter, d));
    return { doc_count: sub.length, ...runAggs(def.aggs, sub) };
  }
  if (def.terms) {
    // Bucket per value (a multi-valued field puts a doc in several buckets); the script is BUNDLE_GROUP_SCRIPT.
    const keysOf = def.terms.script
      ? (d: Doc) => [`${d['f0rtika.bundle_id']}::${d['routing.hostname']}`]
      : (d: Doc) => asArray(d[def.terms.field]);
    const groups = new Map<unknown, Doc[]>();
    for (const d of docs) for (const k of keysOf(d)) groups.set(k, [...(groups.get(k) ?? []), d]);
    const buckets = [...groups]
      .map(([key, sub]) => ({ key, doc_count: sub.length, ...runAggs(def.aggs, sub) }))
      .sort((a, b) => b.doc_count - a.doc_count)
      .slice(0, def.terms.size ?? 10);
    return { buckets };
  }
  if (def.composite) {
    const sources: Record<string, any>[] = def.composite.sources;
    const keyOf = (d: Doc): Record<string, unknown> | null => {
      const key: Record<string, unknown> = {};
      for (const s of sources) {
        const [name, src] = Object.entries(s)[0] as [string, any];
        if (src.date_histogram) {
          key[name] = Math.floor(Date.parse(String(d[src.date_histogram.field])) / DAY) * DAY;
          continue;
        }
        const v = d[src.terms.field];
        if (v === undefined || v === null) {
          if (!src.terms.missing_bucket) return null;
          key[name] = null;
        } else {
          // A terms source on a date field keys by epoch ms.
          key[name] = src.terms.field === 'routing.event_time' ? Date.parse(String(v)) : v;
        }
      }
      return key;
    };
    const groups = new Map<string, { key: Record<string, unknown>; docs: Doc[] }>();
    for (const d of docs) {
      const key = keyOf(d);
      if (!key) continue;
      const id = JSON.stringify(key);
      const g = groups.get(id) ?? { key, docs: [] };
      g.docs.push(d);
      groups.set(id, g);
    }
    return { buckets: [...groups.values()].map(g => ({ key: g.key, doc_count: g.docs.length, ...runAggs(def.aggs, g.docs) })) };
  }
  if (def.top_metrics) {
    const top = [...docs].sort(byTimeDesc)[0];
    if (!top) return { top: [] };
    const metrics = Object.fromEntries(def.top_metrics.metrics.map((m: { field: string }) => [m.field, metricValue(top[m.field])]));
    return { top: [{ sort: [top['routing.event_time']], metrics }] };
  }
  if (def.top_hits) {
    const hits = [...docs].sort(byTimeDesc).slice(0, def.top_hits.size).map(d => ({ _source: d }));
    return { hits: { hits } };
  }
  throw new Error(`unsupported aggregation: ${JSON.stringify(def)}`);
}

function useIndex(docs: Doc[]) {
  mockSearch.mockImplementation(async (req: any) => {
    const hits = docs.filter(d => matches(req.query, d));
    return { hits: { total: { value: hits.length, relation: 'eq' }, hits: [] }, aggregations: runAggs(req.aggs, hits) };
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────
const LOCKBIT = 'c3f1a2b4-0000-4000-8000-000000000001';
const LOCKBIT_NAME = 'LockBit 3.0 Double Extortion';
const STANDALONE = 'd4e5f6a7-0000-4000-8000-000000000002';

function base(at: string, host = 'h1'): Doc {
  return {
    'routing.oid': 'org-a',
    'routing.hostname': host,
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
  };
}

/** One stage doc of a real LockBit run (fan-out from bundle_results.json). */
function stage(at: string, n: number, code: number, host = 'h1'): Doc {
  return {
    ...base(at, host),
    'f0rtika.test_uuid': `${LOCKBIT}::LB-00${n}`,
    'f0rtika.test_name': `${LOCKBIT_NAME} - Stage ${n}`,
    'f0rtika.bundle_id': LOCKBIT,
    'f0rtika.bundle_name': LOCKBIT_NAME,
    'f0rtika.is_bundle_control': true,
    'f0rtika.control_id': `LB-00${n}`,
    'f0rtika.control_validator': `Stage ${n}`,
    'f0rtika.techniques': ['T1486'],
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126 || code === 105 || code === 127,
  };
}

/** A real LockBit run: three stages sharing one event_time. */
function realRun(at: string, codes: [number, number, number] = [101, 101, 101], host = 'h1'): Doc[] {
  return codes.map((c, i) => stage(at, i + 1, c, host));
}

/** The kill doc the reconciliation pass writes (Task 2/3 shape). */
function killDoc(at: string, opts: { bundle: boolean; host?: string } = { bundle: true }): Doc {
  return {
    ...base(at, opts.host),
    'f0rtika.test_uuid': opts.bundle ? LOCKBIT : STANDALONE,
    'f0rtika.test_name': opts.bundle ? LOCKBIT_NAME : 'Standalone Credential Dump',
    ...(opts.bundle ? { 'f0rtika.bundle_id': LOCKBIT, 'f0rtika.bundle_name': LOCKBIT_NAME } : {}),
    'f0rtika.techniques': ['T1486'],
    'event.ERROR': 126,
    'f0rtika.error_name': 'ExecutionPrevented',
    'f0rtika.is_protected': true,
    'f0rtika.edr_terminated': true,
    'f0rtika.stages_unknown': true,
    'f0rtika.edr_terminated_vendors': ['sentinelone'],
    'f0rtika.edr_terminated_alert_ids': ['s1-alert-1'],
  };
}

function standaloneDoc(at: string, code: number, host = 'h1'): Doc {
  return {
    ...base(at, host),
    'f0rtika.test_uuid': 'e0e0e0e0-0000-4000-8000-000000000003',
    'f0rtika.test_name': 'Standalone Discovery',
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126,
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
const LATEST: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z', basis: 'latest', scoringMode: 'any-stage' };
const T0 = '2025-01-10T09:00:00Z';
const T1 = '2025-01-20T09:00:00Z';

describe('EDR-killed runs in Defense Score scoring', () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  describe('per-doc / per-bundle routing', () => {
    const svc = createService() as any;
    const route = (doc: Doc) => ({
      perDoc: matches(svc.PER_DOC_FILTER, doc),
      perBundle: matches(svc.PER_BUNDLE_FILTER, doc),
    });

    it('PER_BUNDLE_FILTER routes a bundle kill doc into the bundle pair', () => {
      expect(route(killDoc(T0))).toEqual({ perDoc: false, perBundle: true });
    });

    it('a standalone kill doc and every other doc keep their routing', () => {
      expect(route(killDoc(T0, { bundle: false }))).toEqual({ perDoc: true, perBundle: false });
      expect(route(stage(T0, 1, 101))).toEqual({ perDoc: false, perBundle: true });
      expect(route(standaloneDoc(T0, 101))).toEqual({ perDoc: true, perBundle: false });
      const hygiene = { ...stage(T0, 1, 126), 'f0rtika.category': 'cyber-hygiene' };
      expect(route(hygiene)).toEqual({ perDoc: true, perBundle: false });
    });
  });

  describe('basis=latest, any-stage', () => {
    it('a kill run is the latest run of its bundle pair', async () => {
      useIndex([...realRun(T0), killDoc(T1)]);
      const res = await createService().getDefenseScoreLatest(LATEST);
      expect(res.pairCount).toBe(1);
      expect(res.score).toBe(100);
      expect(res.protectedCount).toBe(1);
    });

    it('a newer real bundle run replaces the kill run in the latest pair', async () => {
      useIndex([killDoc(T0), ...realRun(T1)]);
      const res = await createService().getDefenseScoreLatest(LATEST);
      expect(res.pairCount).toBe(1);
      expect(res.score).toBe(0);
    });

    it('the kill run joins the pair keyed by the bundle, on its own host only', async () => {
      useIndex([...realRun(T0, [101, 101, 101], 'h2'), killDoc(T1)]);
      const pairs = await createService().getLatestPairs(LATEST);
      expect(pairs.map(p => [p.pairKey, p.protected, p.testName]).sort()).toEqual([
        [`org-a|bundle:${LOCKBIT}|h1`, true, LOCKBIT_NAME],
        [`org-a|bundle:${LOCKBIT}|h2`, false, LOCKBIT_NAME],
      ]);
    });

    it('a standalone kill doc is a per-doc pair', async () => {
      useIndex([killDoc(T1, { bundle: false }), standaloneDoc(T0, 101)]);
      const pairs = await createService().getLatestPairs(LATEST);
      expect(pairs.map(p => [p.pairKey, p.protected]).sort()).toEqual([
        [`org-a|${STANDALONE}|h1`, true],
        ['org-a|e0e0e0e0-0000-4000-8000-000000000003|h1', false],
      ]);
      const res = await createService().getDefenseScoreLatest(LATEST);
      expect([res.pairCount, res.score]).toEqual([2, 50]);
    });
  });

  describe('basis=executions', () => {
    it('executions basis counts the kill doc as protected', async () => {
      useIndex([killDoc(T1, { bundle: false }), standaloneDoc(T0, 101)]);
      const res = await createService().getDefenseScore({ from: LATEST.from, to: LATEST.to });
      expect(res).toMatchObject({ totalExecutions: 2, protectedCount: 1, score: 50 });
    });

    it('any-stage executions count a bundle kill doc once, as a protected bundle unit', async () => {
      useIndex([killDoc(T1), standaloneDoc(T0, 101)]);
      const res = await createService().getDefenseScore({ from: LATEST.from, to: LATEST.to, scoringMode: 'any-stage' });
      expect(res).toMatchObject({ totalExecutions: 2, protectedCount: 1, score: 50 });
    });
  });

  describe('chain depth', () => {
    const emptyBuckets = [1, 2, 3, 4].map(stage => ({ stage, blocked: 0, alertedNotBlocked: 0, bundleNames: [] }));

    it('chain depth reports a kill run as agentTerminated, not a stage', async () => {
      useIndex([...realRun(T0), killDoc(T1)]);
      const res = await createService().getChainDepth(LATEST);
      expect(res.buckets).toEqual(emptyBuckets);
      expect(res.chains).toBe(1);
      expect(res.endToEnd).toBe(0);
      expect(res.agentTerminated).toBe(1);
      expect(res.agentTerminatedBundleNames).toEqual([LOCKBIT_NAME]);
    });

    it('a newer real run that is blocked at stage 2 replaces the kill run', async () => {
      useIndex([killDoc(T0), ...realRun(T1, [101, 126, 101])]);
      const res = await createService().getChainDepth(LATEST);
      expect(res.buckets[1]).toEqual({ stage: 2, blocked: 1, alertedNotBlocked: 0, bundleNames: [LOCKBIT_NAME] });
      expect(res.agentTerminated).toBe(0);
      expect(res.agentTerminatedBundleNames).toEqual([]);
    });

    it('a kill run after an errored run is settled, not inconclusive', async () => {
      // 126 is a settled chain code, so the kill doc can never make its run inconclusive.
      useIndex([...realRun(T0, [101, 999, 0]), killDoc(T1)]);
      const res = await createService().getChainDepth(LATEST);
      expect(res).toMatchObject({ chains: 1, agentTerminated: 1, inconclusive: 0, stageErrors: 0 });
    });

    it('a standalone kill doc is not a chain', async () => {
      useIndex([killDoc(T1, { bundle: false })]);
      const res = await createService().getChainDepth(LATEST);
      expect(res).toMatchObject({ chains: 0, agentTerminated: 0, agentTerminatedBundleNames: [] });
    });
  });
});
