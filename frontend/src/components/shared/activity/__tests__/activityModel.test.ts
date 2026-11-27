import { describe, it, expect } from 'vitest';
import {
  BAR_MIN_PX,
  QUIET_BUCKETS,
  SEGMENT_MIN_PX,
  STRIP_HEIGHT_PX,
  barHeights,
  bucketLabel,
  bucketName,
  bucketTotal,
  sameBucket,
  type StripBucket,
} from '../activityModel';

const DAY = 86_400_000;
const day = (n: number, counts: [number, number, number] = [0, 0, 0]): StripBucket => {
  const from = Date.parse('2026-11-01T00:00:00.000Z') + (n - 1) * DAY;
  return {
    from: new Date(from).toISOString(),
    to: new Date(from + DAY - 1).toISOString(),
    // Drawing order, bottom first.
    segments: [
      { key: 'unprotected', tone: 'danger', label: 'unprotected', count: counts[0] },
      { key: 'noVerdict', tone: 'muted', label: 'no verdict', count: counts[1] },
      { key: 'protected', tone: 'accent', label: 'protected', count: counts[2] },
    ],
  };
};

describe('the constants', () => {
  it('are the ones the design names', () => {
    expect(STRIP_HEIGHT_PX).toBe(40);
    expect(BAR_MIN_PX).toBe(4);
    expect(SEGMENT_MIN_PX).toBe(2);
    expect(QUIET_BUCKETS).toBe(3);
  });
});

describe('bucketTotal', () => {
  it('adds the segments', () => {
    expect(bucketTotal(day(1, [10, 2, 30]))).toBe(42);
    expect(bucketTotal(day(1))).toBe(0);
  });
});

describe('barHeights', () => {
  it('scales by the square root, so one huge bucket does not flatten the others', () => {
    const heights = barHeights([day(1, [0, 0, 100]), day(2, [0, 0, 1]), day(3), day(4, [0, 0, 25])]);
    // Linear would give 40, 0.4, 0, 10.
    expect(heights.map((h) => h.bar)).toEqual([40, 4, 0, 20]);
  });

  it('gives every bucket with a run a bar tall enough to see', () => {
    const heights = barHeights([day(1, [0, 0, 5000]), day(2, [1, 0, 0])]);
    expect(heights[1].bar).toBe(BAR_MIN_PX);
  });

  it('shares a bar between its segments in proportion, each one visible, summing to the bar', () => {
    const [h] = barHeights([day(1, [1, 0, 99])]);
    expect(h.bar).toBe(40);
    // 1 of 100 would be 0.4 px: it gets the minimum, and the largest gives it up.
    expect(h.segments).toEqual([SEGMENT_MIN_PX, 0, 38]);
  });

  it('splits evenly what is even', () => {
    const [h] = barHeights([day(1, [10, 10, 20])]);
    expect(h.segments).toEqual([10, 10, 20]);
    expect(h.segments.reduce((a, b) => a + b, 0)).toBe(h.bar);
  });

  it('keeps the segments within a short bar', () => {
    // A 4 px bar with three segments cannot give each 2 px.
    const heights = barHeights([day(1, [0, 0, 10_000]), day(2, [1, 1, 1])]);
    const h = heights[1];
    expect(h.bar).toBe(4);
    expect(h.segments.reduce((a, b) => a + b, 0)).toBe(4);
    expect(h.segments.every((s) => s >= 1)).toBe(true);
  });

  it('gives every outcome its minimum where the bar has room', () => {
    // 6 px for three outcomes of very different size: none is squeezed out.
    const heights = barHeights([day(1, [0, 0, 1000]), day(2, [1, 1, 20])]);
    const h = heights[1];
    expect(h.bar).toBe(6);
    expect(h.segments).toEqual([2, 2, 2]);
  });

  it('has nothing to draw for no bucket, or none with a run', () => {
    expect(barHeights([])).toEqual([]);
    expect(barHeights([day(1), day(2)])).toEqual([
      { bar: 0, segments: [0, 0, 0] },
      { bar: 0, segments: [0, 0, 0] },
    ]);
  });
});

describe('bucketLabel', () => {
  it('names a day', () => {
    expect(bucketLabel(day(18), 'day', 'UTC')).toBe('Nov 18');
  });

  it('names an hour by its start', () => {
    const bucket = { from: '2026-11-18T14:00:00.000Z', to: '2026-11-18T14:59:59.999Z' };
    expect(bucketLabel(bucket, 'hour', 'UTC')).toBe('Nov 18, 14:00');
  });

  it('names a week by its first and last day', () => {
    expect(bucketLabel({ from: '2026-11-16T00:00:00.000Z', to: '2026-11-22T23:59:59.999Z' }, 'week', 'UTC')).toBe('Nov 16 – 22');
    expect(bucketLabel({ from: '2026-11-30T00:00:00.000Z', to: '2026-12-06T23:59:59.999Z' }, 'week', 'UTC')).toBe('Nov 30 – Dec 6');
  });

  it('names a week clipped to one day by that day', () => {
    expect(bucketLabel({ from: '2026-11-22T09:00:00.000Z', to: '2026-11-22T23:59:59.999Z' }, 'week', 'UTC')).toBe('Nov 22');
  });

  it('reads the instants in the given time zone', () => {
    // 02:00 UTC on the 18th is still the 17th four hours west.
    const bucket = { from: '2026-11-18T02:00:00.000Z', to: '2026-11-18T03:59:59.999Z' };
    expect(bucketLabel(bucket, 'day', 'America/Santo_Domingo')).toBe('Nov 17');
    expect(bucketLabel(bucket, 'hour', 'America/Santo_Domingo')).toBe('Nov 17, 22:00');
  });
});

describe('bucketName', () => {
  it('says everything the bar shows, worst first, without the outcomes that have none', () => {
    expect(bucketName(day(18, [10, 2, 30]), 'day', 'run', 'UTC')).toBe('Nov 18: 42 runs, 10 unprotected, 2 no verdict, 30 protected');
    expect(bucketName(day(18, [0, 0, 7]), 'day', 'run', 'UTC')).toBe('Nov 18: 7 runs, 7 protected');
  });

  it('counts one in the singular, and says when there is none', () => {
    expect(bucketName(day(18, [1, 0, 0]), 'day', 'run', 'UTC')).toBe('Nov 18: 1 run, 1 unprotected');
    expect(bucketName(day(18), 'day', 'run', 'UTC')).toBe('Nov 18: no runs');
  });

  it('writes large counts with separators', () => {
    expect(bucketName(day(18, [0, 0, 12345]), 'day', 'task', 'UTC')).toBe('Nov 18: 12,345 tasks, 12,345 protected');
  });
});

describe('sameBucket', () => {
  it('compares both instants', () => {
    const a = { from: '2026-11-18T00:00:00.000Z', to: '2026-11-18T23:59:59.999Z' };
    expect(sameBucket(a, { ...a })).toBe(true);
    expect(sameBucket(a, { ...a, to: '2026-11-19T23:59:59.999Z' })).toBe(false);
    expect(sameBucket(a, { ...a, from: '2026-11-17T00:00:00.000Z' })).toBe(false);
    expect(sameBucket(a, null)).toBe(false);
    expect(sameBucket(null, null)).toBe(false);
  });

  it('takes two spellings of one instant as the same', () => {
    expect(sameBucket(
      { from: '2026-11-18T00:00:00.000Z', to: '2026-11-18T23:59:59.999Z' },
      { from: '2026-11-18T00:00:00Z', to: '2026-11-18T19:59:59.999-04:00' },
    )).toBe(true);
  });
});
