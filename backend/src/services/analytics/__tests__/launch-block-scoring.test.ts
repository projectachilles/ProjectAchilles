import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// EDR launch blocks: a 260 result an EDR's own prevention alert proved was
// that EDR blocking the test orchestrator at launch is rewritten in place to
// a whole-test Protected doc (event.ERROR 126, f0rtika.edr_launch_blocked,
// and for a multi-stage test f0rtika.bundle_id without is_bundle_control).
// It counts for the test in the Defense Score and never for a technique, like
// an EDR-killed run. The real queries run against a small in-memory ES.

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

import { matches, useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

const useIndex = (docs: Doc[]) => useIndexOn(mockSearch, docs);

const CHAIN = 'c0ffee00-1234-4abc-8def-000000000001';
const CHAIN_NAME = 'Example Orchestrated Test';
const SINGLE = 'c0ffee00-1234-4abc-8def-000000000002';

const base = (at: string, host = 'h1'): Doc => ({
  'routing.oid': 'org-a',
  'routing.hostname': host,
  'routing.event_time': at,
  'f0rtika.category': 'intel-driven',
});

const stage = (at: string, n: number, code: number, technique: string, host = 'h1'): Doc => ({
  ...base(at, host),
  'f0rtika.test_uuid': `${CHAIN}::T${n}`,
  'f0rtika.test_name': `${CHAIN_NAME} - Stage ${n}`,
  'f0rtika.bundle_id': CHAIN,
  'f0rtika.bundle_name': CHAIN_NAME,
  'f0rtika.is_bundle_control': true,
  'f0rtika.control_id': `T${n}`,
  'f0rtika.control_validator': `Stage ${n}`,
  'f0rtika.techniques': [technique],
  'event.ERROR': code,
  'f0rtika.is_protected': code === 126,
});

/** A resolved launch block, as launch-block-reconcile.service.ts leaves the 260 doc. */
function launchBlocked(at: string, opts: { bundle: boolean; host?: string } = { bundle: true }): Doc {
  return {
    ...base(at, opts.host),
    'f0rtika.test_uuid': opts.bundle ? CHAIN : SINGLE,
    'f0rtika.test_name': opts.bundle ? CHAIN_NAME : 'Example Single-Binary Test',
    ...(opts.bundle ? { 'f0rtika.bundle_id': CHAIN, 'f0rtika.bundle_name': CHAIN_NAME } : {}),
    'f0rtika.techniques': ['T1105', 'T1572'],
    'event.ERROR': 126,
    'f0rtika.error_name': 'ExecutionPrevented',
    'f0rtika.is_protected': true,
    'f0rtika.edr_launch_blocked': true,
    'f0rtika.crowdstrike_detected': true,
    'f0rtika.crowdstrike_prevented': true,
    'f0rtika.crowdstrike_prevention_action': 'quarantined',
  };
}

/** The same run before reconciliation: inconclusive. */
const unresolved = (at: string): Doc => ({
  ...base(at),
  'f0rtika.test_uuid': SINGLE,
  'f0rtika.test_name': 'Example Single-Binary Test',
  'f0rtika.techniques': ['T1105'],
  'event.ERROR': 260,
  'f0rtika.is_protected': false,
});

const unprotectedSingle = (at: string, host = 'h1'): Doc => ({
  ...base(at, host),
  'f0rtika.test_uuid': 'c0ffee00-1234-4abc-8def-000000000003',
  'f0rtika.test_name': 'Other Test',
  'f0rtika.techniques': ['T1105'],
  'event.ERROR': 101,
  'f0rtika.is_protected': false,
});

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

describe('EDR launch blocks in the Defense Score', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
  });

  it('a bundle launch-block doc is scored with its bundle, a standalone one per doc', () => {
    const svc = createService() as any;
    const route = (doc: Doc) => ({ perDoc: matches(svc.PER_DOC_FILTER, doc), perBundle: matches(svc.PER_BUNDLE_FILTER, doc) });
    expect(route(launchBlocked(T0))).toEqual({ perDoc: false, perBundle: true });
    expect(route(launchBlocked(T0, { bundle: false }))).toEqual({ perDoc: true, perBundle: false });
  });

  it('basis=latest: the resolved standalone run counts as a protected pair (it did not before)', async () => {
    useIndex([unresolved(T1), unprotectedSingle(T0)]);
    const before = await createService().getDefenseScoreLatest(LATEST);
    expect([before.pairCount, before.score]).toEqual([1, 0]);

    useIndex([launchBlocked(T1, { bundle: false }), unprotectedSingle(T0)]);
    const after = await createService().getDefenseScoreLatest(LATEST);
    expect([after.pairCount, after.score, after.protectedCount]).toEqual([2, 50, 1]);
  });

  it('basis=latest: a multi-stage launch block is the latest run of its bundle pair, not a second pair', async () => {
    useIndex([stage(T0, 1, 101, 'T1105'), stage(T0, 2, 101, 'T1572'), launchBlocked(T1)]);
    const pairs = await createService().getLatestPairs(LATEST);
    expect(pairs.map((p) => [p.pairKey, p.protected])).toEqual([[`org-a|bundle:${CHAIN}|h1`, true]]);
  });

  it('basis=latest: a newer real run replaces the launch block', async () => {
    useIndex([launchBlocked(T0), stage(T1, 1, 101, 'T1105'), stage(T1, 2, 101, 'T1572')]);
    const res = await createService().getDefenseScoreLatest(LATEST);
    expect([res.pairCount, res.score]).toEqual([1, 0]);
  });

  it('basis=executions counts the resolved doc as protected', async () => {
    useIndex([launchBlocked(T1, { bundle: false }), unprotectedSingle(T0)]);
    const res = await createService().getDefenseScore({ from: LATEST.from, to: LATEST.to });
    expect(res).toMatchObject({ totalExecutions: 2, protectedCount: 1, score: 50 });
  });

  it('chain depth counts a multi-stage launch block as blocked at stage 1', async () => {
    useIndex([stage(T0, 1, 101, 'T1105'), stage(T0, 2, 101, 'T1572'), launchBlocked(T1)]);
    const res = await createService().getChainDepth(LATEST);
    expect(res.chains).toBe(1);
    expect(res.agentTerminated).toBe(0);
    expect(res.buckets[0]).toEqual({ stage: 1, blocked: 1, alertedNotBlocked: 0, bundleNames: [CHAIN_NAME] });
  });
});

