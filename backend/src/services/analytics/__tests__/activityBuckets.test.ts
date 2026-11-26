import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_MAX_SPAN_MS,
  DAY_BUCKETS_MAX_SPAN_MS,
  HOUR_BUCKETS_MAX_SPAN_MS,
  activityBuckets,
  assertTimeZone,
  bucketIndexOf,
  chooseInterval,
} from '../activityBuckets.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

describe('chooseInterval', () => {
  it('uses hours up to 48 hours, days up to 62 days, weeks beyond', () => {
    expect(chooseInterval(HOUR_BUCKETS_MAX_SPAN_MS)).toBe('hour');
    expect(chooseInterval(HOUR_BUCKETS_MAX_SPAN_MS + 1)).toBe('day');
    expect(chooseInterval(DAY_BUCKETS_MAX_SPAN_MS)).toBe('day');
    expect(chooseInterval(DAY_BUCKETS_MAX_SPAN_MS + 1)).toBe('week');
  });

  it('keeps the thresholds at 48 hours and 62 days', () => {
    expect(HOUR_BUCKETS_MAX_SPAN_MS).toBe(48 * HOUR);
    expect(DAY_BUCKETS_MAX_SPAN_MS).toBe(62 * DAY);
    expect(ACTIVITY_MAX_SPAN_MS).toBe(365 * DAY);
  });
});

describe('assertTimeZone', () => {
  it('accepts a zone the runtime knows', () => {
    expect(() => assertTimeZone('UTC')).not.toThrow();
    expect(() => assertTimeZone('America/Santo_Domingo')).not.toThrow();
  });

  it('refuses one it does not know', () => {
    expect(() => assertTimeZone('Mars/Olympus')).toThrow(RangeError);
    expect(() => assertTimeZone('')).toThrow(RangeError);
  });
});

