import { describe, it, expect } from 'vitest';
import { computeTestStats } from '../computeTestStats';
import type { TestMetadata } from '@/types/test';

function makeTest(overrides: Partial<TestMetadata>): TestMetadata {
  return {
    uuid: crypto.randomUUID(),
    name: 'test',
    techniques: [],
    isMultiStage: false,
    stages: [],
    ...overrides,
  };
}

describe('computeTestStats', () => {
  const tests: TestMetadata[] = [
    makeTest({
      category: 'cyber-hygiene',
      score: 9,
      techniques: ['T1562.001', 'T1003'],
      tactics: ['defense-evasion', 'credential-access'],
    }),
    makeTest({
      category: 'cyber-hygiene',
      score: 8,
      techniques: ['T1562.001'],
      tactics: ['defense-evasion'],
    }),
    makeTest({ category: 'intel-driven', techniques: ['T1078'], tactics: ['initial-access'] }),
    makeTest({ category: 'intel-driven' }),
    makeTest({}), // untagged → info, unmapped
  ];

  const stats = computeTestStats(tests);

  it('averages only positive scores', () => {
    expect(stats.avgScore).toBeCloseTo(8.5);
    expect(stats.scoredTests).toBe(2);
  });

  it('counts intel-driven tests', () => {
    const stats = computeTestStats([
      makeTest({ category: 'intel-driven' }),
      makeTest({ category: 'intel-driven' }),
      makeTest({ category: 'cyber-hygiene' }),
    ]);
    expect(stats.intelDriven).toBe(2);
  });
});
