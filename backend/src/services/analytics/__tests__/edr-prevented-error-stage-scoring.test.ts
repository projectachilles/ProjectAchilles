import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// An error-coded stage (exit 999, or Falcon's 0xE0000027) that the EDR's own
// alert on that stage says it killed / quarantined / blocked is a scored
// result: the console labels it Prevented, so the Defense Score, the outcome
// breakdown, chain depth and the error rate count it too. "Own alert" is
// `<vendor>_stage_prevented`, or, on docs enriched before that flag existed,
// `<vendor>_stage_detected` + a confirmed `<vendor>_prevention_action`.
// These tests run the real queries against the in-memory ES.

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

import { useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

const useIndex = (docs: Doc[]) => useIndexOn(mockSearch, docs);

const LOCKBIT = 'c3f1a2b4-0000-4000-8000-000000000001';
const LOCKBIT_NAME = 'LockBit 3.0 Double Extortion';

/** Falcon killed this stage, per its own alert on the stage binary. */
const KILLED = {
  'f0rtika.crowdstrike_detected': true,
  'f0rtika.crowdstrike_stage_detected': true,
  'f0rtika.crowdstrike_prevented': true,
  'f0rtika.crowdstrike_prevention_action': 'process_killed',
  'f0rtika.crowdstrike_stage_prevented': true,
};

function stage(at: string, n: number, code: number, flags: Record<string, unknown> = {}): Doc {
  return {
    'routing.oid': 'org-a',
    'routing.hostname': 'h1',
    'routing.event_time': at,
    'f0rtika.category': 'intel-driven',
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
    ...flags,
  };
}

/** Stages 1-2 ran unnoticed (101); stage 3 ended with `code` and `flags`. */
const run = (at: string, code: number, flags: Record<string, unknown> = {}): Doc[] =>
  [stage(at, 1, 101), stage(at, 2, 101), stage(at, 3, code, flags)];

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
const ANY_STAGE: Params = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z', basis: 'latest', scoringMode: 'any-stage' };
const ALL_STAGES: Params = { ...ANY_STAGE, scoringMode: 'all-stages' };
const T0 = '2025-01-10T09:00:00Z';
const T1 = '2025-01-20T09:00:00Z';

describe('EDR-prevented error-coded stages in scoring', () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  describe('basis=latest', () => {
    it('any-stage: a chain whose stage the EDR killed (exit 999) is a protected pair', async () => {
      useIndex(run(T0, 999, KILLED));
      const res = await createService().getDefenseScoreLatest(ANY_STAGE);
      expect([res.pairCount, res.score]).toEqual([1, 100]);
    });

    it('all-stages: the killed stage is its own protected pair', async () => {
      useIndex(run(T0, 999, KILLED));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      // protectedCount is the endpoint's own block (strict); an EDR save is "detected" in the split.
      expect([res.pairCount, res.score, res.protectedCount, res.detectedCount]).toEqual([3, 33.33, 0, 1]);
    });

    it("Falcon's kill code 0xE0000027 counts like 999", async () => {
      useIndex(run(T0, 3758096423, KILLED));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      // protectedCount is the endpoint's own block (strict); an EDR save is "detected" in the split.
      expect([res.pairCount, res.score, res.protectedCount, res.detectedCount]).toEqual([3, 33.33, 0, 1]);
    });

    it('a newer EDR-killed run replaces an older unprotected result of the stage', async () => {
      useIndex([...run(T0, 101), ...run(T1, 999, KILLED)]);
      const pairs = await createService().getLatestPairs(ALL_STAGES);
      const s3 = pairs.find((p) => p.pairKey === `org-a|${LOCKBIT}::LB-003|h1`);
      expect(s3).toMatchObject({ protected: true, strictProtected: false });
    });

    it('older docs (no stage_prevented) count on stage detection + a confirmed action', async () => {
      const legacy = { ...KILLED, 'f0rtika.crowdstrike_stage_prevented': undefined };
      useIndex(run(T0, 999, legacy));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      expect(res.pairCount).toBe(3);
    });

    it('an action that came from a bundle-wide alert (stage_prevented false) does not count', async () => {
      useIndex(run(T0, 999, { ...KILLED, 'f0rtika.crowdstrike_stage_prevented': false }));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      expect(res.pairCount).toBe(2);
    });

    it('an error stage with no EDR evidence stays unscored', async () => {
      useIndex(run(T0, 999));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      expect(res.pairCount).toBe(2);
    });

    it('a failed kill is not prevention', async () => {
      useIndex(run(T0, 999, { ...KILLED, 'f0rtika.crowdstrike_stage_prevented': undefined, 'f0rtika.crowdstrike_prevention_action': 'kill_failed', 'f0rtika.crowdstrike_prevented': undefined }));
      const res = await createService().getDefenseScoreLatest(ALL_STAGES);
      expect(res.pairCount).toBe(2);
    });

    it('the outcome breakdown puts the chain under Prevented', async () => {
      useIndex(run(T0, 999, KILLED));
      const res = await createService().getOutcomeBreakdown(ANY_STAGE);
      expect(res).toMatchObject({ pairCount: 1, prevented: 1, detected: 0, silent: 0, noConclusive: 0 });
    });
  });

  describe('basis=executions', () => {
    it('counts the killed stage as a protected execution (EDR save, so in detectedCount)', async () => {
      useIndex(run(T0, 999, KILLED));
      const res = await createService().getDefenseScore({ from: ANY_STAGE.from, to: ANY_STAGE.to });
      expect(res).toMatchObject({ totalExecutions: 3, score: 33.33, protectedCount: 0, detectedCount: 1 });
    });
  });

  describe('chain depth', () => {
    it('a chain the EDR stopped at stage 3 lands in the stage-3 bucket, not end to end or inconclusive', async () => {
      useIndex(run(T0, 999, KILLED));
      const res = await createService().getChainDepth(ANY_STAGE);
      expect(res).toMatchObject({ chains: 1, endToEnd: 0, inconclusive: 0 });
      expect(res.buckets[2]).toEqual({ stage: 3, blocked: 1, alertedNotBlocked: 0, bundleNames: [LOCKBIT_NAME] });
    });

    it('an earlier stage that alerted is "alerted before the stop"', async () => {
      useIndex([
        stage(T0, 1, 101, { 'f0rtika.defender_detected': true, 'f0rtika.defender_stage_detected': true }),
        stage(T0, 2, 101),
        stage(T0, 3, 999, KILLED),
      ]);
      const res = await createService().getChainDepth(ANY_STAGE);
      expect(res.buckets[2]).toMatchObject({ blocked: 1, alertedNotBlocked: 1 });
    });

    it('an error stage with no EDR evidence keeps the run inconclusive', async () => {
      useIndex(run(T0, 999));
      const res = await createService().getChainDepth(ANY_STAGE);
      expect(res).toMatchObject({ chains: 0, inconclusive: 1 });
    });
  });

  describe('error rate', () => {
    it('an EDR-stopped stage is a conclusive result, not a test error', async () => {
      useIndex([...run(T0, 999, KILLED), stage(T0, 4, 999)]);
      const res = await createService().getErrorRate({ from: ANY_STAGE.from, to: ANY_STAGE.to });
      expect(res).toMatchObject({ errorCount: 1, conclusiveCount: 3 });
    });
  });
});
