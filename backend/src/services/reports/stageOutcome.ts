// Stage outcome rules for the execution report (spec §5.1).
//
// Mirrors the console's ExecResultLabel
// (frontend/src/pages/analytics/components/executions/shared.tsx) so report
// numbers cross-check with the executions detail panel. Deliberately NOT SB
// Export's mapOutcome(), which follows the regulator bulletin's rules.
//
// One rule, two representations:
//   classifyStage()  — for fetched docs (the runs list)
//   OUTCOME_FILTERS  — for ES `filters` aggregations over the whole scope
// __tests__/stageOutcome.test.ts evaluates BOTH against one golden table.
// Its twin is frontend/src/pages/analytics/components/executions/__tests__/classifyExecution.test.ts.

import type { OutcomeCounts, StageOutcome } from '../../types/reports.js';

export const STAGE_OUTCOMES: readonly StageOutcome[] = [
  'protected', 'prevented', 'detected', 'unprotected', 'inconclusive', 'skipped',
];

const PROTECTED_EXIT_CODES: readonly number[] = [105, 126, 127];
const UNPROTECTED_EXIT_CODE = 101;
const CONCLUSIVE_EXIT_CODES: readonly number[] = [101, 105, 126, 127];

/** Same vocabulary as frontend utils/prevention.ts; 'kill_failed' is detection, not prevention. */
export const CONFIRMED_PREVENTION_ACTIONS: readonly string[] = ['quarantined', 'process_killed', 'blocked'];

/** Tactics whose undefended success causes direct damage (kebab names and TA ids). */
export const HIGH_IMPACT_TACTICS: readonly string[] = ['exfiltration', 'impact', 'TA0010', 'TA0040'];

