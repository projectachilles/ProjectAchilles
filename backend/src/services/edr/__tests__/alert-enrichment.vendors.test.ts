import { describe, it, expect, vi, beforeEach } from 'vitest';

// The evidence-correlation pass is shared by every endpoint-EDR integration
// (edr/alert-enrichment.service.ts). These cases run once per vendor, so a
// change made for one vendor can't silently break another.

const { CrowdStrikeEnrichmentService } = await import('../../crowdstrike/enrichment.service.js');
const { SentinelOneEnrichmentService } = await import('../../sentinelone/enrichment.service.js');
const { SophosEnrichmentService } = await import('../../sophos/enrichment.service.js');
const { DefenderEnrichmentService } = await import('../../defender/enrichment.service.js');

const VENDORS = [
  { name: 'Defender', prefix: 'defender', index: 'achilles-defender', make: (c: any) => new DefenderEnrichmentService(c, 'achilles-results-*') },
  { name: 'CrowdStrike', prefix: 'crowdstrike', index: 'achilles-crowdstrike', make: (c: any) => new CrowdStrikeEnrichmentService(c, 'achilles-results-*') },
  { name: 'SentinelOne', prefix: 'sentinelone', index: 'achilles-sentinelone', make: (c: any) => new SentinelOneEnrichmentService(c, 'achilles-results-*') },
  { name: 'Sophos', prefix: 'sophos', index: 'achilles-sophos', make: (c: any) => new SophosEnrichmentService(c, 'achilles-results-*') },
] as const;

const resultDoc = (exit: number) => ({
  _id: 'r1',
  _index: 'achilles-results-org',
  _source: {
    f0rtika: { test_uuid: 'b1::T1003', control_id: 'T1003' },
    routing: { event_time: '2026-10-20T10:00:00Z', hostname: 'win-host-01' },
    event: { ERROR: exit },
  },
  sort: ['2026-10-20T10:00:00Z'],
});
const hits = (action?: string) => ({ hits: { total: { value: 1 }, hits: [{ _id: 'alert-1', _source: action ? { prevention_action: action } : {} }] } });
const none = { hits: { total: { value: 0 }, hits: [] } };

