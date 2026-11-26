/**
 * Time buckets for the executions activity strip, in the caller's time zone.
 *
 * The bounds are computed here, once, and used for every count of a request
 * (the aggregation over standalone results and the pass over bundle runs), so
 * the two can never disagree about where a day starts.
 *
 * A bucket is the stretch of time during which the zone's wall clock shows the
 * same hour, day or week. That makes the buckets contiguous by construction on
 * a day the clocks change: a day is then 23 or 25 hours, and the hour that
 * happens twice is one bucket of two hours.
 *
 * Whoever counts by these buckets must count each one whole (see
 * activityBuckets): the first and last reach past the window.
 */

export type ActivityInterval = 'hour' | 'day' | 'week';

/** Epoch ms. `to` is inclusive: the next bucket starts at `to + 1`. */
export interface BucketBounds {
  from: number;
  to: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A window up to this long is drawn per hour. */
export const HOUR_BUCKETS_MAX_SPAN_MS = 48 * HOUR_MS;
/** A window up to this long is drawn per day; a longer one per week. */
export const DAY_BUCKETS_MAX_SPAN_MS = 62 * DAY_MS;
/** Only this much of a longer window is drawn (its end). */
export const ACTIVITY_MAX_SPAN_MS = 365 * DAY_MS;

/** Longer than any bucket of the interval, clock changes included: where the search for its end starts. */
const SEARCH_STEP_MS: Record<ActivityInterval, number> = {
  hour: 3 * HOUR_MS,
  day: 27 * HOUR_MS,
  week: 7 * DAY_MS + 3 * HOUR_MS,
};

/** More buckets than any window can have (365 days of weeks, 62 days, 48 hours, with their clipped ends). */
const MAX_BUCKETS = 400;

const WEEKDAY_FROM_MONDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function zoneFormat(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
  });
}

/** Throws a RangeError for a time zone the runtime does not know. */
export function assertTimeZone(tz: string): void {
  zoneFormat(tz);
}

export function chooseInterval(spanMs: number): ActivityInterval {
  if (spanMs <= HOUR_BUCKETS_MAX_SPAN_MS) return 'hour';
  if (spanMs <= DAY_BUCKETS_MAX_SPAN_MS) return 'day';
  return 'week';
}

/** What the zone's wall clock shows at an instant, reduced to the bucket it is in. */
function bucketKey(format: Intl.DateTimeFormat, interval: ActivityInterval, t: number): string {
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(t)) parts[part.type] = part.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (interval === 'hour') return `${date}T${parts.hour}`;
  if (interval === 'day') return date;
  // The week's Monday, as a date.
  const monday = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - (WEEKDAY_FROM_MONDAY[parts.weekday] ?? 0) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

/** The first instant after `start` at which the wall clock is in another bucket. */
function nextBoundary(format: Intl.DateTimeFormat, interval: ActivityInterval, start: number): number {
  const key = bucketKey(format, interval, start);
  let lo = start;
  let hi = start + SEARCH_STEP_MS[interval];
  for (let guard = 0; guard < 8 && bucketKey(format, interval, hi) === key; guard++) hi += SEARCH_STEP_MS[interval];
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (bucketKey(format, interval, mid) === key) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The first instant of the bucket the wall clock is in at `t`. */
function bucketStart(format: Intl.DateTimeFormat, interval: ActivityInterval, t: number): number {
  const key = bucketKey(format, interval, t);
  let hi = t;
  let lo = t - SEARCH_STEP_MS[interval];
  for (let guard = 0; guard < 8 && bucketKey(format, interval, lo) === key; guard++) lo -= SEARCH_STEP_MS[interval];
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (bucketKey(format, interval, mid) === key) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The buckets that cover a window: whole hours, days or weeks, so the first
 * starts at or before the window and the last ends at or after it. They are
 * not clipped to the window on purpose. A bucket is identified by its two
 * instants (the page narrows to them, and keeps them in the address), and a
 * window like "the last 30 days" moves with every request: clipped, today's
 * bucket would be another bucket a minute later. A window longer than a year
 * keeps its last 365 days (`capped`).
 */
export function activityBuckets(
  fromMs: number,
  toMs: number,
  tz: string,
): { interval: ActivityInterval; buckets: BucketBounds[]; capped: boolean } {
  const format = zoneFormat(tz);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return { interval: 'day', buckets: [], capped: false };
  }
  const capped = toMs - fromMs > ACTIVITY_MAX_SPAN_MS;
  const from = capped ? toMs - ACTIVITY_MAX_SPAN_MS : fromMs;
  const interval = chooseInterval(toMs - from);

  const buckets: BucketBounds[] = [];
  let start = bucketStart(format, interval, from);
  while (start <= toMs && buckets.length < MAX_BUCKETS) {
    const next = nextBoundary(format, interval, start);
    buckets.push({ from: start, to: next - 1 });
    start = next;
  }
  return { interval, buckets, capped };
}

/** The index of the bucket that holds an instant; -1 when none does. */
export function bucketIndexOf(buckets: BucketBounds[], ts: number): number {
  if (!Number.isFinite(ts)) return -1;
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts < buckets[mid].from) hi = mid - 1;
    else if (ts > buckets[mid].to) lo = mid + 1;
    else return mid;
  }
  return -1;
}
