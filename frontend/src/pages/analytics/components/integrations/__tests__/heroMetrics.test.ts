import { describe, it, expect } from 'vitest';
import {
  alertWeekDelta,
  firstToLastDelta,
  formatScore,
  stillOpenFootnote,
  weakestChecks,
  ztaTrendDays,
} from '../heroMetrics';

const day = (d: string, count: number, interval: 'day' | 'week' = 'day') => ({ date: d, count, linked: 0, interval });

describe('ztaTrendDays', () => {
  it('is the ceiling of the window in days, capped at 365', () => {
    expect(ztaTrendDays({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' })).toBe(30);
    expect(ztaTrendDays({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-01T01:00:00.000Z' })).toBe(1);
    expect(ztaTrendDays({ from: '2000-01-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' })).toBe(365);
  });

  it('falls back to 30 on an unparseable window', () => {
    expect(ztaTrendDays({ from: 'nope', to: 'nope' })).toBe(30);
  });
});

describe('firstToLastDelta', () => {
  it('is undefined below two finite points (never NaN)', () => {
    expect(firstToLastDelta([])).toBeUndefined();
    expect(firstToLastDelta([80])).toBeUndefined();
    expect(firstToLastDelta([80, Number.NaN])).toBeUndefined();
  });

  it('is last minus first', () => {
    expect(firstToLastDelta([80, 81, 82.5])).toBe(2.5);
  });
});

describe('alertWeekDelta', () => {
  const window = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

  it('compares the last 7 days with the 7 before, anchored at window.to', () => {
    const trend = [
      day('2026-09-10T00:00:00.000Z', 100), // outside both weeks
      day('2026-09-18T00:00:00.000Z', 2), // prior week
      day('2026-09-23T00:00:00.000Z', 1), // prior week
      day('2026-09-25T00:00:00.000Z', 5), // recent week
      day('2026-09-30T00:00:00.000Z', 4), // recent week
    ];
    expect(alertWeekDelta(trend, window)).toBe(6);
  });

  it('is undefined for weekly buckets, an empty trend, or a window under 14 days', () => {
    expect(alertWeekDelta([day('2026-09-28T00:00:00.000Z', 3, 'week')], window)).toBeUndefined();
    expect(alertWeekDelta([], window)).toBeUndefined();
    expect(
      alertWeekDelta([day('2026-09-28T00:00:00.000Z', 3)], {
        from: '2026-09-24T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    ).toBeUndefined();
  });
});

describe('stillOpenFootnote', () => {
  it('reads linkedOpen of bySource.test', () => {
    expect(
      stillOpenFootnote({
        bySource: { all: 26, test: 11, organic: 15 },
        bySeverity: {},
        autoResolved: 4,
        linkedOpen: 7,
      }),
    ).toBe('7 of 11 test alerts still open');
    expect(stillOpenFootnote(undefined)).toBeUndefined();
  });
});

describe('formatScore', () => {
  it('keeps integers and rounds the rest to one decimal', () => {
    expect(formatScore(61)).toBe('61');
    expect(formatScore(61.25)).toBe('61.3');
  });
});

describe('weakestChecks', () => {
  const checks = [
    { label: 'Reporting', evaluated: 10, passed: 10 },
    { label: 'Protect mode', evaluated: 10, passed: 7 },
    { label: 'Anti-tamper on', evaluated: 10, passed: 7 },
    { label: 'Firewall control on', evaluated: 0, passed: 0 },
    { label: 'Disk encrypted', evaluated: 4, passed: 1 },
  ];

  it('returns the lowest pass rates first, skipping unevaluated checks, ties in input order', () => {
    expect(weakestChecks(checks, 3)).toEqual([
      { label: 'Disk encrypted', pct: 25 },
      { label: 'Protect mode', pct: 70 },
      { label: 'Anti-tamper on', pct: 70 },
    ]);
  });

  it('returns fewer when fewer checks were evaluated', () => {
    expect(weakestChecks([{ label: 'Reporting', evaluated: 2, passed: 2 }], 3)).toEqual([{ label: 'Reporting', pct: 100 }]);
    expect(weakestChecks([], 3)).toEqual([]);
  });
});