describe.each(VENDORS)('EDR alert enrichment — $name', ({ prefix, index, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk };
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [{ update: {} }, { update: {} }] });
  });

  it(`reads ${index} and looks for docs missing ${prefix}_* flags`, async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await make(client).runEnrichmentPass();
    const q = JSON.stringify(search.mock.calls[0][0].query);
    expect(q).toContain(`f0rtika.${prefix}_detected`);
    expect(q).toContain(`f0rtika.${prefix}_stage_detected`);
    for (const other of VENDORS.filter((v) => v.prefix !== prefix)) expect(q).not.toContain(`${other.prefix}_`);
  });

  it('does not scan edr_terminated or edr_launch_blocked docs', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await make(client).runEnrichmentPass();
    const q = JSON.stringify(search.mock.calls[0][0].query);
    expect(q).toContain('{"bool":{"must_not":[{"term":{"f0rtika.edr_terminated":true}},{"term":{"f0rtika.edr_launch_blocked":true}}]}}');
  });

  it('a stage match with a confirmed action writes detected + stage + prevented flags, and correlates the alert', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('quarantined'), hits('quarantined')] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(msearch.mock.calls[0][0].searches[0]).toEqual({ index });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'quarantined',
      [`${prefix}_stage_prevented`]: true,
      [`${prefix}_stage_rule`]: 'single_test',
      [`${prefix}_evidence_rule`]: 'file_verdict',
      [`${prefix}_prevention_rule`]: 'in_run',
    });
    expect(ops[2]).toEqual({ update: { _index: index, _id: 'alert-1' } });
    expect(ops[3].doc.f0rtika).toMatchObject({ achilles_correlated: true, achilles_test_uuid: 'b1' });
  });

  it('a bundle-wide match never credits prevention to a stage that ran to completion (101)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(101)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('process_killed'), none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags).toEqual({ [`${prefix}_detected`]: true, [`${prefix}_evidence_rule`]: 'file_verdict' });
  });

  it('re-checks stages detected in the last 72 h without stage-own prevention, and stages never evaluated for it', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await make(client).runEnrichmentPass();
    const q = search.mock.calls[0][0].query;
    const should = q.bool.filter[q.bool.filter.length - 1].bool.should;
    expect(should).toHaveLength(7);
    expect(should[2]).toEqual({
      bool: {
        filter: [
          { term: { [`f0rtika.${prefix}_stage_detected`]: true } },
          { range: { 'routing.event_time': { gte: 'now-72h' } } },
        ],
        must_not: [{ term: { [`f0rtika.${prefix}_stage_prevented`]: true } }],
      },
    });
    expect(should[3]).toEqual({
      bool: {
        filter: [{ term: { [`f0rtika.${prefix}_detected`]: true } }],
        must_not: [{ term: { [`f0rtika.${prefix}_evidence_rule`]: 'file_verdict' } }],
      },
    });
    // In-run prevention rules: a doc prevented before them is checked once.
    expect(should[4]).toEqual({
      bool: {
        should: [
          { term: { [`f0rtika.${prefix}_prevented`]: true } },
          { term: { [`f0rtika.${prefix}_stage_prevented`]: true } },
        ],
        minimum_should_match: 1,
        must_not: [{ term: { [`f0rtika.${prefix}_prevention_rule`]: 'in_run' } }],
      },
    });
    expect(should[6]).toEqual({
      bool: {
        filter: [{ term: { [`f0rtika.${prefix}_stage_detected`]: true } }],
        must_not: [{ exists: { field: `f0rtika.${prefix}_stage_prevented` } }],
      },
    });
  });

  it('msearch reads alert correlation and aggregates every matching alert\'s action', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [none, none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const body = msearch.mock.calls[0][0].searches[1];
    expect(body._source[0]).toBe('prevention_action');
    expect(body._source).toContain('f0rtika.achilles_correlated');
    expect(body._source).not.toContain('created_at');
    expect(body._source).not.toContain('last_activity_at');
    const agg = body.aggs.prevention;
    expect(agg.aggs.actions.terms.field).toBe('prevention_action');
    if (prefix !== 'sentinelone') expect(agg.filter).toEqual({ match_all: {} });
    // Only SentinelOne has automatic mitigation; its own kills never count.
    expect(JSON.stringify(agg.filter).includes('auto_mitigated')).toBe(prefix === 'sentinelone');
  });

  it('finds an action beyond the hits returned (aggregation over every matching alert)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    // More alerts matched (150) than a stage query reads: the aggregation fills in.
    const withAgg = { hits: { total: { value: 150 }, hits: [{ _id: 'alert-1', _source: {} }] }, aggregations: { prevention: { actions: { buckets: [{ key: 'process_killed', doc_count: 1 }, { key: 'kill_failed', doc_count: 1 }] } } } };
    msearch.mockResolvedValueOnce({ responses: [hits(), withAgg] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags).toMatchObject({ [`${prefix}_stage_prevented`]: true, [`${prefix}_prevention_action`]: 'process_killed' });
  });

  it('a wide-only action on an error stage is prevention, but not the stage\'s own (stage_prevented false)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('process_killed'), hits()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'process_killed',
      [`${prefix}_stage_prevented`]: false,
      [`${prefix}_stage_rule`]: 'single_test',
      [`${prefix}_evidence_rule`]: 'file_verdict',
      [`${prefix}_prevention_rule`]: 'in_run',
    });
  });

  it('prefers the stage alert\'s action over a wide one', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('blocked'), hits('quarantined')] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika[`${prefix}_prevention_action`]).toBe('quarantined');
  });

  it('kill_failed is detection, never prevention', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('kill_failed'), hits('kill_failed')] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags[`${prefix}_prevented`]).toBeUndefined();
    expect(flags[`${prefix}_stage_detected`]).toBe(true);
  });
});

