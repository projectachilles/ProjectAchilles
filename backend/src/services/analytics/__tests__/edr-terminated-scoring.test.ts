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

import { matches, useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

const useIndex = (docs: Doc[]) => useIndexOn(mockSearch, docs);

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

  describe('basis=latest, all-stages', () => {
    const ALL_STAGES: Params = { ...LATEST, scoringMode: 'all-stages' };

    it('a bundle kill doc adds no pair: stage pairs only (spec 5.2)', async () => {
      useIndex([...realRun(T0), killDoc(T1)]);
      const pairs = await createService().getLatestPairs(ALL_STAGES);
      expect(pairs.map(p => p.pairKey).sort()).toEqual([1, 2, 3].map(n => `org-a|${LOCKBIT}::LB-00${n}|h1`));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      expect([res.pairCount, res.score]).toEqual([3, 0]);
    });

    it('scoringMode omitted behaves as all-stages', async () => {
      const noMode: Params = { from: LATEST.from, to: LATEST.to, basis: 'latest' };
      useIndex([...realRun(T0), killDoc(T1)]);
      const res = await createService().getDefenseScoreLatest(noMode);
      expect(res.pairCount).toBe(3);
    });

    it('a standalone kill doc is still a per-doc pair', async () => {
      useIndex([killDoc(T1, { bundle: false }), standaloneDoc(T0, 101)]);
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
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
