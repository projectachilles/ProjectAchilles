import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// Stage coverage card: stages caught in each attack chain's latest run, and
// how many chains rest on a single caught stage. The real queries run against
// a small in-memory ES, so the run grouping and the filters are exercised.

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

const CHAIN = 'c0ffee00-1234-4abc-8def-000000000001';
const CHAIN_NAME = 'Chain A';
const OTHER = 'c0ffee00-1234-4abc-8def-000000000009';

const OWN = { 'f0rtika.crowdstrike_detected': true, 'f0rtika.crowdstrike_stage_detected': true };
const WIDE = { 'f0rtika.crowdstrike_detected': true };

interface StageOpts {
  host?: string;
  flags?: Doc;
  validator?: string;
  bundle?: string;
  name?: string;
}

/** One stage doc of a run. code 0 = Skipped (the orchestrator stopped before it). */
function stage(at: string, n: number, code: number, opts: StageOpts = {}): Doc {
  const bundle = opts.bundle ?? CHAIN;
  const name = opts.name ?? CHAIN_NAME;
  return {
    'routing.oid': 'org-a',
    'routing.hostname': opts.host ?? 'host-1',
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
    'f0rtika.test_uuid': `${bundle}::T${n}`,
    'f0rtika.test_name': `${name} - Stage ${n}`,
    'f0rtika.bundle_id': bundle,
    'f0rtika.bundle_name': name,
    'f0rtika.is_bundle_control': true,
    'f0rtika.control_id': `T${n}`,
    'f0rtika.control_validator': opts.validator ?? `Stage ${n}`,
    'f0rtika.techniques': [`T100${n}`],
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126,
    ...(opts.flags ?? {}),
  };
}

