import { describe, it, expect } from 'vitest';
import { buildScoreMovement, classifyItems, MOVEMENT_LIST_LIMIT } from '../scoreMovement.js';
import { latestPairsAsOf, summarizePairs } from '../posture.js';
import type { PairRun, PostureWindow } from '../posture.js';

// What became of each failing test on each endpoint in a period. These tests
// build pair runs by hand; days are relative to the period start, and a
// negative day is a result before it (a prior result).

const DAY = 86_400_000;
const FROM = Date.parse('2026-10-27T00:00:00Z');
const window: PostureWindow = { fromMs: FROM, toMs: FROM + 30 * DAY, freshnessMs: 30 * DAY, step: 'day', label: '30d' };
const T1 = 'a0000000-1234-4abc-8def-000000000001';
const T2 = 'a0000000-1234-4abc-8def-000000000002';
const CH = 'b0000000-1234-4abc-8def-000000000001';
const at = (day: number, hour = 12) => FROM + day * DAY + hour * 3_600_000;
const mk = (pairKey: string, hostname: string, ts: number, ok: boolean, extra: Partial<PairRun> = {}): PairRun => ({
  pairKey, ts, protected: ok, strictProtected: ok, errorCodes: [ok ? 126 : 101], errorNames: [],
  hostname, testName: 'Test', techniques: [], category: 'intel-driven', ...extra,
});
const plain = (day: number, ok: boolean, o: { test?: string; host?: string; org?: string; hour?: number } = {}) =>
  mk(`${o.org ?? 'org-a'}|${o.test ?? T1}|${o.host ?? 'h1'}`, o.host ?? 'h1', at(day, o.hour), ok);
const chain = (day: number, ok: boolean, o: { test?: string; host?: string } = {}) =>
  mk(`org-a|bundle:${o.test ?? T1}|${o.host ?? 'h1'}`, o.host ?? 'h1', at(day), ok);
const control = (day: number, ok: boolean) =>
  mk(`org-a|${CH}::CH-1|h1`, 'h1', at(day), ok, { category: 'cyber-hygiene' });
const split = (runs: PairRun[]) => ({ prior: runs.filter(r => r.ts < FROM), period: runs.filter(r => r.ts >= FROM) });
const one = (runs: PairRun[], known: string[] = []) => {
  const items = classifyItems({ window, ...split(runs), knownTests: new Set(known) });
  expect(items).toHaveLength(1);
  return items[0];
};
const KNOWN = [`org-a|${T1}`];
const build = (runs: PairRun[], known: string[] = [], raw: PairRun[] | null = null) => buildScoreMovement({
  window, ...split(runs), rawPrior: raw && split(raw).prior, rawPeriod: raw && split(raw).period, knownTests: new Set(known),
});

