// Pure helpers behind the integration tabs' hero tiles.

import type { DeltaTone } from '../HeroStatTile';
import type { AlertFacetCounts, IntegrationTrendPoint, TimeWindow } from '@/services/api/integrationTypes';

const DAY_MS = 86_400_000;
/** Longest ZTA trend the backend is asked for. */
const MAX_ZTA_TREND_DAYS = 365;

/** Whole days in the window, 1-365: the ZTA score trend's `days` param. */
export function ztaTrendDays(window: TimeWindow): number {
  const days = Math.ceil((Date.parse(window.to) - Date.parse(window.from)) / DAY_MS);
  if (!Number.isFinite(days)) return 30;
  return Math.min(MAX_ZTA_TREND_DAYS, Math.max(1, days));
}

/** Last minus first, or undefined when there are fewer than 2 usable points. */
export function firstToLastDelta(values: number[]): number | undefined {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return undefined;
  return finite[finite.length - 1] - finite[0];
}

/**
 * Alerts in the 7 days before `window.to` minus the 7 days before that.
 * Undefined unless the trend is daily and the window covers both weeks.
 */
export function alertWeekDelta(trend: IntegrationTrendPoint[], window: TimeWindow): number | undefined {
  const end = Date.parse(window.to);
  const start = Date.parse(window.from);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end - start < 14 * DAY_MS) return undefined;
  if (trend.length === 0 || trend.some((p) => p.interval === 'week')) return undefined;
  const weekAgo = end - 7 * DAY_MS;
  const twoWeeksAgo = end - 14 * DAY_MS;
  let recent = 0;
  let prior = 0;
  for (const p of trend) {
    const t = Date.parse(p.date);
    if (!Number.isFinite(t) || !Number.isFinite(p.count)) continue;
    if (t >= weekAgo && t <= end) recent += p.count;
    else if (t >= twoWeeksAgo && t < weekAgo) prior += p.count;
  }
  return recent - prior;
}

/** More alerts is bad: up = negative tone, down = positive. */
export function inverseDeltaTone(delta: number | undefined): DeltaTone | undefined {
  if (delta === undefined) return undefined;
  if (delta > 0) return 'negative';
  if (delta < 0) return 'positive';
  return 'neutral';
}

/** "7 of 11 test alerts still open", or undefined without counts. */
export function stillOpenFootnote(counts: AlertFacetCounts | undefined): string | undefined {
  if (!counts) return undefined;
  return `${counts.linkedOpen.toLocaleString()} of ${counts.bySource.test.toLocaleString()} test alerts still open`;
}

/**
 * The `n` checks with the lowest pass rate (0-100), weakest first, among those
 * evaluated for at least one agent. Ties keep the backend's check order.
 */
export function weakestChecks(
  checks: Array<{ label: string; evaluated: number; passed: number }>,
  n: number,
): Array<{ label: string; pct: number }> {
  return checks
    .filter((c) => c.evaluated > 0)
    .map((c, i) => ({ label: c.label, pct: (c.passed / c.evaluated) * 100, i }))
    .sort((a, b) => a.pct - b.pct || a.i - b.i)
    .slice(0, n)
    .map(({ label, pct }) => ({ label, pct }));
}

/** Integer as-is, otherwise one decimal place. */
export function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Scroll the alert feed (`<section id="alert-feed">`) into view and move focus
 * there, so a keyboard user's next Tab lands in the feed's filters.
 */
export function scrollToAlertFeed(): void {
  const feed = document.getElementById('alert-feed');
  if (!feed) return;
  feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
  feed.focus({ preventScroll: true });
}
