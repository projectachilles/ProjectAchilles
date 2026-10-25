import { describe, it, expect } from 'vitest';
import {
  classifyStage,
  OUTCOME_FILTERS,
  HIGH_IMPACT_FILTER,
  isHighImpact,
  getSourceField,
  emptyCounts,
  addCounts,
  protectionRate,
  countsFromFiltersAgg,
  STAGE_OUTCOMES,
} from '../stageOutcome.js';
import type { StageOutcome } from '../../../types/reports.js';

// ── Golden table ──────────────────────────────────────────────────
// Neutral shape shared with the frontend twin at
// frontend/src/pages/analytics/components/executions/__tests__/classifyExecution.test.ts.
// Change BOTH tables together.
interface GoldenCase {
  name: string;
  exit?: number;
  bundle?: boolean;
  category?: string;
  flags?: Partial<Record<
    | 'defender_detected' | 'defender_stage_detected' | 'defender_prevented'
    | 'crowdstrike_detected' | 'crowdstrike_stage_detected' | 'crowdstrike_prevented'
    | 'sentinelone_detected' | 'sentinelone_stage_detected' | 'sentinelone_prevented',
    boolean
  >>;
  actions?: Partial<Record<'defender_prevention_action' | 'crowdstrike_prevention_action' | 'sentinelone_prevention_action', string>>;
  expected: StageOutcome;
}

