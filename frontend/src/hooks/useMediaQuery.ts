import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind `lg` breakpoint: the width at which the fixed sidebar appears. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Subscribe to a CSS media query. When `matchMedia` is unavailable (SSR, jsdom)
 * the hook returns `fallback` and never subscribes.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (hasMatchMedia() ? window.matchMedia(query).matches : fallback),
    [query, fallback],
  );
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * True at the `lg` breakpoint and above. Defaults to desktop when the
 * environment cannot answer, so tests and SSR exercise the desktop layout.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY, true);
}
