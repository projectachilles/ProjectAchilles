import { useCallback, useEffect, useState } from 'react';
import { aboutApi } from '@/services/api/about';
import type { AboutResponse } from '@/types/about';

/**
 * Loads GET /api/about once `enabled` turns true (the dialog opened, or the
 * viewer may see the update dot). No polling: the backend refreshes its own
 * answer once a day.
 */
export function useAbout(enabled: boolean) {
  const [about, setAbout] = useState<AboutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    aboutApi
      .get()
      .then((data) => {
        if (cancelled) return;
        setAbout(data);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { about, loading, failed, reload } as const;
}