/** A whole-test doc with no stages: the EDR killed the agent, or blocked the test at launch. */
function stageless(at: string, host: string, flag: 'edr_terminated' | 'edr_launch_blocked'): Doc {
  return {
    'routing.oid': 'org-a',
    'routing.hostname': host,
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
    'f0rtika.test_uuid': CHAIN,
    'f0rtika.test_name': CHAIN_NAME,
    'f0rtika.bundle_id': CHAIN,
    'f0rtika.bundle_name': CHAIN_NAME,
    'f0rtika.techniques': ['T1001'],
    'event.ERROR': 126,
    'f0rtika.is_protected': true,
    [`f0rtika.${flag}`]: true,
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
const RANGE: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z' };
const T0 = '2025-01-10T09:00:00Z';
const T1 = '2025-01-20T09:00:00Z';

/** Ran all four stages: stage 2 blocked, stage 3 detected on its own alert. */
const layeredRun = (at: string, host = 'host-1'): Doc[] => [
  stage(at, 1, 101, { host }),
  stage(at, 2, 126, { host }),
  stage(at, 3, 101, { host, flags: OWN }),
  stage(at, 4, 101, { host }),
];

/** Blocked at stage 1; the orchestrator stopped and reported the rest as Skipped. */
const stoppedRun = (at: string, host = 'host-1'): Doc[] => [
  stage(at, 1, 126, { host }),
  stage(at, 2, 0, { host }),
  stage(at, 3, 0, { host }),
  stage(at, 4, 0, { host }),
];

describe('getStageCoverage', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
    mockExclusion.mockReset();
    mockExclusion.mockResolvedValue(null);
  });

  it('counts the blocked, detected and skipped stages of each chain latest run', async () => {
    useIndex([...layeredRun(T0, 'host-1'), ...stoppedRun(T0, 'host-2')]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res).toMatchObject({
      chains: 2,
      chainsProtected: 2,
      stagesRan: 5,
      blocked: 2,
      detected: 1,
      through: 2,
      coverage: 60,
    });
    expect(res.layered).toEqual({ count: 1, bundleNames: [CHAIN_NAME] });
    expect(res.depthNotTested).toEqual({ count: 1, bundleNames: [CHAIN_NAME] });
    expect(res.singleStage.count).toBe(0);
    expect(res.noneCaught.count).toBe(0);
  });

  it('a chain that ran every stage with one caught rests on a single stage', async () => {
    useIndex([stage(T0, 1, 101), stage(T0, 2, 126), stage(T0, 3, 101)]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res.singleStage).toEqual({ count: 1, bundleNames: [CHAIN_NAME] });
    expect(res).toMatchObject({ stagesRan: 3, blocked: 1, detected: 0, through: 2 });
  });

  it('uses only the latest run of a chain', async () => {
    useIndex([
      stage(T0, 1, 101), stage(T0, 2, 101), stage(T0, 3, 101), // older: nothing caught
      stage(T1, 1, 101), stage(T1, 2, 126), stage(T1, 3, 101), // latest: one blocked
    ]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res.chains).toBe(1);
    expect(res.singleStage.count).toBe(1);
    expect(res.noneCaught.count).toBe(0);
    expect(res.stagesRan).toBe(3);
  });

  it('ignores the skipped stages of an older run', async () => {
    useIndex([
      stage(T0, 1, 126), stage(T0, 2, 0), stage(T0, 3, 0), // older run stopped at stage 1
      stage(T1, 1, 101), stage(T1, 2, 126), stage(T1, 3, 101), // latest ran every stage
    ]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res.singleStage.count).toBe(1);
    expect(res.depthNotTested.count).toBe(0);
  });

  it('a chain blocked once whose later stages errored is depth not tested, not single stage', async () => {
    // Chain depth keeps this run (its errors all come after the block), but
    // the errored stages never produced a result, so nothing says the chain
    // rests on that one stage.
    useIndex([stage(T0, 1, 126), stage(T0, 2, 999), stage(T0, 3, 999), stage(T0, 4, 260)]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res.chains).toBe(1);
    expect(res.depthNotTested.count).toBe(1);
    expect(res.singleStage.count).toBe(0);
  });

  it('leaves out runs the EDR stopped before any stage', async () => {
    useIndex([stageless(T0, 'host-1', 'edr_terminated'), stageless(T0, 'host-2', 'edr_launch_blocked')]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res).toMatchObject({ chains: 0, stagesRan: 0, coverage: null });
  });

  it('counts stages that have no "Stage N" validator', async () => {
    const v = { validator: 'Custom check' };
    useIndex([stage(T0, 1, 101, v), stage(T0, 2, 126, v), stage(T0, 3, 101, { ...v, flags: OWN })]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res).toMatchObject({ chains: 1, stagesRan: 3, blocked: 1, detected: 1, through: 1 });
    expect(res.layered.count).toBe(1);
  });

  it('does not count a stage for an alert that named only the bundle', async () => {
    useIndex([stage(T0, 1, 101, { flags: WIDE }), stage(T0, 2, 101, { flags: WIDE })]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res).toMatchObject({ chains: 1, chainsProtected: 1, detected: 0, through: 2 });
    expect(res.noneCaught.count).toBe(1);
  });

  it('counts an error-coded stage the EDR stopped as blocked, once', async () => {
    const killed = {
      'f0rtika.crowdstrike_detected': true,
      'f0rtika.crowdstrike_stage_detected': true,
      'f0rtika.crowdstrike_prevented': true,
      'f0rtika.crowdstrike_prevention_action': 'process_killed',
      'f0rtika.crowdstrike_stage_prevented': true,
    };
    useIndex([stage(T0, 1, 101), stage(T0, 2, 999, { flags: killed }), stage(T0, 3, 126)]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res).toMatchObject({ chains: 1, stagesRan: 3, blocked: 2, detected: 0, through: 1 });
    expect(res.layered.count).toBe(1);
  });

  it('a chain nothing caught is not protected', async () => {
    useIndex([stage(T0, 1, 101), stage(T0, 2, 101)]);
    const res = await createService().getStageCoverage(RANGE);
    expect(res).toMatchObject({ chains: 1, chainsProtected: 0, coverage: 0 });
    expect(res.noneCaught).toEqual({ count: 1, bundleNames: [CHAIN_NAME] });
  });

  it('applies risk acceptances to the skipped stages too', async () => {
    // The skipped stages 2-4 are risk-accepted, so none of them is left to
    // say the run stopped early. Without the exclusion on the skipped-stage
    // query the run would still read as "depth not tested".
    mockExclusion.mockResolvedValue({
      bool: { must_not: [{ terms: { 'f0rtika.control_id': ['T2', 'T3', 'T4'] } }] },
    });
    useIndex(stoppedRun(T0));
    const accepted = await createService().getStageCoverage(RANGE);
    expect(accepted.singleStage.count).toBe(1);
    expect(accepted.depthNotTested.count).toBe(0);
  });

  it('follows the filter bar', async () => {
    useIndex([
      ...layeredRun(T0),
      stage(T0, 1, 101, { bundle: OTHER, name: 'Chain B' }),
      stage(T0, 2, 101, { bundle: OTHER, name: 'Chain B' }),
    ]);
    const all = await createService().getStageCoverage(RANGE);
    expect(all.chains).toBe(2);
    const one = await createService().getStageCoverage({ ...RANGE, bundleNames: 'Chain B' });
    expect(one).toMatchObject({ chains: 1, stagesRan: 2 });
    expect(one.noneCaught.bundleNames).toEqual(['Chain B']);
  });

  it('has the same chains as chain depth, minus the runs with no stages', async () => {
    useIndex([
      ...layeredRun(T0, 'host-1'),
      ...stoppedRun(T0, 'host-2'),
      stageless(T0, 'host-3', 'edr_terminated'),
      stageless(T0, 'host-4', 'edr_launch_blocked'),
    ]);
    const svc = createService();
    const [coverage, depth] = await Promise.all([svc.getStageCoverage(RANGE), svc.getChainDepth(RANGE)]);
    expect(depth.chains).toBe(4);
    expect(coverage.chains).toBe(depth.chains - 2);
  });
});