describe('classifyItems', () => {
  it('1: an open failure with no run in the period leaves the score untested', () => {
    expect(one([plain(-5, false)], KNOWN)).toMatchObject({
      inPlay: true, origin: 'open_at_start', outcome: 'left_untested', openBeforePeriod: true, failingSinceMs: null, scoreFailingPairs: 0,
    });
  });

  it('2: an open failure re-tested and protected is fixed', () => {
    expect(one([plain(-5, false), plain(10, true)], KNOWN)).toMatchObject({ origin: 'open_at_start', outcome: 'fixed', fixedAtMs: at(10) });
  });

  it('3: an open failure re-tested and failing again is still failing', () => {
    expect(one([plain(-5, false), plain(10, false)], KNOWN)).toMatchObject({ origin: 'open_at_start', outcome: 'still_failing', scoreFailingPairs: 1 });
  });

  it('4: a failure older than the window that is re-tested is an older failure re-tested', () => {
    expect(one([plain(-45, false), plain(3, true)], KNOWN)).toMatchObject({ origin: 'older_retested', outcome: 'fixed', openBeforePeriod: true });
  });

  it('5: a failure older than the window that is not re-tested is not in play', () => {
    const item = one([plain(-45, false)], KNOWN);
    expect(item).toMatchObject({ inPlay: false });
    expect(item.origin).toBeUndefined();
    expect(item.outcome).toBeUndefined();
  });

  it('6: a protected prior result followed by a failure is a regression', () => {
    expect(one([plain(-5, true), plain(8, false)], KNOWN)).toMatchObject({
      origin: 'regression', outcome: 'not_retested', failingSinceMs: at(8), openBeforePeriod: false,
    });
  });

  it('7: a protected period result followed by a failure is a regression', () => {
    expect(one([plain(2, true), plain(8, false)], KNOWN)).toMatchObject({
      origin: 'regression', outcome: 'not_retested', hasPrior: false, firstPeriodProtected: true,
    });
  });

  it('8: a first failing result of a test the organization never ran is a new test', () => {
    expect(one([plain(4, false)])).toMatchObject({ origin: 'new_test', outcome: 'not_retested', firstPeriodProtected: false });
  });

  it('9: a first failing result of a known test is its first time on the endpoint', () => {
    expect(one([plain(4, false)], KNOWN)).toMatchObject({ origin: 'first_on_endpoint' });
  });

  it('10: a cyber-hygiene control is never a new test', () => {
    expect(one([control(4, false)])).toMatchObject({ origin: 'first_on_endpoint', cyberHygiene: true, controlId: 'CH-1' });
  });

  it('11: a failing prior result wins over a later regression', () => {
    expect(one([plain(-5, false), plain(3, true), plain(9, false)], KNOWN)).toMatchObject({
      origin: 'open_at_start', outcome: 'not_retested', failingSinceMs: at(9), openBeforePeriod: false,
    });
  });

  it('12: a pair that flaps counts once, by where it ended', () => {
    expect(one([plain(2, false), plain(5, true), plain(9, false), plain(12, false)])).toMatchObject({
      origin: 'new_test', outcome: 'still_failing', failingSinceMs: at(9),
    });
  });

  it('13: a failure fixed on the same day is fixed', () => {
    expect(one([plain(4, false, { hour: 8 }), plain(4, true, { hour: 17 })])).toMatchObject({
      origin: 'new_test', outcome: 'fixed', firstPeriodProtected: false, failingSinceMs: at(4, 8), fixedAtMs: at(4, 17),
    });
  });

  it('14: a chain failure fixed by blocking the test at start is fixed, its chain pair still failing', () => {
    expect(one([chain(5, false), plain(9, true)])).toMatchObject({ origin: 'new_test', outcome: 'fixed', scoreFailingPairs: 1 });
  });

  it('15: a chain failure and a plain failure of one test on one host are one item failing in two score pairs', () => {
    expect(one([chain(5, false), plain(9, false)])).toMatchObject({ outcome: 'still_failing', scoreFailingPairs: 2 });
  });

  it('16: a prior result exactly at the cutoff is in the score at the start', () => {
    expect(one([mk(`org-a|${T1}|h1`, 'h1', FROM - 30 * DAY, false)], KNOWN)).toMatchObject({ origin: 'open_at_start' });
  });

  it('17: keeps the same test and host of two organizations apart', () => {
    const items = classifyItems({ window, prior: [], period: [plain(4, false), plain(4, false, { org: 'org-b' })], knownTests: new Set() });
    expect(items.map(i => i.testKey).sort()).toEqual([`org-a|${T1}`, `org-b|${T1}`]);
  });

  it('18: merges a chain and a plain pair on a hostname that contains the key separator', () => {
    expect(one([mk(`org-a|bundle:${T1}|a|b`, 'a|b', at(5), false), mk(`org-a|${T1}|a|b`, 'a|b', at(9), true)])).toMatchObject({
      hostname: 'a|b', outcome: 'fixed',
    });
  });

  it('19: counts a result read twice once', () => {
    expect(one([plain(4, false), plain(4, false)])).toMatchObject({ outcome: 'not_retested' });
  });

  it('20: a pair that stayed protected is not in play', () => {
    expect(one([plain(-5, true), plain(8, true)], KNOWN)).toMatchObject({ inPlay: false });
  });

  it('21: a failure older than the window, re-tested and failing again, is still failing', () => {
    expect(one([plain(-45, false), plain(3, false)], KNOWN)).toMatchObject({
      origin: 'older_retested', outcome: 'still_failing', openBeforePeriod: true, failingSinceMs: null,
    });
  });

  it('22: a failure older than the window, fixed and failing again, is not re-tested', () => {
    expect(one([plain(-45, false), plain(3, true), plain(8, false)], KNOWN)).toMatchObject({
      origin: 'older_retested', outcome: 'not_retested', openBeforePeriod: false, failingSinceMs: at(8),
    });
  });

  it('23: a protected prior result older than the window followed by a failure is a regression', () => {
    expect(one([plain(-45, true), plain(8, false)], KNOWN)).toMatchObject({
      inPlay: true, origin: 'regression', outcome: 'not_retested', hasPrior: true, failingSinceMs: at(8),
    });
  });

  it('24: a pair that failed, passed, failed and passed is fixed at its last pass', () => {
    expect(one([plain(2, false), plain(5, true), plain(9, false), plain(12, true)])).toMatchObject({
      origin: 'new_test', outcome: 'fixed', failingSinceMs: at(9), fixedAtMs: at(12),
    });
  });

  it('25: a failing chain prior result beside a newer protected plain prior result takes the newer one', () => {
    const item = one([chain(-10, false), plain(-5, true)], KNOWN);
    expect(item).toMatchObject({ hasPrior: true, priorMs: at(-5), inPlay: false });
    expect(one([chain(-10, false), plain(-5, true), plain(8, false)], KNOWN)).toMatchObject({
      priorMs: at(-5), origin: 'regression', outcome: 'not_retested',
    });
  });
});

