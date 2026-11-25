import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  correlateRuns,
  buildHostTechniqueQuery,
  DEFENDER_ADAPTER,
  CROWDSTRIKE_ADAPTER,
  type CorrelationRun,
} from '../alertCorrelation.js';

const BUNDLE = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';

function run(i: number, techniques = ['T1486']): CorrelationRun {
  return {
    key: `bundle::${BUNDLE}::HOST${i}::${1791809269000 + i}`,
    testKey: BUNDLE,
    hostname: `HOST${i}`,
    completedAt: new Date(1791809269000 + i).toISOString(),
    bundleName: 'LockBit 3.0 Double Extortion Kill Chain',
    techniques,
  };
}

const alertHit = (title: string, stage = 'T1486') => ({
  _source: {
    alert_title: title, severity: 'high', status: 'new', created_at: '2026-10-12T12:48:51Z',
    evidence_filenames: [`${BUNDLE}-${stage}.exe`], prevention_action: 'blocked', portal_url: 'https://x/1',
    f0rtika: { auto_resolved_at: '2026-10-12T13:02:10Z', auto_resolve_mode: 'enabled' },
  },
});

describe('correlateRuns', () => {
  const msearch = vi.fn();
  const client = { msearch } as never;
  const far = () => Date.now() + 60_000;

  beforeEach(() => {
    msearch.mockReset();
  });

  it('sends ONE evidence sub-search per run, not per stage', async () => {
    msearch.mockResolvedValueOnce({ responses: [{ hits: { hits: [alertHit('ProcRansomware')] } }, { hits: { hits: [alertHit('Second')] } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1, ['T1486', 'T1003.001']), run(2)], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(1);
    const searches = msearch.mock.calls[0][0].searches;
    expect(searches).toHaveLength(4);
    expect(searches[0]).toEqual({ index: 'achilles-defender' });
    // projectAlertHit only emits auto_resolved_at when these receipt fields survive _source filtering.
    expect(searches[1]._source).toEqual(expect.arrayContaining(['f0rtika.auto_resolve_mode', 'f0rtika.auto_resolve_error']));
    expect(res.complete).toBe(true);
    expect(res.alerts.get(run(1).key)?.[0]).toEqual({
      vendor: 'defender', title: 'ProcRansomware', severity: 'high', status: 'new',
      createdAt: '2026-10-12T12:48:51Z', stageControlId: 't1486', stageControlIds: ['t1486'], preventionAction: 'blocked',
      portalUrl: 'https://x/1', autoResolvedAt: '2026-10-12T13:02:10Z',
    });
  });

  it('an alert Achilles mitigated itself carries no prevention action (same rule as Analytics)', async () => {
    const mitigated = alertHit('Killed by Achilles');
    (mitigated._source as Record<string, unknown>).f0rtika = { auto_mitigated: true, auto_mitigation_mode: 'enabled' };
    msearch.mockResolvedValueOnce({ responses: [{ hits: { hits: [mitigated] } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
    expect(msearch.mock.calls[0][0].searches[1]._source).toEqual(expect.arrayContaining(['f0rtika.auto_mitigated']));
    expect(res.alerts.get(run(1).key)?.[0].preventionAction).toBeNull();
  });

  it('leaves out an alert naming several tests that singles out none of this run\'s files', async () => {
    const listing = alertHit('A suspicious file was observed');
    (listing._source as Record<string, unknown>).evidence_filenames = [`${BUNDLE}-T1486.exe`, '26a8b54e-b51c-489d-beae-295e1eecc524.exe'];
    msearch
      .mockResolvedValueOnce({ responses: [{ hits: { hits: [listing, alertHit('ProcRansomware')] } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
    expect(msearch.mock.calls[0][0].searches[1]._source).toEqual(expect.arrayContaining(['evidence_file_verdicts']));
    expect(res.alerts.get(run(1).key)?.map((a) => a.title)).toEqual(['ProcRansomware']);
  });

  it('runs the technique+host fallback only for runs with no evidence match', async () => {
    msearch
      .mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }, { hits: { hits: [alertHit('Matched')] } }] })
      .mockResolvedValueOnce({ responses: [{ hits: { hits: [{ _source: {
        alert_title: 'Fallback', severity: 'medium', status: 'new', created_at: '2026-10-12T12:50:00Z',
        evidence_filenames: ['powershell.exe'], // no bundle UUID → bundle-level attribution
      } }] } }] });
    const res = await correlateRuns(client, CROWDSTRIKE_ADAPTER, [run(1), run(2)], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(2);
    const fallbackSearches = msearch.mock.calls[1][0].searches;
    expect(fallbackSearches).toHaveLength(2);
    expect(fallbackSearches[0]).toEqual({ index: 'achilles-crowdstrike' });
    expect(res.alerts.get(run(1).key)?.[0]).toMatchObject({ vendor: 'crowdstrike', title: 'Fallback', stageControlId: null, stageControlIds: [] });
    expect(res.alerts.get(run(2).key)?.[0].title).toBe('Matched');
  });

  it('skips the fallback for runs without techniques', async () => {
    msearch.mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1, [])], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(1);
    expect(res.alerts.size).toBe(0);
  });

  it('treats a missing alert index as no alerts, not a failure, and skips tier 2', async () => {
    msearch.mockResolvedValueOnce({ responses: [{ error: { type: 'index_not_found_exception' } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ alerts: new Map(), complete: true, failed: 0, searched: new Set([run(1).key]) });
  });

  it('counts a rejected tier-1 sub-search as failed, not as no alerts', async () => {
    msearch
      .mockResolvedValueOnce({ responses: [{ error: { type: 'es_rejected_execution_exception', reason: 'x' } }] })
      .mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
    expect(res.failed).toBe(1);
    expect(res.alerts.get(run(1).key)).toBeUndefined();
    expect(res.complete).toBe(true);
  });

  it('counts a tier-2 sub-search error with no type as failed', async () => {
    msearch
      .mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }] })
      .mockResolvedValueOnce({ responses: [{ error: { reason: 'no type' } }] });
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(2);
    expect(res.failed).toBe(1);
    expect(res.alerts.size).toBe(0);
  });

  it('batches by batchSize', async () => {
    msearch.mockImplementation(async ({ searches }: { searches: unknown[] }) => ({
      responses: Array.from({ length: searches.length / 2 }, () => ({ hits: { hits: [alertHit('A')] } })),
    }));
    await correlateRuns(client, DEFENDER_ADAPTER, [run(1), run(2), run(3)], { deadline: far(), batchSize: 2 });
    expect(msearch).toHaveBeenCalledTimes(2);
  });

  it('stops and reports incomplete once the deadline has passed', async () => {
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: Date.now() - 1 });
    expect(msearch).not.toHaveBeenCalled();
    expect(res.complete).toBe(false);
    expect(res.searched.size).toBe(0);
  });

  describe('searched', () => {
    it('contains a run whose tier-1 sub-search answered, with or without hits', async () => {
      msearch
        .mockResolvedValueOnce({ responses: [{ hits: { hits: [alertHit('A')] } }, { hits: { hits: [] } }] })
        .mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }] });
      const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1), run(2)], { deadline: far() });
      expect(res.searched).toEqual(new Set([run(1).key, run(2).key]));
    });

    it('excludes a run whose tier-1 and tier-2 sub-searches both errored', async () => {
      msearch
        .mockResolvedValueOnce({ responses: [{ error: { type: 'es_rejected_execution_exception' } }] })
        .mockResolvedValueOnce({ responses: [{ error: { type: 'es_rejected_execution_exception' } }] });
      const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
      expect(res.failed).toBe(2);
      expect(res.searched.has(run(1).key)).toBe(false);
    });

    it('contains a run whose tier-1 sub-search errored but whose tier-2 sub-search answered', async () => {
      msearch
        .mockResolvedValueOnce({ responses: [{ error: { type: 'es_rejected_execution_exception' } }] })
        .mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }] });
      const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
      expect(res.failed).toBe(1);
      expect(res.searched.has(run(1).key)).toBe(true);
    });

    it('counts a missing alert index as searched', async () => {
      msearch.mockResolvedValueOnce({ responses: [{ error: { type: 'index_not_found_exception' } }] });
      const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1)], { deadline: far() });
      expect(res.searched.has(run(1).key)).toBe(true);
    });

    it('counts sub-searches missing from a short msearch response as failed and unsearched', async () => {
      msearch.mockResolvedValueOnce({ responses: [{ hits: { hits: [] } }] });
      const res = await correlateRuns(client, DEFENDER_ADAPTER, [run(1, []), run(2, [])], { deadline: far() });
      expect(msearch).toHaveBeenCalledTimes(1);
      expect(res.failed).toBe(1);
      expect(res.searched).toEqual(new Set([run(1).key]));
    });
  });
});

