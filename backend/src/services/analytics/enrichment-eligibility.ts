import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';

/**
 * Excludes the stageless whole-test docs an EDR reconciliation pass writes:
 * a run the EDR killed along with the agent (`edr_terminated`, stages
 * unknown) and a run the EDR blocked at launch (`edr_launch_blocked`, no
 * stage ran). Technique and tactic views apply it: such a run counts for the
 * test as a whole but never for its techniques.
 */
export const NOT_STAGELESS: QueryDslQueryContainer = {
  bool: {
    must_not: [
      { term: { 'f0rtika.edr_terminated': true } },
      { term: { 'f0rtika.edr_launch_blocked': true } },
    ],
  },
};

/** Exit codes that count as a conclusive result for alert enrichment and coverage. */
export const ENRICHMENT_ELIGIBLE_ERROR_CODES: number[] = [0, 1, 101, 105, 126, 127, 259, 999];

/** The exit-code, not-cyber-hygiene and not-stageless clauses the enrichment passes (and vendor technique coverage) filter on. */
export function enrichmentEligibleClauses(): QueryDslQueryContainer[] {
  return [
    { terms: { 'event.ERROR': ENRICHMENT_ELIGIBLE_ERROR_CODES } },
    { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } },
    // Agent-killed runs have no UUID-bearing alert to match, and launch-blocked
    // runs already carry the proving vendor's flags; their reconcile passes
    // own them. Leaving them out also keeps vendor technique coverage (which
    // reuses these clauses) from crediting techniques no stage exercised.
    NOT_STAGELESS,
  ];
}
