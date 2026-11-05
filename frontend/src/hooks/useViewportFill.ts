import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const MIN_HEIGHT_PX = 320;

/**
 * Height that makes an element reach the bottom of the viewport, so a pane
 * inside it can scroll on its own. Returns `height: null` while disabled
 * (small screens keep natural page scroll).
 */
export function useViewportFill<T extends HTMLElement>(
  enabled: boolean,
  bottomGapPx = 24,
): { ref: RefObject<T | null>; height: number | null } {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!enabled || !el) {
      setHeight(null);
      return;
    }
    const next = Math.max(
      MIN_HEIGHT_PX,
      Math.round(window.innerHeight - el.getBoundingClientRect().top - bottomGapPx),
    );
    setHeight((prev) => (prev === next ? prev : next));
  }, [enabled, bottomGapPx]);

  // Every render: the element may mount late (after a loading state) or move.
  // setHeight bails out when the value is unchanged, so this does not loop.
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('resize', measure);
    // The element's top moves when content above it (header, filter chip) changes size.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [enabled, measure]);

  return { ref, height: enabled ? height : null };
}
