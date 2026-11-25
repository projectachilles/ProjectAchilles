import { describe, it, expect, vi } from 'vitest';
import {
  alertsForTestTiers,
  findAlertsForTest,
  findAlertsForTests,
  parseAlertsForTestsBody,
  answerAlertsForTests,
  toAlertsForTestResult,
  type AlertsForTestDeps,
  type AlertsForTestRequest,
} from '../alertsForTest.js';
import {
  buildAlertTimeWindowQuery,
  buildDefenderEvidenceQuery,
  defenderPathNamesTest,
} from '../../defender/evidence-correlation.js';
import { buildCrowdStrikeEvidenceQuery } from '../../edr/evidence-correlation.js';

const deps: AlertsForTestDeps = {
  index: 'alerts-idx',
  buildEvidenceQuery: (input) => ({ evidence: input.test_uuid, host: input.routing_hostname }),
  buildTimeWindow: (from, to) => ({ window: [from, to] }),
};

const STAGE: AlertsForTestRequest = {
  techniques: ['T1059'],
  timestamp: '2026-10-31T10:00:00Z',
  windowMinutes: 30,
  hostname: 'host-1',
  binaryName: 'aaaa-bbbb.exe',
  bundleName: 'Chain',
};

const hit = (id: string, techniques: string[], created = '2026-10-31T10:01:00Z') => ({
  _source: { alert_id: id, mitre_techniques: techniques, created_at: created, evidence_filenames: [] },
});
const page = (total: number, hits: unknown[] = []) => ({ hits: { total: { value: total }, hits } });

describe('alertsForTestTiers', () => {
  it('plans evidence, then technique+host when the binary and host are known', () => {
    const tiers = alertsForTestTiers(STAGE, deps);
    expect(tiers).toHaveLength(2);
    expect(JSON.stringify(tiers[0].query)).toContain('aaaa-bbbb');
    expect(JSON.stringify(tiers[1].query)).toContain('HOST-1*');
  });

  it('does not repeat the technique+host query as a third tier', () => {
    // The old code ran a host-scoped "technique-only" search after an empty
    // technique+host search: the same clauses, so always the same empty answer.
    const tiers = alertsForTestTiers({ ...STAGE, binaryName: undefined }, deps);
    expect(tiers).toHaveLength(1);
  });

  it('falls back to technique-only without a host', () => {
    const tiers = alertsForTestTiers({ ...STAGE, hostname: undefined, binaryName: undefined }, deps);
    expect(tiers).toHaveLength(1);
    expect(JSON.stringify(tiers[0].query)).not.toContain('evidence_hostnames');
  });

  it('the technique tier also matches the id ATT&CK renumbered a technique to', () => {
    const tiers = alertsForTestTiers({ ...STAGE, techniques: ['T1562.001'], binaryName: undefined }, deps);
    expect(JSON.stringify(tiers[0].query)).toContain('{"terms":{"mitre_techniques":["T1562.001","T1685"]}}');
  });

  it('reports an alert tagged with the new id as matching the test\'s own technique', () => {
    const res = toAlertsForTestResult({ ...STAGE, techniques: ['T1562.001'] }, page(1, [hit('a1', ['T1685'])]) as Parameters<typeof toAlertsForTestResult>[1]);
    expect(res.matchedTechniques).toEqual(['T1562.001']);
  });

  it('skips the evidence tier when the builder returns null', () => {
    expect(alertsForTestTiers(STAGE, { ...deps, buildEvidenceQuery: () => null })).toHaveLength(1);
  });
});