// Credit by run (edr/runEvidence.ts) is Defender-only: the other vendors'
// alerts carry no per-item evidence, so their sub-queries never ask for it.
describe.each(VENDORS.filter((v) => v.prefix !== 'defender'))('EDR alert enrichment — $name never reads evidence_items', ({ prefix, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const putMapping = vi.fn().mockResolvedValue({ acknowledged: true });
  const client = { search, msearch, bulk, indices: { putMapping } };
  beforeEach(() => vi.clearAllMocks());

  it('the alert sub-queries\' _source has no evidence_items', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [none, none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const bodies = (msearch.mock.calls[0][0].searches as any[]).filter((_, i) => i % 2 === 1);
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(b._source).not.toContain('evidence_items');
  });

  it('the other three EDRs never send a span clause or the alert_time aggregation', async () => {
    const doc = resultDoc(999);
    const withRunStart = { ...doc, _source: { ...doc._source, routing: { ...doc._source.routing, run_started_at: '2026-10-20T09:58:50Z' } } };
    search.mockResolvedValueOnce({ hits: { hits: [withRunStart] } });
    msearch.mockResolvedValueOnce({ responses: [none, none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const bodies = (msearch.mock.calls[0][0].searches as any[]).filter((_, i) => i % 2 === 1);
    expect(bodies).toHaveLength(2);
    for (const b of bodies) {
      expect(JSON.stringify(b)).not.toContain('activity_span');
      expect(JSON.stringify(b)).not.toContain('alert_time');
      expect(Object.keys(b.aggs)).toEqual(['prevention']);
      expect(b.aggs.prevention.aggs.actions.terms.field).toBe('prevention_action');
    }
  });

  it('the other three EDRs never write a no_run_evidence note, never put its mapping, and return noRunEvidenceDocs: []', async () => {
    // The Defender situation exactly: a fresh, stopped stage with a run start
    // whose alerts carry only other-run items and the alert times.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T11:00:00.000Z'));
    try {
      const doc = resultDoc(999);
      const withRunStart = { ...doc, _source: { ...doc._source, routing: { ...doc._source.routing, run_started_at: '2026-10-20T09:58:50Z' } } };
      const earlier = {
        file: 'b1-t1003.exe', path: 'c:\\f0', parent: null, parent_path: null, kind: 'process', verdict: 'suspicious',
        action: null, started_at: '2026-10-14T09:06:46Z', added_at: '2026-10-14T09:08:16Z',
      };
      const alert = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: 'alert-1',
            matched_queries: ['activity_span'],
            _source: {
              evidence_filenames: ['b1-t1003.exe'], evidence_items: [earlier], timestamp: '2026-10-20T09:51:00Z',
              first_activity_at: '2026-10-14T09:06:00Z', last_activity_at: '2026-10-20T09:41:00Z',
            },
          }],
        },
      };
      search.mockResolvedValueOnce({ hits: { hits: [withRunStart] } });
      msearch.mockResolvedValueOnce({ responses: [alert, alert] });
      bulk.mockResolvedValue({ items: [{ update: { result: 'updated' } }, { update: { result: 'updated' } }, { update: { result: 'updated' } }] });
      const result = await make(client).runEnrichmentPass({ batchSize: 200 });
      const ops = (bulk.mock.calls[0]?.[0].operations ?? []) as any[];
      expect(JSON.stringify(ops)).not.toContain('no_run_evidence');
      expect(result.noRunEvidenceDocs).toEqual([]);
      // Nor do they put the note's mapping.
      expect(putMapping).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('their alert sub-queries\' _source lists are unchanged', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [none, none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const bodies = (msearch.mock.calls[0][0].searches as any[]).filter((_, i) => i % 2 === 1);
    const evidence = ['evidence_filenames', 'evidence_filepaths', 'evidence_file_verdicts', 'evidence_child_actions'];
    const expected = prefix === 'sentinelone'
      ? ['prevention_action', 'f0rtika.auto_mitigated', 'f0rtika.auto_mitigation_mode', 'f0rtika.auto_mitigation_error', 'f0rtika.achilles_correlated', ...evidence]
      : ['prevention_action', 'f0rtika.achilles_correlated', ...evidence];
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(b._source).toEqual(expected);
  });
});

// Late prevention: an EDR often attaches its action after the alert was first
// matched (Defender's remediation status, SentinelOne's mitigation report,
// Sophos' remedy event). A stage already flagged detected is re-checked, and
// gets only the flags it lacks.
describe.each(VENDORS)('EDR alert enrichment — $name late prevention and provenance', ({ prefix, index, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk };
  const flagged = (extra: Record<string, unknown> = {}) => {
    const d = resultDoc(999);
    // Stages already evaluated under the single-test, per-file and in-run rules (their own describes cover older ones).
    return { ...d, _source: { ...d._source, f0rtika: { ...d._source.f0rtika, [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, [`${prefix}_stage_rule`]: 'single_test', [`${prefix}_evidence_rule`]: 'file_verdict', [`${prefix}_prevention_rule`]: 'in_run', ...extra } } };
  };
  const alertHit = (source: Record<string, unknown>) => ({ hits: { total: { value: 1 }, hits: [{ _id: 'alert-1', _source: source }] } });
  const correlated = { f0rtika: { achilles_correlated: true } };
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [{ update: {} }, { update: {} }] });
  });

  it('a late stage action writes only the prevention flags', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged({ [`${prefix}_stage_prevented`]: false })] } });
    const alert = alertHit({ prevention_action: 'quarantined', ...correlated });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    const result = await make(client).runEnrichmentPass({ batchSize: 200 });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops).toHaveLength(2);
    expect(ops[1].doc.f0rtika).toEqual({
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'quarantined',
      [`${prefix}_stage_prevented`]: true,
    });
    expect(result).toMatchObject({ detected: 0, stageDetected: 0, alertsMarkedCorrelated: 0 });
  });

  it('a stage already prevented by a wide alert takes the stage\'s own late action', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged({ [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked', [`${prefix}_stage_prevented`]: false })] } });
    msearch.mockResolvedValueOnce({ responses: [alertHit({ prevention_action: 'blocked', ...correlated }), alertHit({ prevention_action: 'process_killed', ...correlated })] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_prevention_action`]: 'process_killed',
      [`${prefix}_stage_prevented`]: true,
    });
  });

  it('a stage flagged before provenance existed gets stage_prevented from its own alerts', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged({ [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'quarantined' })] } });
    msearch.mockResolvedValueOnce({ responses: [alertHit({ prevention_action: 'quarantined', ...correlated }), alertHit(correlated)] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({ [`${prefix}_stage_prevented`]: false });
  });

  it('settles an older stage with no action as not prevented when its stage alerts no longer match', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged()] } });
    msearch.mockResolvedValueOnce({ responses: [none, none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops).toEqual([{ update: { _index: 'achilles-results-org', _id: 'r1' } }, { doc: { f0rtika: { [`${prefix}_stage_prevented`]: false } } }]);
  });

  it('keeps an older stage\'s action (no downgrade) when its stage alerts no longer match', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged({ [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'quarantined' })] } });
    msearch.mockResolvedValueOnce({ responses: [alertHit(correlated), none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk).not.toHaveBeenCalled();
  });

  it('re-checking a stage with nothing new writes nothing (idempotent)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged({ [`${prefix}_stage_prevented`]: false })] } });
    const alert = alertHit(correlated);
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk).not.toHaveBeenCalled();
  });

  it('a re-checked doc correlates a matching alert that is not correlated yet', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flagged({ [`${prefix}_stage_prevented`]: false })] } });
    const alert = alertHit({});
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ update: { _index: index, _id: 'alert-1' } });
    expect(ops[1].doc.f0rtika).toMatchObject({ achilles_correlated: true, achilles_test_uuid: 'b1' });
  });

  it('a new doc is still flagged in full, and its alert correlated even when already correlated (unchanged rule)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    const alert = alertHit({ prevention_action: 'blocked', ...correlated });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'blocked',
      [`${prefix}_stage_prevented`]: true,
      [`${prefix}_stage_rule`]: 'single_test',
      [`${prefix}_evidence_rule`]: 'file_verdict',
      [`${prefix}_prevention_rule`]: 'in_run',
    });
    expect(ops[2]).toEqual({ update: { _index: index, _id: 'alert-1' } });
  });
});

// Multi-test alerts: evidence naming binaries of 2+ different Achilles tests
// (Defender's "A suspicious file was observed" lists leftover binaries of
// several tests on the disk). Without per-file verdicts: no evidence at any
// level (per-file verdicts: the describe below).
describe.each(VENDORS)('EDR alert enrichment — $name multi-test alerts', ({ prefix, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk };
  const MULTI = { evidence_filenames: ['298cc137-ea39-4cf0-9b2d-b1c59a3cbacb-t1486.exe', '26a8b54e-0000-4000-8000-000000000001.exe', 'powershell.exe'] };
  const agg = (extra: Record<string, unknown> = {}) => ({ _id: 'agg-1', _source: { ...MULTI, ...extra } });
  const single = (extra: Record<string, unknown> = {}) => ({ _id: 'one-1', _source: { evidence_filenames: ['298cc137-ea39-4cf0-9b2d-b1c59a3cbacb-t1486.exe'], ...extra } });
  const page = (...h: unknown[]) => ({ hits: { total: { value: h.length }, hits: h } });
  const flaggedDoc = (exit: number, extra: Record<string, unknown> = {}) => {
    const d = resultDoc(exit);
    // Already evaluated at test level and under the in-run rules (their own describes cover those re-checks).
    return { ...d, _source: { ...d._source, f0rtika: { ...d._source.f0rtika, [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, [`${prefix}_stage_prevented`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked', [`${prefix}_evidence_rule`]: 'file_verdict', [`${prefix}_prevention_rule`]: 'in_run', ...extra } } };
  };
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [{ update: {} }, { update: {} }, { update: {} }] });
  });

  it('a multi-test alert without per-file verdicts is no evidence at any level, but is still correlated', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [page(agg({ prevention_action: 'blocked' })), page(agg({ prevention_action: 'blocked' }))] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const ops = bulk.mock.calls[0][0].operations;
    // Only the alert-side link (auto-resolve still closes it as security testing).
    expect(ops).toHaveLength(2);
    expect(ops[0].update._id).toBe('agg-1');
    expect(ops[1].doc.f0rtika).toMatchObject({ achilles_correlated: true });
  });

  it('a single-test alert next to a multi-test one is stage evidence (its own action only)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(101)] } });
    msearch.mockResolvedValueOnce({ responses: [page(single()), page(agg({ prevention_action: 'blocked' }), single())] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_stage_prevented`]: false,
      [`${prefix}_stage_rule`]: 'single_test',
      [`${prefix}_evidence_rule`]: 'file_verdict',
    });
  });

  it('re-checks a stage stored under the old rule once', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await make(client).runEnrichmentPass();
    const q = search.mock.calls[0][0].query;
    const should = q.bool.filter[q.bool.filter.length - 1].bool.should;
    expect(should).toContainEqual({
      bool: {
        filter: [{ term: { [`f0rtika.${prefix}_stage_detected`]: true } }],
        must_not: [{ term: { [`f0rtika.${prefix}_stage_rule`]: 'single_test' } }],
      },
    });
  });

  it('a stored stage whose only stage alerts are multi-test loses its stage flags; exit 101 also loses _prevented', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flaggedDoc(101)] } });
    msearch.mockResolvedValueOnce({ responses: [page(agg({ f0rtika: { achilles_correlated: true } })), page(agg({ f0rtika: { achilles_correlated: true } }))] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_stage_detected`]: false,
      [`${prefix}_stage_prevented`]: false,
      [`${prefix}_prevented`]: false,
      [`${prefix}_prevention_action`]: null,
      [`${prefix}_stage_rule`]: 'single_test',
    });
  });

  it('an error-coded stage keeps _prevented (it may come from the test-level match)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flaggedDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [page(agg({ f0rtika: { achilles_correlated: true } })), page(agg({ f0rtika: { achilles_correlated: true } }))] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_stage_detected`]: false,
      [`${prefix}_stage_prevented`]: false,
      [`${prefix}_stage_rule`]: 'single_test',
    });
  });

  it('never downgrades a stored stage whose stage alerts are gone (aged out): it is only marked checked', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flaggedDoc(101)] } });
    msearch.mockResolvedValueOnce({ responses: [page(), page()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({ [`${prefix}_stage_rule`]: 'single_test' });
  });

  it('a stage already checked under this rule is left alone', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [flaggedDoc(101, { [`${prefix}_stage_rule`]: 'single_test' })] } });
    msearch.mockResolvedValueOnce({ responses: [page(), page()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk).not.toHaveBeenCalled();
  });
});

