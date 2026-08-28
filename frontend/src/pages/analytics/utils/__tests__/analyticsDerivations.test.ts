import { describe, it, expect } from 'vitest';
import {
  topBypassedTechniques,
  weakestHosts,
  totalBypassedCount,
  scoreDelta,
  type BypassedTechnique,
} from '../analyticsDerivations';
import type { TechniqueDistributionItem, DefenseScoreByHostItem } from '@/services/api/analytics';

describe('analyticsDerivations', () => {
  describe('topBypassedTechniques', () => {
    it('calculates bypass rate as unprotected / (protected + unprotected) * 100', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1234', protected: 10, unprotected: 5 }, // 5/15 = 33.33%
      ];
      const result = topBypassedTechniques(items);
      expect(result[0].bypassRate).toBeCloseTo(33.33, 1);
    });

    it('excludes items with zero total (protected + unprotected = 0)', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1000', protected: 0, unprotected: 0 },
        { technique: 'T1001', protected: 5, unprotected: 10 },
      ];
      const result = topBypassedTechniques(items);
      expect(result).toHaveLength(1);
      expect(result[0].technique).toBe('T1001');
    });

    it('sorts by bypass rate descending', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1000', protected: 1, unprotected: 1 }, // 50%
        { technique: 'T1001', protected: 9, unprotected: 1 }, // 10%
        { technique: 'T1002', protected: 0, unprotected: 10 }, // 100%
      ];
      const result = topBypassedTechniques(items);
      expect(result[0].technique).toBe('T1002');
      expect(result[1].technique).toBe('T1000');
      expect(result[2].technique).toBe('T1001');
    });

    it('respects limit parameter (default 5)', () => {
      const items: TechniqueDistributionItem[] = Array.from({ length: 10 }, (_, i) => ({
        technique: `T${i}`,
        protected: 1,
        unprotected: i + 1,
      }));
      const result = topBypassedTechniques(items);
      expect(result).toHaveLength(5);
    });

    it('respects custom limit', () => {
      const items: TechniqueDistributionItem[] = Array.from({ length: 10 }, (_, i) => ({
        technique: `T${i}`,
        protected: 1,
        unprotected: i + 1,
      }));
      const result = topBypassedTechniques(items, 3);
      expect(result).toHaveLength(3);
    });

    it('sets protectedCount and unprotectedCount on result', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1234', protected: 10, unprotected: 5 },
      ];
      const result = topBypassedTechniques(items);
      expect(result[0].protectedCount).toBe(10);
      expect(result[0].unprotectedCount).toBe(5);
    });

    it('returns BypassedTechnique interface with all required fields', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1234', protected: 20, unprotected: 30 },
      ];
      const result = topBypassedTechniques(items);
      const item = result[0] as BypassedTechnique;
      expect(item).toHaveProperty('technique');
      expect(item).toHaveProperty('bypassRate');
      expect(item).toHaveProperty('protectedCount');
      expect(item).toHaveProperty('unprotectedCount');
    });
  });

  describe('weakestHosts', () => {
    it('sorts by score ascending (weakest first)', () => {
      const items: DefenseScoreByHostItem[] = [
        { hostname: 'host-a', score: 80, protected: 8, unprotected: 2, total: 10 },
        { hostname: 'host-b', score: 50, protected: 5, unprotected: 5, total: 10 },
        { hostname: 'host-c', score: 90, protected: 9, unprotected: 1, total: 10 },
      ];
      const result = weakestHosts(items);
      expect(result[0].hostname).toBe('host-b');
      expect(result[1].hostname).toBe('host-a');
      expect(result[2].hostname).toBe('host-c');
    });

    it('does not mutate the input array', () => {
      const items: DefenseScoreByHostItem[] = [
        { hostname: 'host-a', score: 80, protected: 8, unprotected: 2, total: 10 },
        { hostname: 'host-b', score: 50, protected: 5, unprotected: 5, total: 10 },
      ];
      const originalOrder = items.map((h) => h.hostname);
      weakestHosts(items);
      const afterOrder = items.map((h) => h.hostname);
      expect(afterOrder).toEqual(originalOrder);
    });

    it('respects limit parameter (default 5)', () => {
      const items: DefenseScoreByHostItem[] = Array.from({ length: 10 }, (_, i) => ({
        hostname: `host-${i}`,
        score: 100 - i,
        protected: i,
        unprotected: i,
        total: i * 2,
      }));
      const result = weakestHosts(items);
      expect(result).toHaveLength(5);
    });

    it('respects custom limit', () => {
      const items: DefenseScoreByHostItem[] = Array.from({ length: 10 }, (_, i) => ({
        hostname: `host-${i}`,
        score: 100 - i,
        protected: i,
        unprotected: i,
        total: i * 2,
      }));
      const result = weakestHosts(items, 2);
      expect(result).toHaveLength(2);
    });

    it('returns DefenseScoreByHostItem type with all fields intact', () => {
      const items: DefenseScoreByHostItem[] = [
        { hostname: 'host-a', score: 80, protected: 8, unprotected: 2, total: 10 },
      ];
      const result = weakestHosts(items);
      expect(result[0]).toHaveProperty('hostname', 'host-a');
      expect(result[0]).toHaveProperty('score', 80);
      expect(result[0]).toHaveProperty('protected', 8);
      expect(result[0]).toHaveProperty('unprotected', 2);
      expect(result[0]).toHaveProperty('total', 10);
    });
  });

  describe('totalBypassedCount', () => {
    it('sums unprotected across all items', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1000', protected: 10, unprotected: 5 },
        { technique: 'T1001', protected: 20, unprotected: 8 },
        { technique: 'T1002', protected: 15, unprotected: 3 },
      ];
      const result = totalBypassedCount(items);
      expect(result).toBe(16); // 5 + 8 + 3
    });

    it('returns 0 for empty array', () => {
      const items: TechniqueDistributionItem[] = [];
      const result = totalBypassedCount(items);
      expect(result).toBe(0);
    });

    it('returns 0 when all unprotected counts are 0', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1000', protected: 10, unprotected: 0 },
        { technique: 'T1001', protected: 20, unprotected: 0 },
      ];
      const result = totalBypassedCount(items);
      expect(result).toBe(0);
    });

    it('handles single item', () => {
      const items: TechniqueDistributionItem[] = [
        { technique: 'T1000', protected: 100, unprotected: 42 },
      ];
      const result = totalBypassedCount(items);
      expect(result).toBe(42);
    });
  });

  describe('scoreDelta', () => {
    it('returns last - value at lookback distance', () => {
      const series = [10, 20, 30, 40, 50];
      const delta = scoreDelta(series, 2);
      expect(delta).toBe(20); // 50 - 30
    });

    it('returns null when series is too short (length <= lookback)', () => {
      const series = [10, 20, 30];
      const delta = scoreDelta(series, 5);
      expect(delta).toBeNull();
    });

    it('uses default lookback of 7', () => {
      const series = Array.from({ length: 10 }, (_, i) => i * 10);
      // [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
      // last = 90 (index 9), lookback 7 = series[9-7] = series[2] = 20
      // delta = 90 - 20 = 70
      const delta = scoreDelta(series);
      expect(delta).toBe(70);
    });

    it('handles exact boundary: series.length === lookback + 1', () => {
      const series = [10, 20, 30];
      // length=3, lookback=2, last=series[2]=30, series[2-2]=series[0]=10
      // delta = 30 - 10 = 20
      const delta = scoreDelta(series, 2);
      expect(delta).toBe(20);
    });

    it('returns null when series.length === lookback', () => {
      const series = [10, 20, 30];
      const delta = scoreDelta(series, 3);
      expect(delta).toBeNull();
    });

    it('returns null for empty array', () => {
      const series: number[] = [];
      const delta = scoreDelta(series);
      expect(delta).toBeNull();
    });

    it('returns null for single-element array', () => {
      const series = [100];
      const delta = scoreDelta(series);
      expect(delta).toBeNull();
    });

    it('handles negative deltas', () => {
      const series = [100, 95, 90, 85, 80];
      const delta = scoreDelta(series, 2);
      expect(delta).toBe(-10); // 80 - 90
    });

    it('handles zero delta', () => {
      const series = [50, 50, 50, 50, 50];
      const delta = scoreDelta(series, 2);
      expect(delta).toBe(0);
    });

    it('rounds result to 1 decimal place', () => {
      const series = [10.111, 20.222, 30.333, 40.444, 50.555];
      const delta = scoreDelta(series, 2);
      // 50.555 - 30.333 = 20.222, rounded to 1 decimal = 20.2
      expect(delta).toBeCloseTo(20.2, 1);
    });
  });
});
