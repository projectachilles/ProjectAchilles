/**
 * Auto-refresh hook — polls an API at a configurable interval.
 */

import { useEffect, useRef } from 'react';
import { useApi } from './useApi.js';

interface UsePollingResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 10000,
  deps: unknown[] = [],
): UsePollingResult<T> {
  const api = useApi(fetcher, deps);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      api.refresh();
    }, intervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [intervalMs]);

  return api;
}
