import type { TrendDataPoint } from '@/services/api/analytics';

export interface ForwardFilledTrendDataPoint extends TrendDataPoint {
  isCarriedForward: boolean;
}

/**
 * Minimum percentage of average daily volume required for a data point
 * to be considered "meaningful". Below this threshold, LOCF is applied.
 *
 * Example: If average daily volume is 70 tests, and threshold is 0.15,
 * a day needs at least 10.5 tests to be considered meaningful.
 */
const MINIMUM_VOLUME_THRESHOLD_PERCENT = 0.15;

/**
 * Absolute minimum test count for a data point to be meaningful.
 * Even if the threshold calculation yields a lower number, at least
 * this many tests are required.
 */
const ABSOLUTE_MINIMUM_COUNT = 5;

/**
 * Applies "Last Observation Carried Forward" (LOCF) to trend data.
 * Days without sufficient test data inherit the previous day's score
 * instead of showing potentially misleading values.
 *
 * A day is considered to have "insufficient data" when:
 * - total === 0, OR
 * - total < max(ABSOLUTE_MINIMUM_COUNT, averageDailyVolume * MINIMUM_VOLUME_THRESHOLD_PERCENT)
 */
export function applyForwardFill(data: TrendDataPoint[]): ForwardFilledTrendDataPoint[] {
  if (!data || data.length === 0) return [];

  // Calculate average daily volume from days with data
  const daysWithData = data.filter(p => p.total > 0);
  const avgVolume = daysWithData.length > 0
    ? daysWithData.reduce((sum, p) => sum + p.total, 0) / daysWithData.length
    : 0;

  // Calculate minimum threshold for meaningful data
  const minThreshold = Math.max(
    ABSOLUTE_MINIMUM_COUNT,
    Math.floor(avgVolume * MINIMUM_VOLUME_THRESHOLD_PERCENT)
  );

  let lastKnownScore: number | null = null;

  return data.map((point): ForwardFilledTrendDataPoint => {
    const hasMeaningfulData = point.total >= minThreshold;

    if (hasMeaningfulData) {
      lastKnownScore = point.score;
      return { ...point, isCarriedForward: false };
    }

    // Insufficient data on this day - carry forward previous score if available
    if (lastKnownScore !== null) {
      return { ...point, score: lastKnownScore, isCarriedForward: true };
    }

    // No prior data to carry forward - leave as-is (will show 0%)
    return { ...point, isCarriedForward: false };
  });
}