/** Read a field from ES _source in flattened (dot-key) or nested form. */
export function getSourceField(source: Record<string, unknown>, path: string): unknown {
  if (source[path] !== undefined) return source[path];
  let value: unknown = source;
  for (const part of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function exitCodeOf(source: Record<string, unknown>): number | undefined {
  const raw = getSourceField(source, 'event.ERROR');
  if (raw === null || raw === undefined || raw === '') return undefined;
  const code = Number(raw);
  return Number.isFinite(code) ? code : undefined;
}

function flag(source: Record<string, unknown>, field: string): boolean {
  return getSourceField(source, `f0rtika.${field}`) === true;
}

function confirmedAction(source: Record<string, unknown>, field: string): boolean {
  return CONFIRMED_PREVENTION_ACTIONS.includes(String(getSourceField(source, `f0rtika.${field}`) ?? ''));
}

/** Classify one stage or standalone-test result exactly like the console's ExecResultLabel. */
export function classifyStage(source: Record<string, unknown>): StageOutcome {
  const code = exitCodeOf(source);
  const isBundle = getSourceField(source, 'f0rtika.is_bundle_control') === true;
  if (isBundle && code === 0 && getSourceField(source, 'f0rtika.category') !== 'cyber-hygiene') return 'skipped';
  if (code !== undefined && PROTECTED_EXIT_CODES.includes(code)) return 'protected';
  if (code !== UNPROTECTED_EXIT_CODE) return 'inconclusive';

  const prevented = flag(source, 'crowdstrike_prevented')
    || flag(source, 'defender_prevented')
    || flag(source, 'sentinelone_prevented')
    || (flag(source, 'crowdstrike_stage_detected') && confirmedAction(source, 'crowdstrike_prevention_action'))
    || (flag(source, 'sentinelone_stage_detected') && confirmedAction(source, 'sentinelone_prevention_action'))
    || (flag(source, 'defender_stage_detected') && confirmedAction(source, 'defender_prevention_action'));
  if (prevented) return 'prevented';
  if (flag(source, 'defender_stage_detected') || flag(source, 'crowdstrike_stage_detected') || flag(source, 'sentinelone_stage_detected')) return 'detected';
  return 'unprotected';
}

/** Unprotected on an exfiltration or impact stage: the report's "high impact" marker. */
export function isHighImpact(outcome: StageOutcome, tactics: readonly string[]): boolean {
  return outcome === 'unprotected' && tactics.some((t) => HIGH_IMPACT_TACTICS.includes(t));
}

// ── ES representation ────────────────────────────────────────────

export type Clause = Record<string, unknown>;

const term = (field: string, value: unknown): Clause => ({ term: { [field]: value } });

const SKIPPED: Clause = {
  bool: {
    filter: [term('f0rtika.is_bundle_control', true), term('event.ERROR', 0)],
    must_not: [term('f0rtika.category', 'cyber-hygiene')],
  },
};

const PREVENTION_SIGNAL: Clause = {
  bool: {
    should: [
      term('f0rtika.crowdstrike_prevented', true),
      term('f0rtika.defender_prevented', true),
      term('f0rtika.sentinelone_prevented', true),
      { bool: { filter: [term('f0rtika.crowdstrike_stage_detected', true), { terms: { 'f0rtika.crowdstrike_prevention_action': CONFIRMED_PREVENTION_ACTIONS } }] } },
      { bool: { filter: [term('f0rtika.defender_stage_detected', true), { terms: { 'f0rtika.defender_prevention_action': CONFIRMED_PREVENTION_ACTIONS } }] } },
      { bool: { filter: [term('f0rtika.sentinelone_stage_detected', true), { terms: { 'f0rtika.sentinelone_prevention_action': CONFIRMED_PREVENTION_ACTIONS } }] } },
    ],
    minimum_should_match: 1,
  },
};

const STAGE_DETECTED: Clause = {
  bool: {
    should: [
      term('f0rtika.defender_stage_detected', true),
      term('f0rtika.crowdstrike_stage_detected', true),
      term('f0rtika.sentinelone_stage_detected', true),
    ],
    minimum_should_match: 1,
  },
};

const UNPROTECTED: Clause = {
  bool: { filter: [term('event.ERROR', UNPROTECTED_EXIT_CODE)], must_not: [PREVENTION_SIGNAL, STAGE_DETECTED] },
};

/** Named filters for an ES `filters` aggregation. Every doc matches exactly one. */
export const OUTCOME_FILTERS: Record<StageOutcome, Clause> = {
  skipped: SKIPPED,
  protected: { terms: { 'event.ERROR': PROTECTED_EXIT_CODES } },
  prevented: { bool: { filter: [term('event.ERROR', UNPROTECTED_EXIT_CODE), PREVENTION_SIGNAL] } },
  detected: { bool: { filter: [term('event.ERROR', UNPROTECTED_EXIT_CODE), STAGE_DETECTED], must_not: [PREVENTION_SIGNAL] } },
  unprotected: UNPROTECTED,
  inconclusive: { bool: { must_not: [{ terms: { 'event.ERROR': CONCLUSIVE_EXIT_CODES } }, SKIPPED] } },
};

/** Unprotected stages on exfiltration/impact tactics. */
export const HIGH_IMPACT_FILTER: Clause = {
  bool: { filter: [UNPROTECTED, { terms: { 'f0rtika.tactics': HIGH_IMPACT_TACTICS } }] },
};

// ── Counts ───────────────────────────────────────────────────────

export function emptyCounts(): OutcomeCounts {
  return { protected: 0, prevented: 0, detected: 0, unprotected: 0, inconclusive: 0, skipped: 0 };
}

export function addCounts(a: OutcomeCounts, b: OutcomeCounts): OutcomeCounts {
  const out = emptyCounts();
  for (const k of STAGE_OUTCOMES) out[k] = a[k] + b[k];
  return out;
}

/** Results that reached a verdict: everything except inconclusive and skipped. */
export function conclusiveCount(c: OutcomeCounts): number {
  return c.protected + c.prevented + c.detected + c.unprotected;
}

/** Stage protection rate (spec §5.1). null when nothing is conclusive. */
export function protectionRate(c: OutcomeCounts): number | null {
  const n = conclusiveCount(c);
  return n === 0 ? null : (c.protected + c.prevented + c.detected) / n;
}

/** Read a `filters` aggregation built from OUTCOME_FILTERS. */
export function countsFromFiltersAgg(agg: unknown): OutcomeCounts {
  const out = emptyCounts();
  const buckets = (agg as { buckets?: Record<string, { doc_count?: number }> } | undefined)?.buckets ?? {};
  for (const k of STAGE_OUTCOMES) out[k] = buckets[k]?.doc_count ?? 0;
  return out;
}
