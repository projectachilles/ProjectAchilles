import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings, AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../../types/analytics.js';

// Per-stage views must judge a stage by its OWN evidence. On a bundle control
// the wide `<vendor>_detected` flag only means some alert named the bundle
// (any stage, or the orchestrator), so it must not mark that stage detected:
// a stage counts as detected only when the vendor's stage query matched
// (`_stage_detected`; a vendor prevention on a conclusive stage always has it).
// Standalone docs keep the wide flag (it is their own detection), and
// chain-level (any-stage bundle) verdicts keep it too: an alert naming the
// chain did detect the chain. The real queries run against a small in-memory ES.

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
const { edrOwnDetectedClause } = await import('../../outcomes/vendors.js');
const { detectedClause } = await import('../technique-coverage.js');

import { matches, useIndex as useIndexOn } from './helpers/inMemoryEs.js';
import type { Doc } from './helpers/inMemoryEs.js';

const useIndex = (docs: Doc[]) => useIndexOn(mockSearch, docs);

const CHAIN = 'c0ffee00-1234-4abc-8def-0000000000a1';
const CHAIN_NAME = 'Example Orchestrated Test';
const SINGLE = 'c0ffee00-1234-4abc-8def-0000000000a2';

const base = (at: string, host = 'h1'): Doc => ({
  'routing.oid': 'org-a',
  'routing.hostname': host,
  'routing.event_time': at,
  'f0rtika.category': 'intel-driven',
});

type Flags = Record<string, boolean>;

const stage = (at: string, n: number, code: number, technique: string, flags: Flags = {}): Doc => ({
  ...base(at),
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
  ...Object.fromEntries(Object.entries(flags).map(([k, v]) => [`f0rtika.${k}`, v])),
});

const standalone = (at: string, technique: string, flags: Flags = {}): Doc => ({
  ...base(at),
  'f0rtika.test_uuid': SINGLE,
  'f0rtika.test_name': 'Example Single-Binary Test',
  'f0rtika.techniques': [technique],
  'event.ERROR': 101,
  'f0rtika.is_protected': false,
  ...Object.fromEntries(Object.entries(flags).map(([k, v]) => [`f0rtika.${k}`, v])),
});

/** The enrichment pass sets the wide flag on every stage doc of a bundle an alert named. */
const WIDE = { crowdstrike_detected: true };
const OWN = { crowdstrike_detected: true, crowdstrike_stage_detected: true };

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

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ hits: { hits: [], total: { value: 0 } }, aggregations: {} });
});

describe('edrOwnDetectedClause', () => {
  it('credits a stage for its own stage match, never for the bundle-wide flag', () => {
    const q = edrOwnDetectedClause();
    expect(matches(q, stage(T0, 1, 101, 'T1105', OWN))).toBe(true);
    expect(matches(q, stage(T0, 2, 101, 'T1036', WIDE))).toBe(false);
    expect(matches(q, stage(T0, 3, 101, 'T1041', { sophos_detected: true, sophos_stage_detected: true, sophos_prevented: true }))).toBe(true);
    // A prevention without a detection stays silent, as in the score.
    expect(matches(q, standalone(T0, 'T1218', { sophos_prevented: true }))).toBe(false);
    expect(matches(q, standalone(T0, 'T1218', { defender_detected: true }))).toBe(true);
    expect(matches(q, standalone(T0, 'T1218'))).toBe(false);
  });

  it('agrees with the vendor tiles\' detectedClause on the flag sets enrichment writes', () => {
    const docs = [
      stage(T0, 1, 101, 'T1105', OWN),
      stage(T0, 2, 101, 'T1036', WIDE),
      stage(T0, 3, 101, 'T1041', { sentinelone_detected: true, sentinelone_stage_detected: true, sentinelone_prevented: true }),
      standalone(T0, 'T1218', { defender_detected: true }),
      standalone(T0, 'T1218'),
    ];
    for (const doc of docs) {
      const anyVendor = (['crowdstrike', 'defender', 'sentinelone', 'sophos'] as const)
        .some((v) => matches(detectedClause(v), doc));
      expect(matches(edrOwnDetectedClause(), doc)).toBe(anyVendor);
    }
  });
});

