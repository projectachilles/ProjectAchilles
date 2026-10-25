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
    key: `bundle::${BUNDLE}::HOST${i}::${1760273269000 + i}`,
    testKey: BUNDLE,
    hostname: `HOST${i}`,
    completedAt: new Date(1760273269000 + i).toISOString(),
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
      createdAt: '2026-10-12T12:48:51Z', stageControlId: 't1486', preventionAction: 'blocked',
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
    expect(res.alerts.get(run(1).key)?.[0]).toMatchObject({ vendor: 'crowdstrike', title: 'Fallback', stageControlId: null });
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

describe('buildHostTechniqueQuery', () => {
  it('scopes to techniques, the host prefix and the console window', () => {
    const q = buildHostTechniqueQuery(DEFENDER_ADAPTER, run(1, ['T1486'])) as { bool: { must: unknown[] } };
    expect(q.bool.must).toContainEqual({ term: { doc_type: 'alert' } });
    expect(q.bool.must).toContainEqual({ terms: { mitre_techniques: ['T1486'] } });
    expect(JSON.stringify(q)).toContain('HOST1*');
  });
});
