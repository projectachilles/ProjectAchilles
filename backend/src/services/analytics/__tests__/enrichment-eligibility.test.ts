import { describe, it, expect } from 'vitest';
import { NOT_STAGELESS, enrichmentEligibleClauses } from '../enrichment-eligibility.js';
import { matches } from './helpers/inMemoryEs.js';

describe('NOT_STAGELESS', () => {
  it('excludes EDR-killed and EDR launch-blocked whole-test docs, nothing else', () => {
    expect(matches(NOT_STAGELESS, { 'f0rtika.edr_terminated': true })).toBe(false);
    expect(matches(NOT_STAGELESS, { 'f0rtika.edr_launch_blocked': true })).toBe(false);
    expect(matches(NOT_STAGELESS, { 'event.ERROR': 126 })).toBe(true);
    expect(matches(NOT_STAGELESS, { 'f0rtika.edr_terminated': false, 'f0rtika.edr_launch_blocked': false })).toBe(true);
  });
});

describe('enrichmentEligibleClauses', () => {
  it('excludes edr_terminated and edr_launch_blocked docs (their own passes own them)', () => {
    expect(enrichmentEligibleClauses()).toContainEqual(NOT_STAGELESS);
  });

  it('keeps the exit-code and cyber-hygiene clauses', () => {
    const q = JSON.stringify(enrichmentEligibleClauses());
    expect(q).toContain('event.ERROR');
    expect(q).toContain('"f0rtika.category":"cyber-hygiene"');
  });
});