// Per-file verdicts (edr/multiTestEvidence.ts): the vendor's verdict on each
// evidence file decides what a multi-test alert proves. Live case (Nov 2026):
// one antivirus alert named a Qilin stage (malicious, blocked) and a Kothamine
// stage (malicious, still active); the alert-wide action was "process killed".
describe.each(VENDORS)('EDR alert enrichment — $name per-file verdicts', ({ prefix, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk };
  const QILIN = '8f68dda1-94be-430f-8f35-d8af3f9b5d2e';
  const KOTH = 'c37d6a01-3934-4e72-9cb1-3dae284b937b';
  const doc = (uuid: string, control: string, f0: Record<string, unknown> = {}, exit = 126) => ({
    _id: 'r1',
    _index: 'achilles-results-org',
    _source: {
      f0rtika: { test_uuid: `${uuid}::${control}`, control_id: control, ...f0 },
      routing: { event_time: '2026-11-05T19:55:00Z', hostname: 'win-host-01' },
      event: { ERROR: exit },
    },
    sort: ['2026-11-05T19:55:00Z'],
  });
  const av = {
    _id: 'av-1',
    _source: {
      prevention_action: 'process_killed',
      evidence_filenames: [`${QILIN}-t1518.001.exe`, `${KOTH}-t1572.exe`],
      evidence_file_verdicts: [
        { file: `${QILIN}-t1518.001.exe`, verdict: 'malicious', action: 'process_killed' },
        { file: `${KOTH}-t1572.exe`, verdict: 'malicious', action: null },
      ],
    },
  };
  const listing = {
    _id: 'list-1',
    _source: {
      evidence_filenames: [`${QILIN}-t1518.001.exe`, `${KOTH}-t1572.exe`, 'achilles-agent.exe', 'powershell.exe'],
      evidence_file_verdicts: [
        { file: `${QILIN}-t1518.001.exe`, verdict: 'suspicious', action: null },
        { file: `${KOTH}-t1572.exe`, verdict: 'suspicious', action: null },
        { file: 'achilles-agent.exe', verdict: 'suspicious', action: null },
      ],
    },
  };
  const page = (...h: unknown[]) => ({ hits: { total: { value: h.length }, hits: h } });
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [{ update: {} }, { update: {} }, { update: {} }] });
  });

  it('credits the stage whose own file the vendor blocked, with that file\'s action', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1518.001')] } });
    msearch.mockResolvedValueOnce({ responses: [page(av), page(av)] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'process_killed',
      [`${prefix}_stage_prevented`]: true,
      [`${prefix}_stage_rule`]: 'single_test',
      [`${prefix}_evidence_rule`]: 'file_verdict',
      [`${prefix}_prevention_rule`]: 'in_run',
    });
  });

  it('a file the vendor only detected is detection, never the alert-wide prevention', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(KOTH, 'T1572', {}, 999)] } });
    msearch.mockResolvedValueOnce({ responses: [page(av), page(av)] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_stage_prevented`]: false,
      [`${prefix}_stage_rule`]: 'single_test',
      [`${prefix}_evidence_rule`]: 'file_verdict',
    });
  });

  it('a listing that marks every file suspicious is no evidence for any stage of either test', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1518.001')] } });
    msearch.mockResolvedValueOnce({ responses: [page(listing), page(listing)] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops).toHaveLength(2);
    expect(ops[0].update._id).toBe('list-1');
  });

  it('another stage of the same test gets nothing from a file it does not own', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1055')] } });
    // Wide query sees the alert (a Qilin file is marked); the T1055 stage query does not match it.
    msearch.mockResolvedValueOnce({ responses: [page(av), page()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    // Exit 126 is conclusive: the wide match is detection, never this stage's prevention.
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_evidence_rule`]: 'file_verdict',
    });
  });

  it('a doc detected only through listings loses _detected and its prevention once', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1055', { [`${prefix}_detected`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked' }, 999)] } });
    msearch.mockResolvedValueOnce({ responses: [page(listing), page()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: false,
      [`${prefix}_prevented`]: false,
      [`${prefix}_prevention_action`]: null,
      [`${prefix}_evidence_rule`]: 'file_verdict',
      [`${prefix}_prevention_rule`]: 'in_run',
    });
  });

  // Off a run re-check (every vendor here; Defender without crediting by run)
  // a failed sub-query holds nothing back: the kind that answered is judged
  // from its own answer, and its one-time check is consumed as before.
  it('a failed stage sub-query: the test-level check is still judged from the wide answer', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1055', { [`${prefix}_detected`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked' }, 999)] } });
    const failed = { error: { type: 'search_phase_execution_exception', reason: 'shard failure' } };
    msearch.mockResolvedValueOnce({ responses: [page(listing), failed] });
    const result = await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: false,
      [`${prefix}_prevented`]: false,
      [`${prefix}_prevention_action`]: null,
      [`${prefix}_evidence_rule`]: 'file_verdict',
      [`${prefix}_prevention_rule`]: 'in_run',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^msearch\[1\/stage\]: /);
  });

  it('keeps _detected when one alert still counts for the test', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1055', { [`${prefix}_detected`]: true }, 999)] } });
    msearch.mockResolvedValueOnce({ responses: [page(listing, av), page()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags[`${prefix}_detected`]).toBeUndefined();
    expect(flags[`${prefix}_evidence_rule`]).toBe('file_verdict');
  });

  it('never downgrades a detected doc whose alerts are gone (aged out): it is only marked checked', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1055', { [`${prefix}_detected`]: true, [`${prefix}_prevented`]: true }, 999)] } });
    msearch.mockResolvedValueOnce({ responses: [page(), page()] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({ [`${prefix}_evidence_rule`]: 'file_verdict', [`${prefix}_prevention_rule`]: 'in_run' });
  });

  it('a stage removed under the single-test rule gets its credit back once the vendor marks its file', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc(QILIN, 'T1518.001', {
      [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: false, [`${prefix}_stage_prevented`]: false, [`${prefix}_stage_rule`]: 'single_test', [`${prefix}_evidence_rule`]: 'file_verdict',
    })] } });
    msearch.mockResolvedValueOnce({ responses: [page(av), page(av)] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'process_killed',
      [`${prefix}_stage_prevented`]: true,
      [`${prefix}_prevention_rule`]: 'in_run',
    });
  });
});

