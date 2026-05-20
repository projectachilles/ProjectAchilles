import { describe, it, expect } from 'vitest';
import { attackSimulationExclusions } from '../attack-simulation-filter.js';

describe('attackSimulationExclusions', () => {
  it('excludes cyber-hygiene controls and skipped bundle stages', () => {
    expect(attackSimulationExclusions()).toEqual([
      { term: { 'f0rtika.category': 'cyber-hygiene' } },
      {
        bool: {
          must: [
            { term: { 'f0rtika.is_bundle_control': true } },
            { term: { 'event.ERROR': 0 } },
          ],
        },
      },
    ]);
  });

  it('returns a fresh array each call (callers may mutate it)', () => {
    const a = attackSimulationExclusions();
    const b = attackSimulationExclusions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
