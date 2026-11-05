import type { PairRun } from './posture.js';

export type PairOutcome = 'protected' | 'prevented' | 'detected' | 'silent';

export type OutcomeRun = PairRun & { edrPrevented?: boolean };

export interface OutcomeCounts {
  pairCount: number;
  protected: number;
  prevented: number;
  detected: number;
  silent: number;
}

/**
 * Classify a latest-basis pair. Mirrors the score's `protected` rule
 * (`is_protected OR any _detected`): the buckets protected + prevented +
 * detected always sum to the pairs the Defense Score counts as protected.
 * An EDR prevention flag without a detection stays silent, as in the score.
 */
export function classifyPairOutcome(run: OutcomeRun): PairOutcome {
  if (run.strictProtected) return 'protected';
  if (run.protected && run.edrPrevented) return 'prevented';
  if (run.protected) return 'detected';
  return 'silent';
}

export function countPairOutcomes(pairs: OutcomeRun[]): OutcomeCounts {
  const counts: OutcomeCounts = { pairCount: pairs.length, protected: 0, prevented: 0, detected: 0, silent: 0 };
  for (const p of pairs) counts[classifyPairOutcome(p)]++;
  return counts;
}
