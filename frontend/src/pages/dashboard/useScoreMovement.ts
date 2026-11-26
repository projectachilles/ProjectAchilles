import { useEffect, useState } from 'react';
import { analyticsApi, type ScoreMovementResponse } from '@/services/api/analytics';
import { getDateRangeFilter, type DateRangeValue } from '@/lib/timeRange';

interface ScoreMovementState {
  data: ScoreMovementResponse | null;
  loading: boolean;
  error: boolean;
}

const IDLE: ScoreMovementState = { data: null, loading: false, error: false };

/**
 * Loads the "What moved the score" figures for the Dashboard's range. Makes no
 * request while disabled, and a failed request becomes `error`, never a throw.
 */
export function useScoreMovement(range: DateRangeValue, enabled: boolean): ScoreMovementState {
  const [state, setState] = useState<ScoreMovementState>(IDLE);
  const { preset, from, to } = range;

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((prev) => ({ data: prev.data, loading: true, error: false }));
    analyticsApi
      .getScoreMovement(getDateRangeFilter({ preset, from, to }))
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [preset, from, to, enabled]);

  // The first render of an enabled hook is already loading, before the effect runs.
  if (enabled && state === IDLE) return { data: null, loading: true, error: false };
  return state;
}