describe('activityBuckets', () => {
  it('cuts days at local midnight, whole days: the first and last reach past the window', () => {
    // UTC-4 all year: local midnight is 04:00 UTC.
    const from = ms('2026-11-10T12:00:00.000Z');
    const to = ms('2026-11-13T12:00:00.000Z');
    const { interval, buckets, capped } = activityBuckets(from, to, 'America/Santo_Domingo');

    expect(interval).toBe('day');
    expect(capped).toBe(false);
    expect(buckets.map((b) => [iso(b.from), iso(b.to)])).toEqual([
      ['2026-11-10T04:00:00.000Z', '2026-11-11T03:59:59.999Z'],
      ['2026-11-11T04:00:00.000Z', '2026-11-12T03:59:59.999Z'],
      ['2026-11-12T04:00:00.000Z', '2026-11-13T03:59:59.999Z'],
      ['2026-11-13T04:00:00.000Z', '2026-11-14T03:59:59.999Z'],
    ]);
  });

  it('gives a bucket the same two instants whenever it is asked for', () => {
    // "Last 30 days" is asked again a minute later: the window moved, today's bucket must not.
    // A bucket is selected by its instants; clipped to the window they would change with every request.
    const to = ms('2026-11-13T12:00:00.000Z');
    const first = activityBuckets(to - 30 * DAY, to, 'America/Santo_Domingo').buckets;
    const later = activityBuckets(to - 30 * DAY + 60_000, to + 60_000, 'America/Santo_Domingo').buckets;

    expect(later).toEqual(first);
  });

  it('gives a day 25 hours when the clocks go back', () => {
    const { buckets } = activityBuckets(ms('2026-10-24T12:00:00.000Z'), ms('2026-10-27T12:00:00.000Z'), 'Europe/London');
    // 25 October 2026: BST (UTC+1) until 02:00, then GMT.
    const day = buckets.find((b) => iso(b.from) === '2026-10-24T23:00:00.000Z');
    expect(day).toBeDefined();
    expect(iso(day!.to)).toBe('2026-10-25T23:59:59.999Z');
    expect(day!.to + 1 - day!.from).toBe(25 * HOUR);
  });

  it('gives a day 23 hours when the clocks go forward', () => {
    const { buckets } = activityBuckets(ms('2026-03-28T12:00:00.000Z'), ms('2026-03-31T12:00:00.000Z'), 'Europe/London');
    // 29 March 2026: GMT until 01:00, then BST.
    const day = buckets.find((b) => iso(b.from) === '2026-03-29T00:00:00.000Z');
    expect(day).toBeDefined();
    expect(iso(day!.to)).toBe('2026-03-29T22:59:59.999Z');
    expect(day!.to + 1 - day!.from).toBe(23 * HOUR);
  });

  it.each([
    ['Europe/London', '2026-10-20T07:13:00.000Z', '2026-11-02T19:41:00.000Z'],
    ['Europe/London', '2026-03-24T07:13:00.000Z', '2026-04-03T19:41:00.000Z'],
    ['America/Santo_Domingo', '2026-11-01T00:00:00.000Z', '2026-11-26T21:00:00.000Z'],
    ['Asia/Kolkata', '2026-11-25T03:20:00.000Z', '2026-11-26T21:05:00.000Z'],
    ['Australia/Lord_Howe', '2026-09-28T00:00:00.000Z', '2026-10-10T00:00:00.000Z'],
    ['UTC', '2026-01-01T00:00:00.000Z', '2026-11-26T00:00:00.000Z'],
  ])('leaves no gap and no overlap (%s, %s to %s)', (tz, a, b) => {
    const from = ms(a);
    const to = ms(b);
    const { buckets } = activityBuckets(from, to, tz);

    // Whole buckets: they cover the window and reach at most one bucket past each end.
    expect(buckets[0].from).toBeLessThanOrEqual(from);
    expect(buckets[0].to).toBeGreaterThanOrEqual(from);
    expect(buckets[buckets.length - 1].from).toBeLessThanOrEqual(to);
    expect(buckets[buckets.length - 1].to).toBeGreaterThanOrEqual(to);
    for (let i = 0; i + 1 < buckets.length; i++) {
      expect(buckets[i].to + 1).toBe(buckets[i + 1].from);
      expect(buckets[i].from).toBeLessThanOrEqual(buckets[i].to);
    }
    // Every instant of the window is in exactly the bucket whose bounds hold it.
    for (let k = 0; k <= 1000; k++) {
      const t = from + Math.floor(((to - from) * k) / 1000);
      const i = bucketIndexOf(buckets, t);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(buckets[i].from).toBeLessThanOrEqual(t);
      expect(buckets[i].to).toBeGreaterThanOrEqual(t);
    }
  });

  it('starts every week on a Monday', () => {
    const from = ms('2026-08-28T10:00:00.000Z');
    const { interval, buckets } = activityBuckets(from, from + 90 * DAY, 'UTC');

    expect(interval).toBe('week');
    expect(buckets.length).toBeGreaterThanOrEqual(13);
    for (const b of buckets) {
      const start = new Date(b.from);
      expect(start.getUTCDay()).toBe(1);
      expect(iso(b.from).slice(11)).toBe('00:00:00.000Z');
    }
    // 28 August 2026 is a Friday: its week started on Monday the 24th.
    expect(iso(buckets[0].from)).toBe('2026-08-24T00:00:00.000Z');
    expect(iso(buckets[0].to)).toBe('2026-08-30T23:59:59.999Z');
  });

  it('starts a week on the local Monday, not the UTC one', () => {
    const from = ms('2026-08-28T10:00:00.000Z');
    const { buckets } = activityBuckets(from, from + 90 * DAY, 'America/Santo_Domingo');
    expect(iso(buckets[1].from)).toBe('2026-08-31T04:00:00.000Z');
  });

  it('cuts hours on the local hour in a zone half an hour off', () => {
    const from = ms('2026-11-26T03:20:00.000Z');
    const { interval, buckets } = activityBuckets(from, from + 6 * HOUR, 'Asia/Kolkata');

    expect(interval).toBe('hour');
    // UTC+5:30: local hours start at :30 UTC.
    expect(iso(buckets[0].from)).toBe('2026-11-26T02:30:00.000Z');
    expect(iso(buckets[1].from)).toBe('2026-11-26T03:30:00.000Z');
    expect(iso(buckets[2].from)).toBe('2026-11-26T04:30:00.000Z');
    expect(buckets).toHaveLength(7);
  });

  it('draws only the last 365 days of a longer window, and says so', () => {
    const to = ms('2026-11-26T12:00:00.000Z');
    const { interval, buckets, capped } = activityBuckets(to - 500 * DAY, to, 'UTC');

    expect(capped).toBe(true);
    expect(interval).toBe('week');
    // The week that holds the instant 365 days back.
    expect(buckets[0].from).toBeLessThanOrEqual(to - ACTIVITY_MAX_SPAN_MS);
    expect(buckets[0].to).toBeGreaterThanOrEqual(to - ACTIVITY_MAX_SPAN_MS);
    expect(new Date(buckets[0].from).getUTCDay()).toBe(1);
    expect(buckets.length).toBeLessThanOrEqual(54);
  });

  it('has no bucket for an empty or backwards window', () => {
    const t = ms('2026-11-26T12:00:00.000Z');
    expect(activityBuckets(t, t, 'UTC').buckets).toEqual([]);
    expect(activityBuckets(t, t - 1, 'UTC').buckets).toEqual([]);
    expect(activityBuckets(Number.NaN, t, 'UTC').buckets).toEqual([]);
  });

  it('refuses an unknown zone', () => {
    const t = ms('2026-11-26T12:00:00.000Z');
    expect(() => activityBuckets(t - DAY, t, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('bucketIndexOf', () => {
  const { buckets } = activityBuckets(ms('2026-11-10T12:00:00.000Z'), ms('2026-11-13T12:00:00.000Z'), 'America/Santo_Domingo');

  it('puts an instant on a boundary in the later bucket only', () => {
    const boundary = ms('2026-11-11T04:00:00.000Z');
    expect(bucketIndexOf(buckets, boundary)).toBe(1);
    expect(bucketIndexOf(buckets, boundary - 1)).toBe(0);
  });

  it('answers -1 outside the buckets', () => {
    expect(bucketIndexOf(buckets, buckets[0].from - 1)).toBe(-1);
    expect(bucketIndexOf(buckets, buckets[buckets.length - 1].to + 1)).toBe(-1);
    expect(bucketIndexOf([], 5)).toBe(-1);
    expect(bucketIndexOf(buckets, Number.NaN)).toBe(-1);
  });
});
