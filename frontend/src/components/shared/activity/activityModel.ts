import type { MarkTone } from '@/components/shared/marks/markTone';

/**
 * The drawing rules of the activity strip: how tall a bar is, how it is named,
 * when the strip is too quiet for bars. It counts nothing and knows no outcome:
 * a page hands it buckets whose segments are already counted and toned.
 */

export type StripInterval = 'hour' | 'day' | 'week';

/** One outcome within a bucket. */
export interface StripSegment {
  key: string;
  tone: MarkTone;
  /** As it reads after a count: "protected", "no verdict". */
  label: string;
  count: number;
}

/** Two ISO instants, both inclusive. */
export interface BucketRef {
  from: string;
  to: string;
}

export interface StripBucket extends BucketRef {
  /** In drawing order, bottom first (the worst outcome at the bottom). */
  segments: StripSegment[];
}

/** The height of the tallest bar. */
export const STRIP_HEIGHT_PX = 40;
/** A bucket with any run is at least this tall: one run in a busy window must still be seen and hit. */
export const BAR_MIN_PX = 4;
/** An outcome present in a bar is at least this tall, where the bar has room. */
export const SEGMENT_MIN_PX = 2;
/** With fewer buckets than this holding runs, bars would be a blank track: the strip lists the buckets as text. */
export const QUIET_BUCKETS = 3;

const LOCALE = 'en-US';

export function bucketTotal(bucket: StripBucket): number {
  return bucket.segments.reduce((sum, segment) => sum + segment.count, 0);
}

/** A bar's height shared between its segments: in proportion, each present one visible, summing to the bar. */
function segmentHeights(bar: number, counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (bar === 0 || total === 0) return counts.map(() => 0);
  const heights = counts.map((c) => (c > 0 ? Math.max(SEGMENT_MIN_PX, Math.round((bar * c) / total)) : 0));
  const largest = counts.indexOf(Math.max(...counts));
  let sum = heights.reduce((a, b) => a + b, 0);
  // Rounding and the minimum can leave the sum off by a few pixels: the largest outcome gives or takes them.
  // (A bar too short for every minimum, 4 px with three outcomes, ends at 1 px for some.)
  while (sum < bar) {
    heights[largest]++;
    sum++;
  }
  while (sum > bar) {
    const tallest = heights.indexOf(Math.max(...heights));
    if (heights[tallest] === 0) break;
    heights[tallest]--;
    sum--;
  }
  return heights;
}

/**
 * Heights in pixels, one entry per bucket. By the square root of the count, so
 * a day with a hundred times the runs is ten times as tall, not a hundred, and
 * the quiet days beside it stay readable. An empty bucket has no bar.
 */
export function barHeights(buckets: StripBucket[]): { bar: number; segments: number[] }[] {
  const totals = buckets.map(bucketTotal);
  const max = Math.max(0, ...totals);
  return buckets.map((bucket, i) => {
    const bar = totals[i] > 0 ? Math.max(BAR_MIN_PX, Math.round(STRIP_HEIGHT_PX * Math.sqrt(totals[i] / max))) : 0;
    return { bar, segments: segmentHeights(bar, bucket.segments.map((s) => s.count)) };
  });
}

function dayParts(instant: number, timeZone?: string): { month: string; day: string } {
  const parts = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { month: part('month'), day: part('day') };
}

/** "Nov 18", "Nov 18, 14:00" or "Nov 16 – 22": what a bucket is called, in the zone it was cut in. */
export function bucketLabel(bucket: BucketRef, interval: StripInterval, timeZone?: string): string {
  const from = Date.parse(bucket.from);
  const to = Date.parse(bucket.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return '';
  const start = dayParts(from, timeZone);
  const startDay = `${start.month} ${start.day}`;
  if (interval === 'hour') {
    const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(from);
    return `${startDay}, ${time}`;
  }
  if (interval === 'day') return startDay;
  const end = dayParts(to, timeZone);
  if (end.month === start.month && end.day === start.day) return startDay;
  return end.month === start.month ? `${startDay} – ${end.day}` : `${startDay} – ${end.month} ${end.day}`;
}

const count = (n: number, unit: string) => `${n.toLocaleString(LOCALE)} ${unit}${n === 1 ? '' : 's'}`;

/** "12 runs": a bucket's total with its unit. */
export function bucketCount(bucket: StripBucket, unit: string): string {
  return count(bucketTotal(bucket), unit);
}

/**
 * Everything a bar shows, in words: "Nov 18: 42 runs, 10 unprotected, 2 no
 * verdict, 30 protected". The bar's accessible name and the line under the
 * strip, so the colours are never the only way to read it.
 */
export function bucketName(bucket: StripBucket, interval: StripInterval, unit: string, timeZone?: string): string {
  const label = bucketLabel(bucket, interval, timeZone);
  const total = bucketTotal(bucket);
  if (total === 0) return `${label}: no ${unit}s`;
  const parts = bucket.segments.filter((s) => s.count > 0).map((s) => `${s.count.toLocaleString(LOCALE)} ${s.label}`);
  return `${label}: ${count(total, unit)}, ${parts.join(', ')}`;
}

/** The same stretch of time, however its two instants are written. */
export function sameBucket(a: BucketRef | null, b: BucketRef | null): boolean {
  if (!a || !b) return false;
  return Date.parse(a.from) === Date.parse(b.from) && Date.parse(a.to) === Date.parse(b.to);
}
