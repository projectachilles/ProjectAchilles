import { describe, it, expect } from 'vitest';
import { classifyPairOutcome, countPairOutcomes, type OutcomeRun } from '../outcomeBreakdown.js';

const run = (o: Partial<OutcomeRun>): OutcomeRun => ({
  pairKey: 'k', ts: 1, protected: false, strictProtected: false,
  errorCodes: [101], errorNames: [], hostname: 'HOST-01', testName: '', techniques: [], ...o,
});

describe('classifyPairOutcome', () => {
  it('strict protection wins', () =>
    expect(classifyPairOutcome(run({ protected: true, strictProtected: true, edrPrevented: true }))).toBe('protected'));
  it('EDR prevention on a detected run', () =>
    expect(classifyPairOutcome(run({ protected: true, edrPrevented: true }))).toBe('prevented'));
  it('detected without prevention', () =>
    expect(classifyPairOutcome(run({ protected: true }))).toBe('detected'));
  it('prevented flag without detection stays silent (score counts it unprotected)', () =>
    expect(classifyPairOutcome(run({ edrPrevented: true }))).toBe('silent'));
  it('nothing -> silent', () => expect(classifyPairOutcome(run({}))).toBe('silent'));
});

describe('countPairOutcomes', () => {
  it('counts add up and match the score identity', () => {
    const c = countPairOutcomes([
      run({ protected: true, strictProtected: true }),
      run({ protected: true, edrPrevented: true }),
      run({ protected: true }),
      run({}),
      run({ edrPrevented: true }),
    ]);
    expect(c).toEqual({ pairCount: 5, protected: 1, prevented: 1, detected: 1, silent: 2 });
  });
});