describe('EDR launch blocks in technique views', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
  });

  it('getTechniqueDistributionLatest: a launch-blocked run credits no technique', async () => {
    useIndex([launchBlocked(T1, { bundle: false }), launchBlocked(T1), unprotectedSingle(T0)]);
    const items = await createService().getTechniqueDistributionLatest(LATEST);
    expect(items).toEqual([{ technique: 'T1105', protected: 0, unprotected: 1 }]);
  });

  it('getTechniqueOutcomes: a launch-blocked run credits no technique', async () => {
    useIndex([launchBlocked(T1, { bundle: false }), stage(T0, 1, 126, 'T1105', 'h2')]);
    const items = await createService().getTechniqueOutcomes(LATEST);
    expect(items.map((i) => [i.technique, i.protected, i.unprotected])).toEqual([['T1105', 1, 0]]);
  });

  it('executions-basis technique breakdowns exclude launch-blocked docs', async () => {
    const svc = createService();
    await svc.getDefenseScoreByTechnique({ from: LATEST.from, to: LATEST.to });
    await svc.getTechniqueDistribution({ from: LATEST.from, to: LATEST.to });
    for (const [req] of mockSearch.mock.calls) {
      const filters = req.query.bool.filter as unknown[];
      expect(filters.some((f) => !matches(f, launchBlocked(T1, { bundle: false })))).toBe(true);
    }
  });
});

describe('execution rows', () => {
  it('carry the launch-block fields the UI keys on', async () => {
    mockSearch.mockReset();
    const svc = createService() as any;
    const row = svc.mapHitToExecution({
      _id: 'x',
      _source: {
        event: { ERROR: 126 },
        f0rtika: {
          test_uuid: SINGLE, is_protected: true, edr_launch_blocked: true,
          launch_block: { original_exit_code: 260, vendors: ['crowdstrike'], alert_ids: ['cs-1'], evidence: 'task_path' },
        },
      },
    });
    expect(row).toMatchObject({
      edr_launch_blocked: true,
      launch_block_vendors: ['crowdstrike'],
      launch_block_alert_ids: ['cs-1'],
    });
    const plain = svc.mapHitToExecution({ _id: 'y', _source: { event: { ERROR: 101 }, f0rtika: { test_uuid: SINGLE } } });
    expect(plain.edr_launch_blocked).toBe(false);
    expect(plain.launch_block_vendors).toBeUndefined();
  });
});
