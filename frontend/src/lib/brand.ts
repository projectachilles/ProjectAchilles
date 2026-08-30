/**
 * Brand configuration — ProjectAchilles is an umbrella for several f0_*
 * products, so the console wordmark stays configurable per deployment.
 *
 * The wordmark renders two-tone: the part before the first underscore in
 * the foreground color, the underscore and the rest in the accent color,
 * followed by a blinking block cursor (see the AppShell brand block).
 */
export const WORDMARK: string = import.meta.env.VITE_BRAND_WORDMARK ?? 'f0_csv';

export const TAGLINE: string =
  import.meta.env.VITE_BRAND_TAGLINE ?? 'continuous security testing';

export const CONSOLE_CAPTION = `${WORDMARK} console`;

/** Split the wordmark for two-tone rendering: ["f0", "_csv"]. */
export function splitWordmark(mark: string = WORDMARK): [string, string] {
  const i = mark.indexOf('_');
  if (i === -1) return [mark, ''];
  return [mark.slice(0, i), mark.slice(i)];
}