// Completed stages and a stage's own actions (multiTestEvidence.ts ownActions).
// A result that exited 101 ran to completion: an EDR action on it (often taken
// after the stage had finished) is detection, never prevention. Live, Nov 2026:
// 19 of 34 exit-101 stages shown Prevented had been blocked after they
// finished, or took a sibling stage's block from a single-test alert.
describe.each(VENDORS)('EDR alert enrichment — $name completed stages', ({ prefix, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk };
  // resultDoc's run ended 2026-10-20T10:00:00Z.
  const LATE = '2026-10-20T10:08:00Z';
  const IN_RUN = '2026-10-20T10:01:00Z';
  const one = (source: Record<string, unknown>) => ({ hits: { total: { value: 1 }, hits: [{ _id: 'alert-1', _source: { f0rtika: { achilles_correlated: true }, ...source } }] } });
  const evaluated = { [`${prefix}_stage_rule`]: 'single_test', [`${prefix}_evidence_rule`]: 'file_verdict' };
  const stored = (exit: number, f0: Record<string, unknown>) => {
    const d = resultDoc(exit);
    return { ...d, _source: { ...d._source, f0rtika: { ...d._source.f0rtika, [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, ...evaluated, ...f0 } } };
  };
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [{ update: {} }, { update: {} }] });
  });

  it('an action on a stage that ran to completion (101) is detection, not prevention', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(101)] } });
    const alert = one({ prevention_action: 'blocked' });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_stage_prevented`]: false,
      ...evaluated,
    });
  });

  // Shaped like the live alert behind this rule: the vendor marks the stage's own
  // binary malicious and killed, and lists a kill under another binary of the bundle.
  const ownFileKilled = () => one({
    prevention_action: 'process_killed',
    evidence_filenames: ['b1-t1003.exe', 'b1-t1204.exe'],
    evidence_file_verdicts: [{ file: 'b1-t1003.exe', verdict: 'malicious', action: 'process_killed' }],
    evidence_child_actions: [{ parent: 'b1-t1204.exe', action: 'process_killed' }],
  });

  it('an alert that marks the stage\'s own file as killed still gives detection only on a stage that ran to completion', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(101)] } });
    const alert = ownFileKilled();
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags).toMatchObject({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_stage_prevented`]: false,
    });
    expect(flags).not.toHaveProperty(`${prefix}_prevented`);
    expect(flags).not.toHaveProperty(`${prefix}_prevention_action`);
  });

  it('the same alert on an error-coded stage is that stage\'s own prevention', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    const alert = ownFileKilled();
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toMatchObject({
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_stage_prevented`]: true,
      [`${prefix}_prevention_action`]: 'process_killed',
    });
  });

  it('the aggregated action never credits a stage that ran to completion', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(101)] } });
    const many = { hits: { total: { value: 150 }, hits: [{ _id: 'alert-1', _source: {} }] }, aggregations: { prevention: { actions: { buckets: [{ key: 'process_killed', doc_count: 3 }] } } } };
    msearch.mockResolvedValueOnce({ responses: [many, many] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags[`${prefix}_prevented`]).toBeUndefined();
    expect(flags[`${prefix}_stage_prevented`]).toBe(false);
    expect(flags[`${prefix}_stage_detected`]).toBe(true);
  });

  it('an exit code stored as the string "101" is a completed stage too', async () => {
    const d = resultDoc(101);
    search.mockResolvedValueOnce({ hits: { hits: [{ ...d, _source: { ...d._source, event: { ERROR: '101' } } }] } });
    msearch.mockResolvedValueOnce({ responses: [hits('process_killed'), hits('process_killed')] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags[`${prefix}_prevented`]).toBeUndefined();
    expect(flags[`${prefix}_stage_prevented`]).toBe(false);
    expect(flags[`${prefix}_stage_detected`]).toBe(true);
    expect(flags).not.toHaveProperty(`${prefix}_prevention_action`);
  });

  it('an error-coded stage is not gated: a later action still counts (the error fits the EDR stopping it)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    const alert = one({ prevention_action: 'process_killed', created_at: LATE, last_activity_at: '2026-10-21T10:00:00Z' });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toMatchObject({ [`${prefix}_stage_prevented`]: true, [`${prefix}_prevented`]: true });
    expect(JSON.stringify(msearch.mock.calls[0][0].searches[1].aggs.prevention.filter)).not.toContain('last_activity_at');
  });

  it('a stage takes its own file\'s action, never a sibling stage\'s from the same alert', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    const alert = one({
      prevention_action: 'process_killed', created_at: IN_RUN,
      evidence_filenames: ['b1-t1003.exe', 'b1-t1204.exe'],
      evidence_file_verdicts: [{ file: 'b1-t1003.exe', verdict: 'malicious', action: null }, { file: 'b1-t1204.exe', verdict: 'malicious', action: 'process_killed' }],
      evidence_child_actions: [],
    });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    // Test level (an error stage): the alert's action still counts there.
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toMatchObject({
      [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'process_killed', [`${prefix}_stage_prevented`]: false,
    });
  });

  it('a stage takes the kill of a process it started', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    const alert = one({
      prevention_action: 'process_killed', created_at: IN_RUN,
      evidence_filenames: ['cmd.exe', 'b1-t1003.exe'],
      evidence_file_verdicts: [{ file: 'cmd.exe', verdict: 'malicious', action: 'process_killed' }],
      evidence_child_actions: [{ parent: 'b1-t1003.exe', action: 'process_killed' }],
    });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toMatchObject({ [`${prefix}_stage_prevented`]: true, [`${prefix}_prevention_action`]: 'process_killed' });
  });

  it('keeps the prevention of an older doc whose alerts are gone (aged out): it is only marked checked', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [stored(101, { [`${prefix}_stage_prevented`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked' })] } });
    msearch.mockResolvedValueOnce({ responses: [none, none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({ [`${prefix}_prevention_rule`]: 'in_run' });
  });

  it('an older 101 doc prevented under the older rules loses it once; detection stays', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [stored(101, { [`${prefix}_stage_prevented`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked' })] } });
    const alert = one({ prevention_action: 'blocked', created_at: IN_RUN });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    // No _detected / _stage_detected key: detection is left as stored.
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({
      [`${prefix}_prevented`]: false,
      [`${prefix}_prevention_action`]: null,
      [`${prefix}_stage_prevented`]: false,
      [`${prefix}_prevention_rule`]: 'in_run',
    });
  });

  it('an older stage with an action but no _stage_prevented is settled when its stage alerts are visible and none counts', async () => {
    // Live, Nov 2026: a Kothamine stage (exit 999) stayed Prevented through the
    // fallback (stage detected + action); its only stage alert named two tests
    // and blocked the other test's file.
    const QILIN = '8f68dda1-0000-4000-8000-000000000001';
    const KOTH = 'c37d6a01-3934-4e72-9cb1-3dae284b937b';
    const d = resultDoc(999);
    const doc = { ...d, _source: { ...d._source, f0rtika: { test_uuid: `${KOTH}::T1572`, control_id: 'T1572', [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'process_killed', ...evaluated, [`${prefix}_prevention_rule`]: 'in_run' } } };
    search.mockResolvedValueOnce({ hits: { hits: [doc] } });
    const multi = one({
      prevention_action: 'process_killed', created_at: IN_RUN,
      evidence_filenames: [`${QILIN}-t1518.001.exe`, `${KOTH}-t1572.exe`],
      evidence_file_verdicts: [{ file: `${QILIN}-t1518.001.exe`, verdict: 'malicious', action: 'process_killed' }, { file: `${KOTH}-t1572.exe`, verdict: 'suspicious', action: null }],
    });
    msearch.mockResolvedValueOnce({ responses: [multi, multi] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({ [`${prefix}_stage_prevented`]: false });
  });

  it('a doc already checked under the in-run rules is left alone', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [stored(101, { [`${prefix}_stage_prevented`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked', [`${prefix}_prevention_rule`]: 'in_run' })] } });
    const alert = one({ prevention_action: 'blocked', created_at: LATE });
    msearch.mockResolvedValueOnce({ responses: [alert, alert] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(bulk).not.toHaveBeenCalled();
  });
});
