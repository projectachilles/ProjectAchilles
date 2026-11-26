import { describe, it, expect } from 'vitest';
import { classifyItems } from '../scoreMovement.js';
import type { PairRun, PostureWindow } from '../posture.js';

// What became of each failing test on each endpoint in a period. These tests
// build pair runs by hand; days are relative to the period start, and a
// negative day is a result before it (a prior result).

const DAY = 86_400_000;
const FROM = Date.parse('2026-10-27T00:00:00Z');
const window: PostureWindow = { fromMs: FROM, toMs: FROM + 30 * DAY, freshnessMs: 30 * DAY, step: 'day', label: '30d' };
const T1 = 'a0000000-1234-4abc-8def-000000000001';
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
});
