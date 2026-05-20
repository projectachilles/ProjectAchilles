import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types.js';

/**
 * ES bool `must_not` clauses that restrict an `achilles-results-*` query to
 * genuine attack simulations — the only test documents a Defender alert
 * could plausibly correspond to. Excludes:
 *
 *   - cyber-hygiene controls — configuration checks, not attacks; a missing
 *     Defender alert is expected, not a detection miss;
 *   - skipped bundle stages — bundle controls that exited 0 because the
 *     orchestrator chose not to run them; they launched no attack at all.
 *
 * Shared by every Defender-tab metric (detection rate, the test-volume
 * trend, technique overlap) so "test execution" means the same thing
 * across the whole tab. The Dashboard's Defense Score deliberately does
 * NOT apply this — a passing hardening check legitimately counts toward
 * the score.
 *
 * See docs/defender-detection-rate.md § Exclusions.
 */
export function attackSimulationExclusions(): QueryDslQueryContainer[] {
  return [
    { term: { 'f0rtika.category': 'cyber-hygiene' } },
    {
      bool: {
        must: [
          { term: { 'f0rtika.is_bundle_control': true } },
          { term: { 'event.ERROR': 0 } },
        ],
      },
    },
  ];
}
