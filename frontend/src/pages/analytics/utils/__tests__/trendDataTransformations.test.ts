import { describe, it, expect } from 'vitest';
import { applyForwardFill } from '../trendDataTransformations';
import type { TrendDataPoint } from '@/services/api/analytics';

function point(overrides: Partial<TrendDataPoint> & { total: number }): TrendDataPoint {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    score: 0,
    protected: 0,
    ...overrides,
  };
}

describe('applyForwardFill', () => {
  describe('empty and edge inputs', () => {
    it('returns empty array for empty input', () => {
      expect(applyForwardFill([])).toEqual([]);
    });

    it('returns empty array for null/undefined input', () => {
      expect(applyForwardFill(null as any)).toEqual([]);
      expect(applyForwardFill(undefined as any)).toEqual([]);
    });

    it('single high-volume point is not carried forward', () => {
      const result = applyForwardFill([point({ total: 100, score: 75 })]);
      expect(result).toHaveLength(1);
      expect(result[0].isCarriedForward).toBe(false);
      expect(result[0].score).toBe(75);
    });

    it('single low-volume point is not carried forward (no prior data)', () => {
      const result = applyForwardFill([point({ total: 1, score: 50 })]);
      expect(result).toHaveLength(1);
      expect(result[0].isCarriedForward).toBe(false);
      expect(result[0].score).toBe(50);
    });
  });

  describe('threshold calculation', () => {
    it('computes average from days with total > 0 only', () => {
      // 3 days: total 0, 100, 0 → avg = 100, threshold = max(5, floor(100*0.15)) = 15
      // Day 1 (total=0): below threshold, no prior → not carried
      // Day 2 (total=100): above threshold → real score
      // Day 3 (total=0): below threshold, carry from day 2
      const data = [
        point({ total: 0, score: 0 }),
        point({ total: 100, score: 80 }),
        point({ total: 0, score: 10 }),
      ];
      const result = applyForwardFill(data);
      expect(result[0].isCarriedForward).toBe(false); // no prior
      expect(result[1].isCarriedForward).toBe(false);
      expect(result[2].isCarriedForward).toBe(true);
      expect(result[2].score).toBe(80);
    });

    it('enforces absolute minimum of 5 when calculated threshold is lower', () => {
      // avg = 20, threshold = max(5, floor(20*0.15)) = max(5, 3) = 5
      // So total of 4 is below threshold, total of 5 is at threshold
      const data = [
        point({ total: 20, score: 60 }),
        point({ total: 4, score: 30 }), // below 5 → carried
      ];
      const result = applyForwardFill(data);
      expect(result[1].isCarriedForward).toBe(true);
      expect(result[1].score).toBe(60);
    });

    it('total exactly at threshold is not carried forward', () => {
      // avg = 20, threshold = max(5, floor(20*0.15)) = 5
      const data = [
        point({ total: 20, score: 60 }),
        point({ total: 5, score: 40 }), // at threshold → meaningful
      ];
      const result = applyForwardFill(data);
      expect(result[1].isCarriedForward).toBe(false);
      expect(result[1].score).toBe(40);
    });
  });

  describe('forward-fill logic', () => {
    it('fills low-volume day between two high-volume days', () => {
      const data = [
        point({ total: 50, score: 70 }),
        point({ total: 1, score: 20 }),  // low → carry 70
        point({ total: 50, score: 65 }),
      ];
      const result = applyForwardFill(data);
      expect(result[1].isCarriedForward).toBe(true);
      expect(result[1].score).toBe(70);
      expect(result[2].isCarriedForward).toBe(false);
      expect(result[2].score).toBe(65);
    });

    it('carries forward through multiple consecutive low-volume days', () => {
      const data = [
        point({ total: 50, score: 80 }),
        point({ total: 0, score: 0 }),
        point({ total: 1, score: 10 }),
        point({ total: 0, score: 0 }),
        point({ total: 50, score: 75 }),
      ];
      const result = applyForwardFill(data);
      expect(result[1].score).toBe(80);
      expect(result[1].isCarriedForward).toBe(true);
      expect(result[2].score).toBe(80);
      expect(result[2].isCarriedForward).toBe(true);
      expect(result[3].score).toBe(80);
      expect(result[3].isCarriedForward).toBe(true);
    });

    it('first point with low volume uses actual score (no prior)', () => {
      const data = [
        point({ total: 1, score: 99 }),  // low, but no prior → actual
        point({ total: 50, score: 60 }),
      ];
      const result = applyForwardFill(data);
      expect(result[0].isCarriedForward).toBe(false);
      expect(result[0].score).toBe(99);
    });

    it('high-volume day updates lastKnownScore', () => {
      const data = [
        point({ total: 50, score: 70 }),
        point({ total: 50, score: 90 }),  // updates lastKnown to 90
        point({ total: 1, score: 5 }),    // carries 90
      ];
      const result = applyForwardFill(data);
      expect(result[2].score).toBe(90);
      expect(result[2].isCarriedForward).toBe(true);
    });

    it('score of 0 on high-volume day is a real score, not carried forward', () => {
      const data = [
        point({ total: 50, score: 80 }),
        point({ total: 50, score: 0 }), // real 0
      ];
      const result = applyForwardFill(data);
      expect(result[1].isCarriedForward).toBe(false);
      expect(result[1].score).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('stable volume - no forward fill needed', () => {
      const data = [
        point({ total: 50, score: 80 }),
        point({ total: 45, score: 78 }),
        point({ total: 55, score: 82 }),
      ];
      const result = applyForwardFill(data);
      expect(result.every(p => !p.isCarriedForward)).toBe(true);
    });

    it('weekend gap pattern (high, low, low, high)', () => {
      const data = [
        point({ total: 60, score: 75 }),
        point({ total: 2, score: 50 }),   // weekend → carry
        point({ total: 0, score: 0 }),    // weekend → carry
        point({ total: 55, score: 80 }),
      ];
      const result = applyForwardFill(data);
      expect(result[0].isCarriedForward).toBe(false);
      expect(result[1].isCarriedForward).toBe(true);
      expect(result[1].score).toBe(75);
      expect(result[2].isCarriedForward).toBe(true);
      expect(result[2].score).toBe(75);
      expect(result[3].isCarriedForward).toBe(false);
    });

    it('all zeros — avgVolume=0, threshold=5, none carried forward', () => {
      const data = [
        point({ total: 0, score: 0 }),
        point({ total: 0, score: 0 }),
        point({ total: 0, score: 0 }),
      ];
      const result = applyForwardFill(data);
      // avgVolume = 0, threshold = max(5, 0) = 5
      // All totals (0) < 5, but no prior to carry from
      expect(result.every(p => !p.isCarriedForward)).toBe(true);
    });

    it('gradually decreasing volume triggers forward-fill', () => {
      // avg of non-zero = (100+50+8+3)/4 = 40.25, threshold = max(5, floor(40.25*0.15)) = max(5,6) = 6
      const data = [
        point({ total: 100, score: 90 }),
        point({ total: 50, score: 85 }),
        point({ total: 8, score: 70 }),   // ≥ 6 → real
        point({ total: 3, score: 20 }),   // < 6 → carry 70
      ];
      const result = applyForwardFill(data);
      expect(result[2].isCarriedForward).toBe(false);
      expect(result[3].isCarriedForward).toBe(true);
      expect(result[3].score).toBe(70);
    });
  });
});
