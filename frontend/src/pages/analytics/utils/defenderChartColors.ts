// Semantic chart colors for the Defender tab, sourced from governed CSS
// tokens (`--chart-*`) so the meaning (green=detected/tests, red=missed/alerts,
// blue=test volume) stays consistent while still following the active
// light/dark theme. Values are `var(--...)` strings resolved by the browser
// at paint time — see frontend/src/styles/index.css for the token defs.

export const DEFENDER_CHART_COLORS = {
  /** Tests / Detected — green. */
  detected: 'var(--chart-protected)',
  /** Missed / Defender alerts (when paired with detected) — red. */
  missed: 'var(--chart-bypassed)',
  /** Test execution volume on the correlation timeline — blue. */
  tests: 'var(--chart-series-exec)',
  /** Alert volume on the correlation timeline — red. */
  alerts: 'var(--chart-series-alert)',
} as const;
