import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';

/** Exit codes that count as a conclusive result for alert enrichment and coverage. */
export const ENRICHMENT_ELIGIBLE_ERROR_CODES: number[] = [0, 1, 101, 105, 126, 127, 259, 999];

/** The exit-code, not-cyber-hygiene and not-EDR-terminated clauses both enrichment passes filter on. */
export function enrichmentEligibleClauses(): QueryDslQueryContainer[] {
  return [
    { terms: { 'event.ERROR': ENRICHMENT_ELIGIBLE_ERROR_CODES } },
    { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } },
    // Agent-killed runs have no UUID-bearing alert to match; the kill
    // reconcile pass owns them, so UUID correlation must leave them alone.
    { bool: { must_not: [{ term: { 'f0rtika.edr_terminated': true } }] } },
  ];
}