describe('findAlertsForTests (msearch per tier)', () => {
  it('answers every stage in one round trip per tier, in input order', async () => {
    const msearch = vi.fn()
      // tier 1 for all three: A hits evidence, B and C don't
      .mockResolvedValueOnce({ responses: [page(1, [hit('a1', ['T1059'])]), page(0), page(0)] })
      // tier 2 only for B (C had a single tier already)
      .mockResolvedValueOnce({ responses: [page(2, [hit('b1', ['T1059']), hit('b2', ['T1003'])])] });
    const client = { msearch, search: vi.fn() };

    const results = await findAlertsForTests(client as never, [
      STAGE,
      { ...STAGE, techniques: ['T1059', 'T1003'] },
      { ...STAGE, binaryName: undefined },
    ], deps);

    expect(msearch).toHaveBeenCalledTimes(2);
    expect(client.search).not.toHaveBeenCalled();
    expect(msearch.mock.calls[0][0].searches).toHaveLength(6); // header + body per stage
    expect(msearch.mock.calls[1][0].searches).toHaveLength(2);
    expect(results.map((r) => r?.total)).toEqual([1, 2, 0]);
    expect(results[1]?.matchedTechniques.sort()).toEqual(['T1003', 'T1059']);
    expect(results[2]).toEqual({ alerts: [], matchedTechniques: [], total: 0 });
  });

  it('returns null for a stage whose search failed, without failing the others', async () => {
    const msearch = vi.fn().mockResolvedValueOnce({
      responses: [{ error: { type: 'search_phase_execution_exception' }, status: 400 }, page(1, [hit('x', ['T1059'])])],
    });
    const results = await findAlertsForTests({ msearch } as never, [
      { ...STAGE, binaryName: undefined },
      { ...STAGE, binaryName: undefined },
    ], deps);
    expect(results[0]).toBeNull();
    expect(results[1]?.total).toBe(1);
  });

  it('gives the same answer as the single-stage path', async () => {
    const responses = [page(0), page(1, [hit('h', ['T1059'])])];
    const search = vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1]);
    const single = await findAlertsForTest({ search } as never, STAGE, deps);

    const msearch = vi.fn()
      .mockResolvedValueOnce({ responses: [responses[0]] })
      .mockResolvedValueOnce({ responses: [responses[1]] });
    const [batched] = await findAlertsForTests({ msearch } as never, [STAGE], deps);

    expect(batched).toEqual(single);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('parseAlertsForTestsBody', () => {
  it('accepts a list of stages and applies the 30-minute default window', () => {
    const items = parseAlertsForTestsBody({ items: [{ techniques: ['T1059'], timestamp: STAGE.timestamp, hostname: 'h' }] });
    expect(items[0]).toMatchObject({ techniques: ['T1059'], windowMinutes: 30, hostname: 'h' });
  });

  it.each([
    [{}, 'items is required'],
    [{ items: [] }, 'items is required'],
    [{ items: Array.from({ length: 101 }, () => ({ techniques: ['T1'], timestamp: STAGE.timestamp })) }, 'At most 100 items'],
  ])('rejects the request for %j', (body, message) => {
    expect(() => parseAlertsForTestsBody(body)).toThrow(message);
  });

  it.each([
    [{ techniques: [], timestamp: STAGE.timestamp }, 'techniques and timestamp are required'],
    [{ techniques: ['T1'], timestamp: 'not-a-date' }, 'Invalid timestamp'],
    [{ techniques: ['T1'], timestamp: STAGE.timestamp, windowMinutes: 0 }, 'Invalid windowMinutes'],
    [{ techniques: ['T1'], timestamp: STAGE.timestamp, hostname: 5 }, 'Invalid hostname'],
    [{ techniques: ['x'.repeat(301)], timestamp: STAGE.timestamp }, 'Invalid techniques'],
  ])('marks only the bad stage %j, keeping the others', (bad, message) => {
    const [first, second] = parseAlertsForTestsBody({ items: [bad, { techniques: ['T1059'], timestamp: STAGE.timestamp }] });
    expect(first).toEqual({ error: message });
    expect(second).toMatchObject({ techniques: ['T1059'] });
  });
});

describe('answerAlertsForTests', () => {
  it('runs the valid stages and reports the invalid one in place', async () => {
    const run = vi.fn(async (reqs: AlertsForTestRequest[]) => reqs.map((r) => ({ alerts: [], matchedTechniques: r.techniques, total: 0 })));
    const out = await answerAlertsForTests(
      { items: [{ techniques: ['T1'], timestamp: STAGE.timestamp }, { techniques: [], timestamp: STAGE.timestamp }, { techniques: ['T3'], timestamp: STAGE.timestamp }] },
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].map((r) => r.techniques[0])).toEqual(['T1', 'T3']);
    expect(out.results.map((r) => r?.matchedTechniques[0] ?? null)).toEqual(['T1', null, 'T3']);
    expect(out.errors).toEqual([null, 'techniques and timestamp are required', null]);
  });

  it('does not search at all when every stage is invalid', async () => {
    const run = vi.fn();
    const out = await answerAlertsForTests({ items: [{ techniques: [] }] }, run);
    expect(run).not.toHaveBeenCalled();
    expect(out).toEqual({ results: [null], errors: ['techniques and timestamp are required'] });
  });
});

// Alert evidence belongs to a run (Nov 2026): an alert that names this test
// only in an earlier run's evidence is left out of every tier.
describe('alerts from another run', () => {
  const U = 'a1b2c3d4-0000-4000-8000-00000000f001';
  const RUN: AlertsForTestRequest = {
    techniques: ['T1087'],
    timestamp: '2026-11-25T00:47:56Z',
    runStartedAt: '2026-11-25T00:46:47Z',
    windowMinutes: 30,
    hostname: 'win-host-01',
    binaryName: `${U}.exe`,
  };
  const ev = (file: string, startedAt: string, parent: string | null = null) => ({
    file, path: 'c:\\f0', parent, parent_path: null, kind: 'process', verdict: 'suspicious', action: null,
    started_at: startedAt, added_at: startedAt,
  });
  const NOW = '2026-11-25T00:47:20Z';
  const NOV_19 = '2026-11-19T09:06:46Z';
  const alertHitOf = (id: string, items: unknown[], created = '2026-11-25T00:49:00Z') => ({
    _source: {
      alert_id: id, mitre_techniques: ['T1087'], created_at: created,
      evidence_filenames: (items as Array<{ file: string }>).map((i) => i.file),
      evidence_items: items,
    },
  });
  // Names stage 3 only on Nov 19; in this run only a net.exe of svchost.
  const otherRun = (id = 'old') => alertHitOf(id, [ev(`${U}-t1047.exe`, NOV_19, `${U}.exe`), ev('net.exe', NOW, 'svchost.exe')]);
  const thisRun = (id = 'mine') => alertHitOf(id, [ev('net.exe', NOW, `${U}-t1518.001.exe`)]);
  // A technique match that never names the test.
  const pureTechnique = (id = 'tech') => alertHitOf(id, [ev('lsass.exe', NOW, 'svchost.exe')]);

  it('parseItem accepts runStartedAt and rejects a non-date', () => {
    const [ok] = parseAlertsForTestsBody({ items: [{ techniques: ['T1'], timestamp: RUN.timestamp, runStartedAt: RUN.runStartedAt }] });
    expect(ok).toMatchObject({ runStartedAt: RUN.runStartedAt });
    const [none] = parseAlertsForTestsBody({ items: [{ techniques: ['T1'], timestamp: RUN.timestamp }] });
    expect(none).not.toHaveProperty('runStartedAt', expect.anything());
    for (const bad of ['not-a-date', 5, { at: 1 }]) {
      const [first] = parseAlertsForTestsBody({ items: [{ techniques: ['T1'], timestamp: RUN.timestamp, runStartedAt: bad }] });
      expect(first).toEqual({ error: 'Invalid runStartedAt' });
    }
  });

  it('tier 1 with two alerts, one left out of the run: one alert', async () => {
    const search = vi.fn().mockResolvedValueOnce(page(2, [otherRun(), thisRun()]));
    const res = await findAlertsForTest({ search } as never, RUN, deps);
    expect(search).toHaveBeenCalledTimes(1);
    expect(res.alerts.map((a) => a.alert_id)).toEqual(['mine']);
    expect(res.total).toBe(1);
    expect(res.alerts[0]).toMatchObject({ attributed_control_ids: ['t1518.001'] });
  });

  it('tier 1 with only alerts left out of the run falls through to the technique tier (single lookup)', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce(page(1, [otherRun()]))
      .mockResolvedValueOnce(page(2, [otherRun('old-2'), pureTechnique()]));
    const res = await findAlertsForTest({ search } as never, RUN, deps);
    expect(search).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(search.mock.calls[1][0].query)).toContain('mitre_techniques');
    // The technique tier's alert naming the test only on Nov 19 is left out too.
    expect(res).toEqual(expect.objectContaining({ total: 1, matchedTechniques: ['T1087'] }));
    expect(res.alerts.map((a) => a.alert_id)).toEqual(['tech']);
  });

  it('tier 1 with only alerts left out of the run falls through to the technique tier (batch lookup)', async () => {
    const msearch = vi.fn()
      .mockResolvedValueOnce({ responses: [page(1, [otherRun()])] })
      .mockResolvedValueOnce({ responses: [page(2, [otherRun('old-2'), pureTechnique()])] });
    const [res] = await findAlertsForTests({ msearch } as never, [RUN], deps);
    expect(msearch).toHaveBeenCalledTimes(2);
    expect(res?.alerts.map((a) => a.alert_id)).toEqual(['tech']);
    expect(res?.total).toBe(1);
  });

  it('every hit left out on the last tier: an empty answer', async () => {
    const msearch = vi.fn()
      .mockResolvedValueOnce({ responses: [page(1, [otherRun()])] })
      .mockResolvedValueOnce({ responses: [page(1, [otherRun('old-2')])] });
    const [res] = await findAlertsForTests({ msearch } as never, [RUN], deps);
    expect(res).toEqual({ alerts: [], matchedTechniques: [], total: 0 });
  });

  it('without runStartedAt the results are as today', async () => {
    const { runStartedAt: _drop, ...today } = RUN;
    const search = vi.fn().mockResolvedValueOnce(page(2, [otherRun(), thisRun()]));
    const res = await findAlertsForTest({ search } as never, today, deps);
    expect(search).toHaveBeenCalledTimes(1);
    expect(res.total).toBe(2);
    expect(res.alerts.map((a) => a.alert_id).sort()).toEqual(['mine', 'old']);
    // By name, as today: the alert-wide list names stage 3.
    expect(res.alerts.find((a) => a.alert_id === 'old')).toMatchObject({ attributed_control_id: 't1047' });
  });

  // Final fix wave A4: with the Defender path rule in its deps the lookup
  // treats a path under a bundle-named folder as naming the test, as the
  // enrichment pass does.
  describe('the deps\' path rule', () => {
    const bundle = { ...RUN, bundleName: 'BlueHammer Early-Stage Behavioral Pattern' };
    const dropped = (at: string) => ({
      file: 'payload.bin', path: 'c:\\users\\public\\bluehammersandbox', parent: null, parent_path: null,
      kind: 'file', verdict: 'suspicious', action: null, started_at: null, added_at: at,
    });
    const defenderDeps: AlertsForTestDeps = { ...deps, pathNamesTest: defenderPathNamesTest };
    // Names stage 3 on Nov 19; this run's only item naming the test is the dropped file.
    const folderInRun = () => alertHitOf('folder', [ev(`${U}-t1047.exe`, NOV_19, `${U}.exe`), dropped(NOW)]);
    // Names the test only by the folder, on Nov 19; this run's item is a system process.
    const folderEarlier = () => alertHitOf('folder-old', [dropped(NOV_19), ev('net.exe', NOW, 'svchost.exe')]);

    it('keeps an alert whose only in-run item sits under a bundle-named folder', async () => {
      const search = vi.fn().mockResolvedValueOnce(page(1, [folderInRun()]));
      const res = await findAlertsForTest({ search } as never, bundle, defenderDeps);
      expect(res.alerts.map((a) => a.alert_id)).toEqual(['folder']);

      const msearch = vi.fn().mockResolvedValueOnce({ responses: [page(1, [folderInRun()])] });
      const [batched] = await findAlertsForTests({ msearch } as never, [bundle], defenderDeps);
      expect(batched?.alerts.map((a) => a.alert_id)).toEqual(['folder']);
    });

    it('leaves out an alert whose only such item is from an earlier run', async () => {
      const msearch = vi.fn()
        .mockResolvedValueOnce({ responses: [page(1, [folderEarlier()])] })
        .mockResolvedValueOnce({ responses: [page(1, [folderEarlier()])] });
      const [res] = await findAlertsForTests({ msearch } as never, [bundle], defenderDeps);
      expect(res).toEqual({ alerts: [], matchedTechniques: [], total: 0 });
    });

    it('without the dep the behaviour is today\'s (the uuid rule)', async () => {
      const search = vi.fn()
        .mockResolvedValueOnce(page(2, [folderInRun(), folderEarlier()]))
        .mockResolvedValueOnce(page(0));
      const res = await findAlertsForTest({ search } as never, bundle, deps);
      expect(res.alerts.map((a) => a.alert_id)).toEqual(['folder-old']);
    });
  });

  it('every search requests whole documents, or at least evidence_items (the run view needs it)', async () => {
    const keepsItems = (body: object) => {
      const filter = (body as { _source?: unknown })._source;
      return filter === undefined || (Array.isArray(filter) && filter.includes('evidence_items'));
    };
    for (const tier of alertsForTestTiers(RUN, deps)) expect(keepsItems(tier)).toBe(true);
    const search = vi.fn().mockResolvedValue(page(0));
    await findAlertsForTest({ search } as never, RUN, deps);
    expect(search).toHaveBeenCalledTimes(2);
    for (const [params] of search.mock.calls) expect(keepsItems(params)).toBe(true);
    const msearch = vi.fn().mockResolvedValue({ responses: [page(0)] });
    await findAlertsForTests({ msearch } as never, [RUN], deps);
    const bodies = msearch.mock.calls.flatMap(([params]) => params.searches.filter((_: unknown, k: number) => k % 2 === 1));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) expect(keepsItems(body)).toBe(true);
  });
});

