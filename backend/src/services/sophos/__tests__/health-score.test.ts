import { describe, it, expect } from 'vitest';
import { computeHealthSnapshot, categoriesFromHistoryPoint, headlineOf } from '../health-score.js';

const full = {
  endpoint: {
    protection: { computer: { score: 90, total: 10, notFullyProtected: 1 }, server: { score: 70, total: 2, notFullyProtected: 1 } },
    policy: {
      computer: { 'threat-protection': { score: 80, policies: [{ id: 'p1', name: 'Base', notOnRecommended: 2 }] } },
      server: { 'server-threat-protection': { score: 60 } },
    },
    exclusions: { global: { score: 50, scanningExclusions: [{ id: 'x', value: 'C:\\F0\\', type: 'path', scanMode: 'onDemandAndOnAccess', reasonCode: 'entireDrive' }] } },
    tamperProtection: { computer: { score: 100, total: 10, disabled: 0 }, server: { score: 0, total: 2, disabled: 2 } },
  },
};

describe('computeHealthSnapshot', () => {
  it('headline averages the four categories using computer and server sub-scores', () => {
    const s = computeHealthSnapshot(full);
    // protection 80, policy 70, exclusions 50, tamper 50 -> 62.5
    expect(s.categories.map((c) => [c.category, c.score])).toEqual([
      ['protection', 80], ['policy', 70], ['exclusions', 50], ['tamper_protection', 50],
    ]);
    expect(s.headline).toBe(62.5);
    expect(s.items.riskyExclusions[0]).toMatchObject({ value: 'C:\\F0\\', reasonCode: 'entireDrive' });
    expect(s.items.notOnRecommended[0].policy).toBe('Base');
    expect(s.items.tamperDisabled).toEqual(['2 of 2 servers']);
  });

  it('a category Sophos omits is skipped, not zero', () => {
    const s = computeHealthSnapshot({ endpoint: { protection: { computer: { score: 90 } }, exclusions: { global: { score: 70 } } } });
    expect(s.categories.map((c) => c.category)).toEqual(['protection', 'exclusions']);
    expect(s.headline).toBe(80);
  });

  it('a category with only a server score uses just that score', () => {
    const s = computeHealthSnapshot({ endpoint: { protection: { server: { score: 40 } } } });
    expect(s.headline).toBe(40);
  });

  it('headline is null when Sophos returns no scores', () => {
    for (const raw of [{}, null, { endpoint: { protection: { computer: {}, server: { score: null } } } }]) {
      const s = computeHealthSnapshot(raw);
      expect(s.headline).toBeNull();
      expect(s.categories).toEqual([]);
    }
  });

  it('history points use the same averaging', () => {
    const cats = categoriesFromHistoryPoint({ endpoint: { protectionComputerScore: 100, protectionServerScore: 50, exclusionsGlobalScore: 90 } });
    expect(headlineOf(cats)).toBe(82.5);
  });
});
