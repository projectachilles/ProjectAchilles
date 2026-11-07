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
    expect(should).toHaveLength(6);
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
    expect(should[5]).toEqual({
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
    const agg = body.aggs.prevention;
    expect(agg.aggs.actions.terms.field).toBe('prevention_action');
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
    // Stages already evaluated under the single-test and per-file rules (the multi-test describes cover older ones).
    return { ...d, _source: { ...d._source, f0rtika: { ...d._source.f0rtika, [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, [`${prefix}_stage_rule`]: 'single_test', [`${prefix}_evidence_rule`]: 'file_verdict', ...extra } } };
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
    // Already evaluated at test level (the per-file describe covers that re-check).
    return { ...d, _source: { ...d._source, f0rtika: { ...d._source.f0rtika, [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, [`${prefix}_stage_prevented`]: true, [`${prefix}_prevented`]: true, [`${prefix}_prevention_action`]: 'blocked', [`${prefix}_evidence_rule`]: 'file_verdict', ...extra } } };
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
    });
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
    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toEqual({ [`${prefix}_evidence_rule`]: 'file_verdict' });
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
    });
  });
});
