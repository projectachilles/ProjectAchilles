import type { CSSProperties } from 'react';

/** Per-element stagger for `[data-anim]` / `[data-reveal]` (`--d` custom property). */
export function delay(seconds: number): CSSProperties {
  return { '--d': `${seconds}s` } as CSSProperties;
}
