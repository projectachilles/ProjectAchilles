import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The rendered width of an element, kept current as it resizes. Returns a ref
 * callback to put on the element and the width in CSS pixels (0 until it has
 * been measured, and where ResizeObserver does not exist).
 */
export function useElementWidth<T extends HTMLElement = HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width];
}
