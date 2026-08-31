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
      severity: 'critical',
      category: 'cyber-hygiene',
      score: 9,
      techniques: ['T1562.001', 'T1003'],
      tactics: ['defense-evasion', 'credential-access'],
    }),
    makeTest({
      severity: 'high',
      category: 'cyber-hygiene',
      score: 8,
      techniques: ['T1562.001'],
      tactics: ['defense-evasion'],
    }),
    makeTest({ severity: 'medium', category: 'intel-driven', techniques: ['T1078'], tactics: ['initial-access'] }),
    makeTest({ severity: 'low', category: 'intel-driven' }),
    makeTest({}), // untagged → info, unmapped
  ];

  const stats = computeTestStats(tests);

  it('buckets severity into high/medium/low (critical+high, medium, low+info)', () => {
    expect(stats.severityMix).toEqual({ high: 2, medium: 1, low: 2 });
    expect(stats.criticalHigh).toBe(2);
  });

  it('counts categories sorted by size', () => {
    expect(stats.categories).toEqual([
      { label: 'cyber-hygiene', count: 2 },
      { label: 'intel-driven', count: 2 },
    ]);
  });

  it('averages only positive scores', () => {
    expect(stats.avgScore).toBeCloseTo(8.5);
    expect(stats.scoredTests).toBe(2);
  });

  it('counts distinct techniques per tactic and mapped tests', () => {
    const de = stats.mitre.tactics.find((t) => t.code === 'DE');
    expect(de?.count).toBe(2); // T1562.001 + T1003 land in defense-evasion via test 1; test 2 adds nothing new
    expect(stats.mitre.totalTechniques).toBe(3);
    expect(stats.mitre.mappedTests).toBe(3); // tests without tactics+techniques are excluded
    expect(stats.mitre.coveredTactics).toBe(3);
    expect(stats.mitre.totalTactics).toBe(14);
    expect(stats.mitre.tactics).toHaveLength(12); // bars show IA→IM only
  });
});
