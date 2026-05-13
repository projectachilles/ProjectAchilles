// Semantic chart colors for the Defender tab. Kept as named OKLCH constants
// rather than CSS variables so the meaning (green=detected/tests, red=missed/alerts,
// blue=test volume) is consistent across all three themes — for charts where the
// color is the legend, theme-shifting the hue would make the chart harder to read
// across themes, not easier.

export const DEFENDER_CHART_COLORS = {
  /** Tests / Detected — green. */
  detected: 'oklch(0.65 0.22 145)',
  /** Missed / Defender alerts (when paired with detected) — red. */
  missed: 'oklch(0.6 0.22 25)',
  /** Test execution volume on the correlation timeline — blue. */
  tests: 'oklch(0.6 0.15 240)',
  /** Alert volume on the correlation timeline — red. */
  alerts: 'oklch(0.65 0.22 25)',
} as const;