// Found by activity span (Nov 2026): the first tier names its two ways in, and
// a hit found only by its span counts only through its in-run items.
describe('alerts found by activity span', () => {
  const U = 'a1b2c3d4-0000-4000-8000-00000000f001';
  const defender: AlertsForTestDeps = {
    index: 'alerts-idx',
    buildEvidenceQuery: buildDefenderEvidenceQuery,
    buildTimeWindow: buildAlertTimeWindowQuery,
  };
  const crowdstrike: AlertsForTestDeps = { ...defender, buildEvidenceQuery: buildCrowdStrikeEvidenceQuery };
  const RUN: AlertsForTestRequest = {
    techniques: ['T1087'],
    timestamp: '2026-11-25T00:47:56Z',
    runStartedAt: '2026-11-25T00:46:47Z',
    windowMinutes: 30,
    hostname: 'host-a',
    binaryName: `${U}.exe`,
  };
  const NOW = '2026-11-25T00:47:20Z';
  const NOV_19 = '2026-11-19T09:06:46Z';
  const ev = (file: string, at: string, parent: string | null = null) => ({
    file, path: 'c:\\f0', parent, parent_path: null, kind: 'process', verdict: 'suspicious', action: null,
    started_at: at, added_at: at,
  });
  const alertHit = (id: string, items: unknown[] | undefined, matched?: unknown) => ({
    ...(matched !== undefined ? { matched_queries: matched } : {}),
    _source: {
      alert_id: id, mitre_techniques: ['T1087'], created_at: '2026-11-25T00:49:00Z',
      evidence_filenames: ((items ?? [ev(`${U}-t1518.001.exe`, NOW)]) as Array<{ file: string }>).map((i) => i.file),
      ...(items ? { evidence_items: items } : {}),
    },
  });
  const inRun = [ev('net.exe', NOW, `${U}-t1518.001.exe`)];
  const otherRunOnly = [ev(`${U}-t1047.exe`, NOV_19, `${U}.exe`), ev('net.exe', NOW, 'svchost.exe')];

  it('the evidence tier passes the run start; the technique tier stays on alert time', () => {
    const tiers = alertsForTestTiers(RUN, defender);
    expect(JSON.stringify(tiers[0].query)).toContain('activity_span');
    expect(JSON.stringify(tiers[1].query)).not.toContain('activity_span');
    const { runStartedAt: _drop, ...today } = RUN;
    expect(tiers[1]).toEqual(alertsForTestTiers(today, defender)[1]);
  });

  it('without runStartedAt both tiers are today\'s', () => {
    const { runStartedAt: _drop, ...today } = RUN;
    const tiers = alertsForTestTiers(today, defender);
    expect(JSON.stringify(tiers)).not.toContain('_name');
    expect(tiers).toEqual(alertsForTestTiers({ ...today, runStartedAt: undefined }, defender));
    expect(tiers[0].query).toEqual(
      buildDefenderEvidenceQuery({
        test_uuid: U, routing_event_time: RUN.timestamp, routing_hostname: 'host-a', bundle_name: undefined,
      }),
    );
  });

  it('a span-only alert with an in-run item is listed, under its stage', async () => {
    const search = vi.fn().mockResolvedValueOnce(page(1, [alertHit('span', inRun, ['activity_span'])]));
    const res = await findAlertsForTest({ search } as never, RUN, defender);
    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0].attributed_control_ids).toEqual(['t1518.001']);
  });

  it('a span-only alert with only other-run items is left out', () => {
    const res = toAlertsForTestResult(RUN, page(1, [alertHit('span', otherRunOnly, ['activity_span'])]) as never);
    expect(res).toEqual({ alerts: [], matchedTechniques: [], total: 0 });
  });

  it('a span-only alert without an item list is left out', () => {
    const res = toAlertsForTestResult(RUN, page(1, [alertHit('span', undefined, ['activity_span'])]) as never);
    expect(res).toEqual({ alerts: [], matchedTechniques: [], total: 0 });
  });

  it('an alert-time alert without an item list is listed as today', () => {
    const res = toAlertsForTestResult(RUN, page(1, [alertHit('time', undefined, ['alert_time'])]) as never);
    expect(res.alerts.map((a) => a.alert_id)).toEqual(['time']);
  });

  it('a hit with no matched_queries is treated as today (the CrowdStrike deps)', async () => {
    const search = vi.fn().mockResolvedValueOnce(page(1, [alertHit('cs', undefined)]));
    const res = await findAlertsForTest({ search } as never, RUN, crowdstrike);
    expect(res.alerts.map((a) => a.alert_id)).toEqual(['cs']);
    expect(JSON.stringify(search.mock.calls[0][0].query)).not.toContain('activity_span');
  });

  it('a first tier whose hits are all left out falls through to the technique tier', async () => {
    const spanOnly = () => page(1, [alertHit('span', otherRunOnly, ['activity_span'])]);
    const tech = () => page(1, [alertHit('tech', [ev('lsass.exe', NOW, 'svchost.exe')])]);
    const search = vi.fn().mockResolvedValueOnce(spanOnly()).mockResolvedValueOnce(tech());
    const single = await findAlertsForTest({ search } as never, RUN, defender);
    expect(search).toHaveBeenCalledTimes(2);
    expect(single.alerts.map((a) => a.alert_id)).toEqual(['tech']);

    const msearch = vi.fn()
      .mockResolvedValueOnce({ responses: [spanOnly()] })
      .mockResolvedValueOnce({ responses: [tech()] });
    const [batched] = await findAlertsForTests({ msearch } as never, [RUN], defender);
    expect(msearch).toHaveBeenCalledTimes(2);
    expect(batched?.alerts.map((a) => a.alert_id)).toEqual(['tech']);
  });
});
