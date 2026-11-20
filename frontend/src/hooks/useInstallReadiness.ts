import { useCallback, useEffect, useRef, useState } from 'react';
import { agentApi } from '@/services/api/agent';
import type { InstallReadiness } from '@/types/agent';

export type InstallReadinessState =
  | { status: 'loading' }
  /** The check could not be made (older or serverless backend, no permission, network). Not the same as "missing". */
  | { status: 'unknown' }
  | { status: 'ready'; data: InstallReadiness };

/**
 * Whether the server has a downloadable agent binary per platform. Re-checked
 * when the window gets focus, so a build finished in another tab shows up
 * without a reload. A failed re-check keeps the last good answer.
 */
export function useInstallReadiness(enabled = true): InstallReadinessState & { refresh: () => void } {
  const [state, setState] = useState<InstallReadinessState>({ status: 'loading' });
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    agentApi.getInstallReadiness()
      .then((data) => {
        if (mounted.current) setState({ status: 'ready', data });
      })
      .catch(() => {
        if (mounted.current) setState((prev) => (prev.status === 'ready' ? prev : { status: 'unknown' }));
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [enabled, refresh]);

  return { ...state, refresh };
}
