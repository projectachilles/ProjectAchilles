import type { TrendDataPoint } from '@/services/api/analytics';

export interface ForwardFilledTrendDataPoint extends TrendDataPoint {
  isCarriedForward: boolean;
}

/**
 * Applies "Last Observation Carried Forward" (LOCF) to trend data.
 * Days without test data (total === 0) inherit the previous day's score
 * instead of showing 0%, which would be misleading.
 */
export function applyForwardFill(data: TrendDataPoint[]): ForwardFilledTrendDataPoint[] {
  if (!data || data.length === 0) return [];

  let lastKnownScore: number | null = null;

  return data.map((point): ForwardFilledTrendDataPoint => {
    const hasData = point.total > 0;

    if (hasData) {
      lastKnownScore = point.score;
      return { ...point, isCarriedForward: false };
    }

    // No data on this day - carry forward previous score if available
    if (lastKnownScore !== null) {
      return { ...point, score: lastKnownScore, isCarriedForward: true };
    }

    // No prior data to carry forward - leave as-is (will show 0%)
    return { ...point, isCarriedForward: false };
  });
}
