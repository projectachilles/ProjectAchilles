import { useEffect, useRef } from 'react';

/**
 * Visibility-aware polling hook. Pauses when the browser tab is hidden,
 * resumes immediately on focus with an instant catch-up call.
 *
 * Uses useRef for the callback to avoid resetting the interval when
 * the callback's dependencies change.
 */
export function usePolling(callback: () => void | Promise<void>, intervalMs: number) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (id !== null) return;
      id = setInterval(() => callbackRef.current(), intervalMs);
    }

    function stop() {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stop();
      } else {
        // Catch up immediately on tab focus, then resume interval
        callbackRef.current();
        start();
      }
    }

    // Start polling if tab is currently visible
    if (!document.hidden) {
      start();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs]);
}
