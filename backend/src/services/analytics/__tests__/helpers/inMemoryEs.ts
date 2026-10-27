// Small in-memory Elasticsearch evaluator shared by analytics tests: runs the real query bodies.

// ─── In-memory ES ─────────────────────────────────────────────────
// Covers the query DSL and aggregations the posture, executions-score and
// chain-depth paths issue: term/terms/exists/range/bool queries; filter,
// terms (field or the bundle-group script), composite, top_metrics and
// top_hits aggregations. Docs are flat (dotted keys). One composite page
// holds every bucket (no after_key), which ends paginateComposite.

export type Doc = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const DAY = 86_400_000;

export function matches(q: any, doc: Doc): boolean {
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

export function useIndex(mockSearch: { mockImplementation: (fn: (req: any) => Promise<unknown>) => unknown }, docs: Doc[]) {
  mockSearch.mockImplementation(async (req: any) => {
    const hits = docs.filter(d => matches(req.query, d));
    return { hits: { total: { value: hits.length, relation: 'eq' }, hits: [] }, aggregations: runAggs(req.aggs, hits) };
  });
}