// Alert evidence belongs to a run (Nov 2026): a run that knows its start reads
// each alert through its run window (edr/runEvidence.ts), as the console does.
describe('correlateRuns with a run window', () => {
  const msearch = vi.fn();
  const client = { msearch } as never;
  const far = () => Date.now() + 60_000;
  const STARTED = '2026-11-25T00:46:47.000Z';
  const COMPLETED = '2026-11-25T00:47:56.000Z';
  const NOV_19 = '2026-11-19T09:06:46Z';
  const stage1 = `${BUNDLE}-t1518.001.exe`;
  const stage3 = `${BUNDLE}-t1047.exe`;
  const stage5 = `${BUNDLE}-t1136.001.exe`;
  const windowRun = (startedAt: string | null = STARTED): CorrelationRun => ({
    key: `bundle::${BUNDLE}::WIN-HOST-01::${Date.parse(COMPLETED)}`,
    testKey: BUNDLE,
    hostname: 'WIN-HOST-01',
    completedAt: COMPLETED,
    ...(startedAt ? { startedAt } : {}),
    bundleName: 'Account discovery chain',
    techniques: ['T1087'],
  });
  const item = (file: string, over: Record<string, unknown> = {}) => ({
    file, path: 'c:\\f0', parent: `${BUNDLE}.exe`, parent_path: 'c:\\f0', kind: 'process',
    verdict: 'suspicious', action: null, started_at: '2026-11-25T00:47:26Z', added_at: '2026-11-25T00:49:10Z', ...over,
  });
  const earlier = (file: string, over: Record<string, unknown> = {}) =>
    item(file, { started_at: NOV_19, added_at: '2026-11-19T09:08:00Z', ...over });
  const alertDoc = (title: string, items: Record<string, unknown>[], filenames: string[]) => ({
    alert_id: title, alert_title: title, severity: 'medium', status: 'new', created_at: '2026-11-19T09:08:00Z',
    mitre_techniques: ['T1087'], prevention_action: 'quarantined',
    evidence_filenames: filenames, evidence_items: items,
  });
  // Open since Nov 19 (stage 3 then, quarantined); stages 1 (killed) and 5 (its net.exe) in this run.
  const spanning = () => alertDoc('Anomalous account lookups', [
    earlier(stage3, { verdict: 'malicious', action: 'quarantined' }),
    item(stage1, { verdict: 'malicious', action: 'process_killed' }),
    item('net.exe', { path: 'c:\\windows\\system32', parent: stage5 }),
  ], [stage3, `${BUNDLE}.exe`, stage1, 'net.exe', stage5]);
  // Names the test only in the Nov 19 run; this run's item is a system process.
  const earlierOnly = () => alertDoc('Earlier run only', [
    earlier(stage3, { verdict: 'malicious', action: 'quarantined' }),
    item('net.exe', { path: 'c:\\windows\\system32', parent: 'svchost.exe' }),
  ], [stage3, `${BUNDLE}.exe`, 'net.exe', 'svchost.exe']);
  const techniqueOnly = () => ({
    alert_id: 'tech', alert_title: 'Technique match', severity: 'low', status: 'new', created_at: '2026-11-25T00:50:00Z',
    mitre_techniques: ['T1087'], evidence_filenames: ['net.exe'],
  });

  /** What Elasticsearch returns for `doc` under a `_source` field list: dotted paths reach into nested objects. */
  function sourceFiltered(doc: Record<string, unknown>, fields: unknown): Record<string, unknown> {
    if (!Array.isArray(fields)) return doc;
    const out: Record<string, unknown> = {};
    for (const field of fields as string[]) {
      const parts = field.split('.');
      let value: unknown = doc;
      for (const p of parts) value = (value as Record<string, unknown> | undefined)?.[p];
      if (value === undefined) continue;
      let target = out;
      for (const p of parts.slice(0, -1)) target = (target[p] ??= {}) as Record<string, unknown>;
      target[parts[parts.length - 1]] = value;
    }
    return out;
  }

  /** One list of docs per msearch call (tier 1, then tier 2), each hit filtered by the request's own `_source`. */
  const answer = (...tiers: Record<string, unknown>[][]) => {
    let call = 0;
    msearch.mockImplementation(async ({ searches }: { searches: { _source?: unknown }[] }) => {
      const docs = tiers[call++] ?? [];
      return {
        responses: Array.from({ length: searches.length / 2 }, (_, i) => ({
          hits: { hits: docs.map((d) => ({ _source: sourceFiltered(d, searches[i * 2 + 1]._source) })) },
        })),
      };
    });
  };

  beforeEach(() => {
    msearch.mockReset();
  });

  it('lists every stage the run evidence names; stageControlId is the first; an earlier run\'s stage is left out', async () => {
    answer([spanning()]);
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [windowRun()], { deadline: far() });
    expect(res.alerts.get(windowRun().key)?.[0]).toMatchObject({
      title: 'Anomalous account lookups',
      stageControlId: 't1518.001',
      stageControlIds: ['t1518.001', 't1136.001'],
      // The in-run action, never the alert-wide one (which is the Nov 19 quarantine).
      preventionAction: 'process_killed',
    });
  });

  it('an alert naming the test only in an earlier run yields no report alert; the run falls to the technique tier', async () => {
    answer([earlierOnly()], [techniqueOnly()]);
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [windowRun()], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(2);
    expect(res.alerts.get(windowRun().key)?.map((a) => a.title)).toEqual(['Technique match']);
    expect(res.alerts.get(windowRun().key)?.[0]).toMatchObject({ stageControlId: null, stageControlIds: [] });
  });

  it('a run without a start has no run window: the alert as it is, by name, as before', async () => {
    answer([spanning(), earlierOnly()]);
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [windowRun(null)], { deadline: far() });
    expect(msearch).toHaveBeenCalledTimes(1);
    expect(res.alerts.get(windowRun().key)?.map((a) => [a.title, a.stageControlId, a.stageControlIds, a.preventionAction])).toEqual([
      ['Anomalous account lookups', 't1047', ['t1047', 't1518.001', 't1136.001'], 'quarantined'],
      ['Earlier run only', 't1047', ['t1047'], 'quarantined'],
    ]);
  });

  it('a bundle-level alert has no stages', async () => {
    answer([alertDoc('Orchestrator', [item(`${BUNDLE}.exe`, { parent: 'explorer.exe' })], [`${BUNDLE}.exe`, 'explorer.exe'])]);
    const res = await correlateRuns(client, DEFENDER_ADAPTER, [windowRun()], { deadline: far() });
    expect(res.alerts.get(windowRun().key)?.[0]).toMatchObject({ title: 'Orchestrator', stageControlId: null, stageControlIds: [] });
  });
});

describe('buildHostTechniqueQuery', () => {
  it('scopes to techniques, the host prefix and the console window', () => {
    const q = buildHostTechniqueQuery(DEFENDER_ADAPTER, run(1, ['T1486'])) as { bool: { must: unknown[] } };
    expect(q.bool.must).toContainEqual({ term: { doc_type: 'alert' } });
    expect(q.bool.must).toContainEqual({ terms: { mitre_techniques: ['T1486'] } });
    expect(JSON.stringify(q)).toContain('HOST1*');
  });

  it('also matches the id ATT&CK renumbered a technique to (T1562.001 -> T1685)', () => {
    const q = buildHostTechniqueQuery(DEFENDER_ADAPTER, run(1, ['T1562.001'])) as { bool: { must: unknown[] } };
    expect(q.bool.must).toContainEqual({ terms: { mitre_techniques: ['T1562.001', 'T1685'] } });
  });
});
