import { describe, it, expect } from 'vitest';
import { enrichmentEligibleClauses } from '../enrichment-eligibility.js';

describe('enrichmentEligibleClauses', () => {
  it('excludes edr_terminated docs', () => {
    expect(enrichmentEligibleClauses()).toContainEqual({
      bool: { must_not: [{ term: { 'f0rtika.edr_terminated': true } }] },
    });
  });

  it('keeps the exit-code and cyber-hygiene clauses', () => {
    const q = JSON.stringify(enrichmentEligibleClauses());
    expect(q).toContain('event.ERROR');
    expect(q).toContain('"f0rtika.category":"cyber-hygiene"');
  });
});
