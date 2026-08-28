import type { TechniqueDistributionItem, DefenseScoreByHostItem } from '@/services/api/analytics';

export interface BypassedTechnique {
  technique: string;
  bypassRate: number;
  protectedCount: number;
  unprotectedCount: number;
}

/**
 * Compute bypass rate (unprotected / (protected + unprotected) * 100) for each technique,
 * exclude zero-total groups, sort descending by bypass rate, and slice to limit (default 5).
 */
export function topBypassedTechniques(
  items: TechniqueDistributionItem[],
  limit: number = 5
): BypassedTechnique[] {
  return items
    .map((item) => {
      const total = item.protected + item.unprotected;
      const bypassRate = total === 0 ? 0 : (item.unprotected / total) * 100;
      return {
        technique: item.technique,
        bypassRate: Math.round(bypassRate * 100) / 100, // Round to 2 decimals
        protectedCount: item.protected,
        unprotectedCount: item.unprotected,
        total,
      };
    })
    .filter((item) => item.total > 0) // Exclude zero-total groups
    .sort((a, b) => b.bypassRate - a.bypassRate) // Sort descending
    .slice(0, limit)
    .map((item) => ({
      technique: item.technique,
      bypassRate: item.bypassRate,
      protectedCount: item.protectedCount,
      unprotectedCount: item.unprotectedCount,
    }));
}

/**
 * Sort hosts by defense score ascending (weakest first), slice to limit (default 5).
 * Does not mutate the input array.
 */
export function weakestHosts(
  items: DefenseScoreByHostItem[],
  limit: number = 5
): DefenseScoreByHostItem[] {
  return [...items].sort((a, b) => a.score - b.score).slice(0, limit);
}

/**
 * Sum the unprotected count across all technique distribution items.
 */
export function totalBypassedCount(items: TechniqueDistributionItem[]): number {
  return items.reduce((sum, item) => sum + item.unprotected, 0);
}

/**
 * Compute delta as last - value at lookback distance from a numeric series.
 * Returns null if series length <= lookback.
 * Result is rounded to 1 decimal place.
 */
export function scoreDelta(series: number[], lookback: number = 7): number | null {
  if (series.length <= lookback) {
    return null;
  }
  const last = series[series.length - 1];
  const previous = series[series.length - 1 - lookback];
  const delta = last - previous;
  return Math.round(delta * 10) / 10; // Round to 1 decimal
}