const GOLDEN: GoldenCase[] = [
  { name: 'exit 105 → protected', exit: 105, expected: 'protected' },
  { name: 'exit 126 → protected', exit: 126, expected: 'protected' },
  { name: 'exit 127 → protected', exit: 127, expected: 'protected' },
  { name: 'exit 126 + stage alert stays protected', exit: 126, flags: { defender_stage_detected: true }, expected: 'protected' },
  { name: 'exit 101, nothing → unprotected', exit: 101, expected: 'unprotected' },
  { name: 'exit 101 + Defender stage alert → detected', exit: 101, flags: { defender_stage_detected: true }, expected: 'detected' },
  { name: 'exit 101 + Falcon stage alert → detected', exit: 101, flags: { crowdstrike_stage_detected: true }, expected: 'detected' },
  { name: 'exit 101 + bundle-level Defender flag only → unprotected', exit: 101, flags: { defender_detected: true }, expected: 'unprotected' },
  { name: 'exit 101 + Falcon prevented → prevented', exit: 101, flags: { crowdstrike_prevented: true }, expected: 'prevented' },
  { name: 'exit 101 + Defender prevented → prevented', exit: 101, flags: { defender_prevented: true }, expected: 'prevented' },
  {
    name: 'exit 101 + Falcon stage alert + quarantined → prevented', exit: 101,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'quarantined' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Defender stage alert + kill_failed → detected', exit: 101,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'kill_failed' }, expected: 'detected',
  },
  {
    name: 'exit 101 + Defender stage alert + quarantined → prevented', exit: 101,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'quarantined' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Defender stage alert + process_killed → prevented', exit: 101,
    flags: { defender_stage_detected: true }, actions: { defender_prevention_action: 'process_killed' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Falcon stage alert + blocked → prevented', exit: 101,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'blocked' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + Falcon stage alert + kill_failed → detected', exit: 101,
    flags: { crowdstrike_stage_detected: true }, actions: { crowdstrike_prevention_action: 'kill_failed' }, expected: 'detected',
  },
  {
    name: 'exit 101 + bundle-level flag + blocked action → unprotected', exit: 101,
    flags: { defender_detected: true }, actions: { defender_prevention_action: 'blocked' }, expected: 'unprotected',
  },
  { name: 'bundle stage exit 0 (intel-driven) → skipped', exit: 0, bundle: true, category: 'intel-driven', expected: 'skipped' },
  { name: 'bundle control exit 0 (cyber-hygiene) → inconclusive', exit: 0, bundle: true, category: 'cyber-hygiene', expected: 'inconclusive' },
  { name: 'standalone exit 0 → inconclusive', exit: 0, expected: 'inconclusive' },
  { name: 'exit 1 → inconclusive', exit: 1, expected: 'inconclusive' },
  { name: 'exit 200 → inconclusive', exit: 200, expected: 'inconclusive' },
  { name: 'exit 259 → inconclusive', exit: 259, expected: 'inconclusive' },
  { name: 'exit 260 → inconclusive', exit: 260, expected: 'inconclusive' },
  { name: 'exit 999 → inconclusive', exit: 999, expected: 'inconclusive' },
  { name: 'exit 999 + Defender prevented → inconclusive (unlike SB Export)', exit: 999, flags: { defender_prevented: true }, expected: 'inconclusive' },
  { name: 'missing exit code → inconclusive', expected: 'inconclusive' },
  { name: 'exit 101 + SentinelOne stage alert → detected', exit: 101, flags: { sentinelone_stage_detected: true }, expected: 'detected' },
  {
    name: 'exit 101 + SentinelOne stage alert + process_killed → prevented', exit: 101,
    flags: { sentinelone_stage_detected: true }, actions: { sentinelone_prevention_action: 'process_killed' }, expected: 'prevented',
  },
  {
    name: 'exit 101 + SentinelOne stage alert + kill_failed → detected', exit: 101,
    flags: { sentinelone_stage_detected: true }, actions: { sentinelone_prevention_action: 'kill_failed' }, expected: 'detected',
  },
  { name: 'exit 101 + SentinelOne prevented → prevented', exit: 101, flags: { sentinelone_prevented: true }, expected: 'prevented' },
  { name: 'exit 101 + SentinelOne bundle-level flag only → unprotected', exit: 101, flags: { sentinelone_detected: true }, expected: 'unprotected' },
];

function toSource(c: GoldenCase): Record<string, unknown> {
  return {
    event: c.exit === undefined ? {} : { ERROR: c.exit },
    f0rtika: {
      test_uuid: 'u',
      test_name: 'n',
      ...(c.bundle ? { is_bundle_control: true } : {}),
      ...(c.category ? { category: c.category } : {}),
      ...(c.flags ?? {}),
      ...(c.actions ?? {}),
    },
  };
}

// Minimal evaluator for the ES DSL subset OUTCOME_FILTERS uses (term, terms,
// bool filter/must/must_not/should). It proves the ES filters and
// classifyStage() agree without a live cluster.
type Query = Record<string, any>;
const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
function matches(query: Query, doc: Record<string, unknown>): boolean {
  if (query.term) {
    const [field, value] = Object.entries(query.term)[0];
    return asArray(getSourceField(doc, field)).includes(value);
  }
  if (query.terms) {
    const [field, values] = Object.entries(query.terms)[0] as [string, unknown[]];
    return asArray(getSourceField(doc, field)).some((x) => values.includes(x));
  }
  if (query.bool) {
    const b = query.bool;
    const every = (key: string) => asArray(b[key]).every((c) => matches(c as Query, doc));
    const none = asArray(b.must_not).every((c) => !matches(c as Query, doc));
    const should = b.should === undefined
      ? true
      : asArray(b.should).filter((c) => matches(c as Query, doc)).length >= (b.minimum_should_match ?? 1);
    return every('filter') && every('must') && none && should;
  }
  throw new Error(`Unsupported clause: ${JSON.stringify(query)}`);
}

describe('classifyStage — golden table', () => {
  it.each(GOLDEN)('$name', (c) => {
    expect(classifyStage(toSource(c))).toBe(c.expected);
  });
});

describe('OUTCOME_FILTERS agree with classifyStage', () => {
  it.each(GOLDEN)('$name: exactly one filter matches, the classified one', (c) => {
    const doc = toSource(c);
    expect(STAGE_OUTCOMES.filter((k) => matches(OUTCOME_FILTERS[k], doc))).toEqual([c.expected]);
  });
});

describe('getSourceField', () => {
  it('reads flattened dot-keys and nested objects', () => {
    expect(getSourceField({ 'event.ERROR': 101 }, 'event.ERROR')).toBe(101);
    expect(getSourceField({ event: { ERROR: 126 } }, 'event.ERROR')).toBe(126);
    expect(getSourceField({ event: null }, 'event.ERROR')).toBeUndefined();
  });

  it('lets classifyStage read flattened documents', () => {
    expect(classifyStage({ 'event.ERROR': 101, 'f0rtika.defender_stage_detected': true })).toBe('detected');
  });
});

describe('high impact', () => {
  it('marks only unprotected exfiltration/impact stages', () => {
    expect(isHighImpact('unprotected', ['exfiltration'])).toBe(true);
    expect(isHighImpact('unprotected', ['TA0040'])).toBe(true);
    expect(isHighImpact('unprotected', ['execution'])).toBe(false);
    expect(isHighImpact('detected', ['impact'])).toBe(false);
  });

  it('HIGH_IMPACT_FILTER matches the same docs', () => {
    const doc = (exit: number, tactics: string[], extra: Record<string, unknown> = {}) =>
      ({ event: { ERROR: exit }, f0rtika: { tactics, ...extra } });
    expect(matches(HIGH_IMPACT_FILTER, doc(101, ['impact']))).toBe(true);
    expect(matches(HIGH_IMPACT_FILTER, doc(101, ['impact'], { defender_stage_detected: true }))).toBe(false);
    expect(matches(HIGH_IMPACT_FILTER, doc(126, ['impact']))).toBe(false);
    expect(matches(HIGH_IMPACT_FILTER, doc(101, ['execution']))).toBe(false);
  });
});

describe('count helpers', () => {
  it('computes the stage protection rate without inconclusive or skipped', () => {
    const c = { ...emptyCounts(), protected: 2, detected: 1, unprotected: 1, inconclusive: 5, skipped: 3 };
    expect(protectionRate(c)).toBe(0.75);
    expect(protectionRate(emptyCounts())).toBeNull();
  });

  it('adds counts and reads filters aggregations', () => {
    const one = { ...emptyCounts(), protected: 1 };
    expect(addCounts(one, one).protected).toBe(2);
    expect(countsFromFiltersAgg({ buckets: { detected: { doc_count: 4 } } })).toEqual({ ...emptyCounts(), detected: 4 });
    expect(countsFromFiltersAgg(undefined)).toEqual(emptyCounts());
  });
});