describe('buildScoreMovement', () => {
  it('counts outcomes and origins, and they add up', () => {
    const m = build([
      plain(-5, false, { host: 'h1' }), plain(10, true, { host: 'h1' }),   // open at start, fixed
      plain(-5, false, { host: 'h2' }),                                      // open at start, left untested
      plain(-5, true, { host: 'h3' }), plain(8, false, { host: 'h3' }),     // regression, not re-tested
      plain(4, false, { test: T2, host: 'h1' }), plain(6, false, { test: T2, host: 'h1' }), // new test, still failing
      plain(4, true, { test: T2, host: 'h2' }),                              // new test, stopped
    ], KNOWN);
    expect(m.failures).toEqual({
      total: 4, fixed: 1, stillFailing: 1, notRetested: 1, leftUntested: 1, fixRate: 25,
      origins: { openAtStart: 2, olderRetested: 0, regression: 1, newTest: 1, firstOnEndpoint: 0 },
    });
    expect(m.newTests).toEqual({ tests: 1, pairs: 2, stopped: 1, gotThrough: 1, rate: 50, gotThroughFixed: 0, gotThroughOpen: 1 });
    expect(m.regressed).toEqual({ total: 1, fixed: 0 });
    expect(m.pairs).toEqual({ start: 3, end: 4 });
    expect(m.failing).toEqual({ start: 2, end: 2 });
    expect(m.window).toEqual({ from: new Date(FROM).toISOString(), to: new Date(FROM + 30 * DAY).toISOString(), label: '30d' });
  });

  it('reconciles with the Defense Score', () => {
    const runs = [chain(5, false), plain(9, true),                                   // fixed, still counted
      chain(5, false, { host: 'h2' }), plain(9, false, { host: 'h2' }),             // open, counted twice
      plain(4, false, { test: T2 }), plain(-5, false, { test: T2, host: 'h9' })];   // not re-tested; left untested
    const m = build(runs);
    const score = summarizePairs(latestPairsAsOf(runs, window.toMs, window.freshnessMs));
    expect(m.scoreDifference).toEqual({ fixedButCounted: 1, countedTwice: 1 });
    expect(score.pairCount - score.protectedCount)
      .toBe(m.failures.stillFailing + m.failures.notRetested + m.scoreDifference.fixedButCounted + m.scoreDifference.countedTwice);
    expect(m.failing.end).toBe(score.pairCount - score.protectedCount);
  });

  it('keeps the last of two results of one pair at the same time, as the score does', () => {
    for (const runs of [[plain(9, false), plain(9, true)], [plain(9, true), plain(9, false)]]) {
      const m = build(runs);
      const score = summarizePairs(latestPairsAsOf(runs, window.toMs, window.freshnessMs));
      expect(score.pairCount - score.protectedCount)
        .toBe(m.failures.stillFailing + m.failures.notRetested + m.scoreDifference.fixedButCounted + m.scoreDifference.countedTwice);
      expect(m.failing.end).toBe(score.pairCount - score.protectedCount);
    }
    expect(build([plain(9, false), plain(9, true)]).failures.total).toBe(0);
    expect(build([plain(9, true), plain(9, false)]).failures.notRetested).toBe(1);
  });

  it('reconciles with the Defense Score when a risk acceptance hides some results', () => {
    const adjusted = [chain(5, false), plain(9, true),                              // fixed, still counted
      plain(4, false, { test: T2 }), plain(7, false, { test: T2 })];                // still failing
    const raw = [...adjusted,
      plain(3, false, { host: 'h7' }),                                              // accepted, open
      plain(-5, false, { test: T2, host: 'h8' })];                                  // accepted, left untested
    const m = build(adjusted, [], raw);
    const score = summarizePairs(latestPairsAsOf(adjusted, window.toMs, window.freshnessMs));
    expect(score.pairCount - score.protectedCount)
      .toBe(m.failures.stillFailing + m.failures.notRetested + m.scoreDifference.fixedButCounted + m.scoreDifference.countedTwice);
    expect(m.failing.end).toBe(score.pairCount - score.protectedCount);
    expect(m.failures).toMatchObject({ total: 2, fixed: 1, stillFailing: 1 });
    expect(m.riskAccepted).toBe(2);
  });

  it('counts a risk-accepted failure left untested as risk accepted', () => {
    // A failing raw prior result in the score at the start, gone once the exclusion applies, never re-run.
    const m = build([plain(4, false, { test: T2 })], [], [plain(4, false, { test: T2 }), plain(-5, false, { host: 'h9' })]);
    expect(m.failures.leftUntested).toBe(0);
    expect(m.riskAccepted).toBe(1);
  });

  it('gives a list row of a control its control id', () => {
    const m = build([control(4, false)]);
    expect(m.lists.notRetested.rows).toHaveLength(1);
    expect(m.lists.notRetested.rows[0]).toMatchObject({ testUuid: CH, controlId: 'CH-1', hostname: 'h1' });
  });

  it('keeps cyber-hygiene out of new tests and counts it as first time on an endpoint', () => {
    const m = build([control(4, true), mk(`org-a|${CH}::CH-2|h1`, 'h1', at(4), false, { category: 'cyber-hygiene' })]);
    expect(m.newTests.pairs).toBe(0);
    expect(m.firstOnEndpoint).toEqual({ pairs: 2, stopped: 1 });
    expect(m.failures.origins.firstOnEndpoint).toBe(1);
  });

  it('counts a new test with a chain run and a plain run on one host as one pair', () => {
    expect(build([chain(5, false), plain(9, true)]).newTests).toMatchObject({ tests: 1, pairs: 1, gotThrough: 1, gotThroughFixed: 1 });
  });

  it('counts the same new test in two organizations as two tests', () => {
    expect(build([plain(4, true), plain(4, true, { org: 'org-b' })]).newTests.tests).toBe(2);
  });

  it('returns null rates and empty lists for no results', () => {
    const m = build([]);
    expect(m.failures.fixRate).toBeNull();
    expect(m.newTests.rate).toBeNull();
    expect(m.riskAccepted).toBeNull();
    expect(Object.values(m.lists).every(l => l.total === 0 && l.rows.length === 0)).toBe(true);
  });

  it('counts open failures a risk acceptance hides, and only those', () => {
    const raw = [plain(4, false, { host: 'h1' }),                               // accepted, open
      plain(4, false, { host: 'h2' }), plain(6, true, { host: 'h2' }),          // accepted, but fixed
      plain(4, false, { test: T2 })];                                            // not accepted
    expect(build([plain(4, false, { test: T2 })], [], raw).riskAccepted).toBe(1);
    expect(build([plain(4, false, { test: T2 })], [], [plain(4, false, { test: T2 })]).riskAccepted).toBe(0);
  });

  it('caps each list at 200 rows and keeps the full total', () => {
    const runs = Array.from({ length: 5000 }, (_, i) => plain(4, false, { host: `h${i}` }));
    const m = build(runs, KNOWN);
    expect(m.lists.notRetested.total).toBe(5000);
    expect(m.lists.notRetested.rows).toHaveLength(MOVEMENT_LIST_LIMIT);
  });

  it('orders the work lists oldest first, with failures open before the period on top', () => {
    const m = build([plain(-5, false, { host: 'old' }), plain(3, false, { host: 'old' }),
      plain(2, false, { host: 'b' }), plain(9, false, { host: 'b' }),
      plain(1, false, { host: 'a' }), plain(8, false, { host: 'a' })], KNOWN);
    expect(m.lists.stillFailing.rows.map(r => r.hostname)).toEqual(['old', 'a', 'b']);
    expect(m.lists.stillFailing.rows[0]).toMatchObject({ failingSince: null, openBeforePeriod: true, origin: 'open_at_start' });
    expect(m.lists.stillFailing.rows[1]).toMatchObject({ failingSince: new Date(at(1)).toISOString(), origin: 'first_on_endpoint' });
  });

  it('puts the oldest prior result first among failures open before the period, and the newest fix first', () => {
    const m = build([plain(-20, false, { host: 'x' }), plain(9, false, { host: 'x' }),
      plain(-5, false, { host: 'y' }), plain(2, false, { host: 'y' }),
      plain(1, false, { host: 'f1' }), plain(3, true, { host: 'f1' }),
      plain(1, false, { host: 'f2' }), plain(6, true, { host: 'f2' })], KNOWN);
    expect(m.lists.stillFailing.rows.map(r => r.hostname)).toEqual(['x', 'y']);
    expect(m.lists.fixed.rows.map(r => r.hostname)).toEqual(['f2', 'f1']);
    expect(m.lists.fixed.rows[0]).toMatchObject({ fixedAt: new Date(at(6)).toISOString(), lastResultAt: new Date(at(6)).toISOString() });
  });

  it('lists new tests by their first run, newest first', () => {
    const m = build([plain(3, true, { host: 'a' }), plain(7, true, { host: 'b' }), plain(5, false, { host: 'c' })]);
    expect(m.lists.newStopped.rows.map(r => r.hostname)).toEqual(['b', 'a']);
    expect(m.lists.newStopped.rows[0].origin).toBeUndefined();
    expect(m.lists.newGotThrough.rows.map(r => r.hostname)).toEqual(['c']);
  });
});
