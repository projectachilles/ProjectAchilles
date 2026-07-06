import { useEffect, useState } from 'react';

/** Resolve a CSS custom property off the document root. '' when unavailable. */
export function getChartToken(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readAll(names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = getChartToken(n);
  return out;
}

/**
 * Resolved chart-token values that re-read when the theme (root class) changes.
 * Use ONLY when a raw color value is needed in JS (computed ramps/gradients);
 * prefer `var(--token)` directly in Recharts fills where a static string works.
 */
export function useChartTokens(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>(() => readAll(names));
  const key = names.join(',');

  useEffect(() => {
    const update = () => setValues(readAll(names));
    update();
    if (typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return values;
}