describe('per-stage views do not credit a stage for a sibling\'s detection', () => {
  const chainRun = () => [
    stage(T0, 1, 101, 'T1105', OWN),
    stage(T0, 2, 101, 'T1036', WIDE),
    stage(T0, 3, 101, 'T1041', { defender_detected: true, defender_stage_detected: true, defender_prevented: true }),
    standalone(T0, 'T1218', { defender_detected: true }),
  ];

  it('getTechniqueDistributionLatest', async () => {
    useIndex(chainRun());
    const items = await createService().getTechniqueDistributionLatest(LATEST);
    const byTech = Object.fromEntries(items.map((i) => [i.technique, [i.protected, i.unprotected]]));
    expect(byTech).toEqual({
      T1105: [1, 0],
      T1036: [0, 1],
      T1041: [1, 0],
      T1218: [1, 0],
    });
  });

  it('getTechniqueOutcomes', async () => {
    useIndex(chainRun());
    const items = await createService().getTechniqueOutcomes(LATEST);
    const byTech = Object.fromEntries(items.map((i) => [i.technique, [i.protected, i.detected, i.unprotected]]));
    expect(byTech.T1036).toEqual([0, 0, 1]);
    expect(byTech.T1105).toEqual([0, 1, 0]);
    expect(byTech.T1218).toEqual([0, 1, 0]);
  });

  it('a chain-level (any-stage) pair still counts an alert that named only the bundle', async () => {
    useIndex([stage(T0, 1, 101, 'T1105', WIDE), stage(T0, 2, 101, 'T1036', WIDE)]);
    const pairs = await createService().getLatestPairs(LATEST);
    expect(pairs.map((p) => [p.pairKey, p.protected])).toEqual([[`org-a|bundle:${CHAIN}|h1`, true]]);
  });
});

describe('chain depth: "alerted before the block" needs an alert on an earlier stage itself', () => {
  it('a sibling-only flag on the stages before the block is not an earlier alert', async () => {
    // Blocked at stage 3; the only alert named stage 4, which ran after the block.
    useIndex([
      stage(T0, 1, 101, 'T1105', WIDE),
      stage(T0, 2, 101, 'T1036', WIDE),
      stage(T0, 3, 126, 'T1003.001', WIDE),
      stage(T0, 4, 101, 'T1486', OWN),
    ]);
    const res = await createService().getChainDepth(LATEST);
    expect(res.buckets[2]).toMatchObject({ stage: 3, blocked: 1, alertedNotBlocked: 0 });
  });

  it('an alert on an earlier stage itself still counts', async () => {
    useIndex([
      stage(T0, 1, 101, 'T1105', OWN),
      stage(T0, 2, 101, 'T1036', WIDE),
      stage(T0, 3, 126, 'T1003.001', WIDE),
    ]);
    const res = await createService().getChainDepth(LATEST);
    expect(res.buckets[2]).toMatchObject({ stage: 3, blocked: 1, alertedNotBlocked: 1 });
  });

  it('an end-to-end chain an alert named is still "detected"', async () => {
    useIndex([stage(T0, 1, 101, 'T1105', WIDE), stage(T0, 2, 101, 'T1036', WIDE)]);
    const res = await createService().getChainDepth(LATEST);
    expect([res.endToEnd, res.endToEndAlerted]).toEqual([1, 1]);
  });
});

describe('getExecutionActivity: standalone results on their own evidence, bundle runs chain-level', () => {
  it('a standalone result needs its own evidence; a bundle run counts an alert that named the bundle', async () => {
    await createService().getExecutionActivity({ days: 14 });
    const calls = mockSearch.mock.calls.map((c) => c[0]);
    const protectedFilter = calls.find((r: any) => r.aggs?.standalone).aggs.standalone.aggs.per_day.aggs.protected.filter;
    expect(matches(protectedFilter, standalone(T0, 'T1218', { defender_detected: true }))).toBe(true);
    expect(matches(protectedFilter, standalone(T0, 'T1218'))).toBe(false);
    // One run = one verdict (any-stage pair rule): a stage flagged only bundle-wide makes the run protected.
    const runProtected = calls.find((r: any) => r.aggs?.activity_runs).aggs.activity_runs.aggs.protected.filter;
    expect(matches(runProtected, stage(T0, 2, 101, 'T1036', WIDE))).toBe(true);
    expect(matches(runProtected, stage(T0, 1, 101, 'T1105', OWN))).toBe(true);
    expect(matches(runProtected, stage(T0, 3, 126, 'T1003.001'))).toBe(true);
    expect(matches(runProtected, stage(T0, 4, 101, 'T1041'))).toBe(false);
  });
});
