import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PairRun } from '../posture.js';
import type { AnalyticsSettings } from '../../../types/analytics.js';
import { useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

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

const { ElasticsearchService, pairControlId } = await import('../elasticsearch.js');
const { getTestFleet } = await import('../testFleet.js');

const CHAIN = 'a1b2c3d4-0000-4000-8000-000000000001';
const SOLO = 'b2c3d4e5-0000-4000-8000-000000000002';

const run = (pairKey: string, ts: number, verdict: 'blocked' | 'detected' | 'through'): PairRun => ({
  pairKey,
  ts,
  protected: verdict !== 'through',
  strictProtected: verdict === 'blocked',
  errorCodes: [],
  errorNames: [],
  hostname: pairKey.split('|')[2],
  testName: '',
  techniques: [],
});

type Call = { scoringMode?: string; excludeEdrTerminated?: boolean; testUuid?: string };

/** A service double whose getLatestPairs answers per (scoringMode, excludeEdrTerminated). */
function fakeEs(sets: { anyStage: PairRun[]; anyStageNoStageless: PairRun[]; allStages: PairRun[] }, labels = {}) {
  const getLatestPairs = vi.fn(async (p: Call) => {
    if (p.scoringMode === 'all-stages') return p.excludeEdrTerminated ? sets.allStages : [];
    return p.excludeEdrTerminated ? sets.anyStageNoStageless : sets.anyStage;
  });
  const getControlLabels = vi.fn(async () => labels);
  return { es: { getLatestPairs, getControlLabels } as any, getLatestPairs, getControlLabels };
}

describe('getTestFleet', () => {
  it('counts each stage blocked / detected / through across hosts', async () => {
    const bundle = (h: string) => `o1|bundle:${CHAIN}|${h}`;
    const stage = (h: string) => `o1|${CHAIN}::T1055|${h}`;
    const { es, getLatestPairs } = fakeEs(
      {
        anyStage: [run(bundle('h1'), 100, 'blocked'), run(bundle('h2'), 200, 'blocked'), run(bundle('h3'), 300, 'detected')],
        anyStageNoStageless: [run(bundle('h1'), 100, 'blocked'), run(bundle('h2'), 200, 'blocked'), run(bundle('h3'), 300, 'detected')],
        allStages: [run(stage('h1'), 100, 'blocked'), run(stage('h2'), 200, 'blocked'), run(stage('h3'), 300, 'detected')],
      },
      { T1055: { validator: 'Stage 1', description: 'Inject into a process' } },
    );

    const res = await getTestFleet(es, CHAIN, { org: 'o1' });

    expect(res.stages).toEqual([
      {
        controlId: 'T1055',
        validator: 'Stage 1',
        description: 'Inject into a process',
        blocked: 2,
        detected: 1,
        through: 0,
        hosts: 3,
        lastRunAt: new Date(300).toISOString(),
      },
    ]);
    expect(res.headline).toEqual({ hostCount: 3, pairCount: 3, stoppedCount: 3, lastRunAt: new Date(300).toISOString() });
    expect(res.stoppedBeforeStage).toBe(0);

    // Every read is scoped to the test, with the fixed window and latest basis.
    for (const [p] of getLatestPairs.mock.calls) {
      expect(p).toMatchObject({ testUuid: CHAIN, from: 'now-90d', to: 'now', basis: 'latest', org: 'o1' });
    }
    expect(getLatestPairs.mock.calls.map(([p]) => [p.scoringMode, !!p.excludeEdrTerminated])).toEqual(
      expect.arrayContaining([['any-stage', false], ['any-stage', true], ['all-stages', true]]),
    );
  });

  it('a host whose latest run is stageless counts as stopped before any stage, not in stage counts', async () => {
    const bundle = (h: string) => `o1|bundle:${CHAIN}|${h}`;
    const stage = (h: string) => `o1|${CHAIN}::T1055|${h}`;
    const { es } = fakeEs({
      // h2's newest any-stage run is an EDR kill / launch block (newer than its last real run).
      anyStage: [run(bundle('h1'), 100, 'through'), run(bundle('h2'), 500, 'blocked'), run(bundle('h3'), 600, 'blocked')],
      anyStageNoStageless: [run(bundle('h1'), 100, 'through'), run(bundle('h2'), 50, 'through')],
      // h3 never ran a real stage: no (b) pair at all.
      allStages: [run(stage('h1'), 100, 'through'), run(stage('h2'), 50, 'through')],
    });

    const res = await getTestFleet(es, CHAIN, {});

    expect(res.stoppedBeforeStage).toBe(2);
    expect(res.headline).toEqual({ hostCount: 3, pairCount: 3, stoppedCount: 2, lastRunAt: new Date(600).toISOString() });
    // Stage counts follow the per-stage rule: the stageless runs add nothing.
    expect(res.stages).toEqual([
      { controlId: 'T1055', blocked: 0, detected: 0, through: 2, hosts: 2, lastRunAt: new Date(100).toISOString() },
    ]);
  });

  it('a standalone single-binary test has no stages', async () => {
    const solo = (h: string) => `o1|${SOLO}|${h}`;
    const { es } = fakeEs({
      anyStage: [run(solo('h1'), 100, 'blocked')],
      anyStageNoStageless: [run(solo('h1'), 100, 'blocked')],
      allStages: [run(solo('h1'), 100, 'blocked')],
    });
    const res = await getTestFleet(es, SOLO, {});
    expect(res.stages).toEqual([]);
    expect(res.headline).toEqual({ hostCount: 1, pairCount: 1, stoppedCount: 1, lastRunAt: new Date(100).toISOString() });
  });

  it('a cyber-hygiene bundle (one pair per control) reports pairs apart from hosts', async () => {
    const control = (c: string) => `o1|${CHAIN}::${c}|h1`;
    const runs = [run(control('CH-001'), 100, 'blocked'), run(control('CH-002'), 100, 'detected'), run(control('CH-003'), 100, 'through')];
    const { es } = fakeEs({ anyStage: runs, anyStageNoStageless: runs, allStages: runs });
    const res = await getTestFleet(es, CHAIN, {});
    expect(res.headline).toEqual({ hostCount: 1, pairCount: 3, stoppedCount: 2, lastRunAt: new Date(100).toISOString() });
    expect(res.stoppedBeforeStage).toBe(0);
    expect(res.stages.map(s => s.controlId)).toEqual(['CH-001', 'CH-002', 'CH-003']);
  });

  it('no results: empty headline', async () => {
    const { es } = fakeEs({ anyStage: [], anyStageNoStageless: [], allStages: [] });
    expect(await getTestFleet(es, SOLO, {})).toEqual({
      headline: { hostCount: 0, pairCount: 0, stoppedCount: 0, lastRunAt: null },
      stages: [],
      stoppedBeforeStage: 0,
    });
  });
});

describe('pairControlId', () => {
  it('gives the control id of a per-stage pair only', () => {
    expect(pairControlId(`o1|${CHAIN}::T1055|h1`)).toBe('T1055');
    expect(pairControlId(`o1|${SOLO}|h1`)).toBeUndefined();
    expect(pairControlId(`o1|bundle:${CHAIN}|h1`)).toBeUndefined();
  });
});

// End to end against the in-memory ES: the real scope clauses and pair rules.
describe('getTestFleet with the posture pipeline', () => {
  const T0 = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const T1 = new Date(Date.now() - 2 * 86_400_000).toISOString();

  const base = (at: string, host: string): Doc => ({
    'routing.oid': 'org-a',
    'routing.hostname': host,
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
  });
  const stageDoc = (at: string, host: string, technique: string, code: number, detected = false): Doc => ({
    ...base(at, host),
    'f0rtika.test_uuid': `${CHAIN}::${technique}`,
    'f0rtika.test_name': 'Chain',
    'f0rtika.bundle_id': CHAIN,
    'f0rtika.bundle_name': 'Chain',
    'f0rtika.is_bundle_control': true,
    'f0rtika.control_id': technique,
    'f0rtika.control_validator': 'Stage 1',
    'f0rtika.control_description': 'Inject into a process',
    'f0rtika.techniques': [technique],
    'event.ERROR': code,
    'f0rtika.is_protected': code === 126,
    ...(detected ? { 'f0rtika.defender_detected': true } : {}),
  });
  const killDoc = (at: string, host: string): Doc => ({
    ...base(at, host),
    'f0rtika.test_uuid': CHAIN,
    'f0rtika.test_name': 'Chain',
    'f0rtika.bundle_id': CHAIN,
    'f0rtika.bundle_name': 'Chain',
    'f0rtika.techniques': ['T1055'],
    'event.ERROR': 126,
    'f0rtika.is_protected': true,
    'f0rtika.edr_terminated': true,
  });
  const otherTest = (at: string, host: string): Doc => ({
    ...base(at, host),
    'f0rtika.test_uuid': SOLO,
    'f0rtika.test_name': 'Other',
    'f0rtika.techniques': ['T1003'],
    'event.ERROR': 101,
    'f0rtika.is_protected': false,
  });

  const settings: AnalyticsSettings = {
    connectionType: 'direct',
    node: 'http://localhost:9200',
    apiKey: 'test-key',
    indexPattern: 'achilles-results-*',
    configured: true,
  };

  beforeEach(() => {
    mockSearch.mockReset();
  });

  it('matches the per-stage and any-stage rules, scoped to the test', async () => {
    useIndexOn(mockSearch, [
      stageDoc(T0, 'h1', 'T1055', 126),
      stageDoc(T0, 'h2', 'T1055', 101, true),
      stageDoc(T0, 'h3', 'T1055', 101),
      stageDoc(T0, 'h4', 'T1055', 101),
      killDoc(T1, 'h4'), // newest run on h4: the EDR killed the agent
      otherTest(T1, 'h5'),
    ]);
    const res = await getTestFleet(new ElasticsearchService(settings), CHAIN, {});

    expect(res.headline).toEqual({ hostCount: 4, pairCount: 4, stoppedCount: 3, lastRunAt: T1 });
    expect(res.stoppedBeforeStage).toBe(1);
    expect(res.stages).toEqual([
      {
        controlId: 'T1055',
        validator: 'Stage 1',
        description: 'Inject into a process',
        blocked: 1,
        detected: 1,
        through: 2,
        hosts: 4,
        lastRunAt: T0,
      },
    ]);
  });
});
