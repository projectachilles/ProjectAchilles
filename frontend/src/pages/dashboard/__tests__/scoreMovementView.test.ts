import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildScoreMovementView, formatMovementDay } from '../scoreMovementView';
import { FULL } from './scoreMovementFixture';

describe('buildScoreMovementView', () => {
  // Dates leave out the year only in the current year, so the clock is pinned.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the card copy', () => {
    const v = buildScoreMovementView(FULL, 'last 30d');
    expect(v.title).toBe('What moved the score · last 30d');
    expect(v.description).toBe('52 → 289 pairs in the score · 4 → 11 failing');
    expect(v.pill).toBe('8 failures not re-tested');
    expect(v.failures).toMatchObject({ empty: null, headline: '32 of 46 fixed', rate: '70%' });
    expect(v.failures.segments).toEqual([
      { list: 'fixed', label: 'Fixed', hint: 're-tested, now protected', count: 32, tone: 'accent' },
      { list: 'stillFailing', label: 'Still failing', hint: 're-tested, still gets through', count: 6, tone: 'danger' },
      { list: 'notRetested', label: 'Not re-tested', hint: 'no run since it failed', count: 5, tone: 'warning' },
      { list: 'leftUntested', label: 'Left the score untested', hint: 'older than the range, never re-run', count: 3, tone: 'faint' },
    ]);
    expect(v.failures.note).toBe(
      '46 failures = 4 open on Oct 27 + 35 new tests that got through + 5 regressions + 2 first time on an endpoint',
    );
    expect(v.newTests).toMatchObject({ empty: null, headline: '193 of 228 stopped', rate: '85%' });
    expect(v.newTests.segments).toEqual([
      { list: 'newStopped', label: 'Stopped on the first run', count: 193, tone: 'accent' },
      { list: 'newGotThrough', label: 'Got through on the first run', count: 35, tone: 'danger' },
    ]);
    expect(v.newTests.note).toBe(
      '31 tests run for the first time in this organization, across 228 test × endpoint pairs. Of the 35 that got through: 27 fixed since, 8 still open.',
    );
    expect(v.footer).toEqual([
      'Regressed: 5 pairs were protected and got through, 3 fixed since',
      'First time on an endpoint: 12 pairs, 10 stopped on the first run. Counted apart from new tests',
      '4 failing pairs are risk-accepted and not counted',
      '2 failures the score still counts were fixed by blocking the test before it started',
      '1 open failure is counted twice by the score',
    ]);
  });

  it('leaves out zero terms, zero footer lines and the pill', () => {
    const v = buildScoreMovementView(
      {
        ...FULL,
        failures: {
          ...FULL.failures,
          total: 4,
          fixed: 4,
          stillFailing: 0,
          notRetested: 0,
          leftUntested: 0,
          fixRate: 100,
          origins: { openAtStart: 0, olderRetested: 1, regression: 0, newTest: 3, firstOnEndpoint: 0 },
        },
        regressed: { total: 0, fixed: 0 },
        firstOnEndpoint: { pairs: 0, stopped: 0 },
        riskAccepted: null,
        scoreDifference: { fixedButCounted: 0, countedTwice: 0 },
      },
      'last 30d',
    );
    expect(v.pill).toBeNull();
    expect(v.failures.note).toBe('4 failures = 1 older failure re-tested + 3 new tests that got through');
    expect(v.footer).toEqual([]);
  });

  it('has empty states for no failures and no new tests', () => {
    const v = buildScoreMovementView(
      {
        ...FULL,
        failures: {
          total: 0,
          fixed: 0,
          stillFailing: 0,
          notRetested: 0,
          leftUntested: 0,
          fixRate: null,
          origins: { openAtStart: 0, olderRetested: 0, regression: 0, newTest: 0, firstOnEndpoint: 0 },
        },
        newTests: { tests: 0, pairs: 0, stopped: 0, gotThrough: 0, rate: null, gotThroughFixed: 0, gotThroughOpen: 0 },
      },
      'last 30d',
    );
    expect(v.failures).toMatchObject({ empty: 'No failures in this period', rate: null, note: null });
    expect(v.newTests).toMatchObject({ empty: 'No new tests in this period', rate: null, note: null });
  });

  it('adds the year to a date in another year than today', () => {
    vi.setSystemTime(new Date('2027-02-10T12:00:00Z'));
    expect(buildScoreMovementView(FULL, 'last 30d').failures.note).toBe(
      '46 failures = 4 open on Oct 27, 2026 + 35 new tests that got through + 5 regressions + 2 first time on an endpoint',
    );
    expect(formatMovementDay('2027-01-05T12:00:00Z')).toBe('Jan 5');
  });

  it('writes counts of 1,000 and more with a thousands separator', () => {
    const v = buildScoreMovementView(
      {
        ...FULL,
        pairs: { start: 1052, end: 1289 },
        failing: { start: 1004, end: 1011 },
        failures: { ...FULL.failures, total: 1046, fixed: 1032, notRetested: 1005, leftUntested: 3 },
        newTests: { ...FULL.newTests, pairs: 2228, stopped: 2193 },
        riskAccepted: 1200,
      },
      'last 30d',
    );
    expect(v.description).toBe('1,052 → 1,289 pairs in the score · 1,004 → 1,011 failing');
    expect(v.pill).toBe('1,008 failures not re-tested');
    expect(v.failures.headline).toBe('1,032 of 1,046 fixed');
    expect(v.failures.note?.startsWith('1,046 failures = ')).toBe(true);
    expect(v.newTests.headline).toBe('2,193 of 2,228 stopped');
    expect(v.newTests.note).toContain('across 2,228 test × endpoint pairs.');
    expect(v.footer).toContain('1,200 failing pairs are risk-accepted and not counted');
  });

  it('uses the singular', () => {
    const v = buildScoreMovementView({ ...FULL, failures: { ...FULL.failures, notRetested: 1, leftUntested: 0 } }, 'last 30d');
    expect(v.pill).toBe('1 failure not re-tested');
  });
});
