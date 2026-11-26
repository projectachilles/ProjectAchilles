import { describe, it, expect } from 'vitest';
import {
  buildCoverageModel,
  testsView,
  hostsView,
  MATRIX_CELL_HOST_LIMIT,
  MATRIX_MAX_ROWS,
} from '../coverageMatrix.js';
import type { MatrixInput, MatrixRun } from '../coverageMatrix.js';
import { classifyPairOutcome } from '../outcomeBreakdown.js';
import type { PostureWindow } from '../posture.js';
import type { CoverageMatrixTestsResponse, MatrixCell } from '../../../types/analytics.js';

// The matrix model is a pivot of the Defense Score's latest test x host pairs.
// These tests build pair runs by hand; the fetch is tested in coverage-matrix.test.ts.

const DAY = 86_400_000;
const FROM = Date.parse('2025-01-01T00:00:00Z');
const W: PostureWindow = { fromMs: FROM, toMs: FROM + 30 * DAY, freshnessMs: 30 * DAY, step: 'day', label: '30d' };

type Outcome = 'protected' | 'prevented' | 'detected' | 'silent';
interface Opts {
  org?: string;
  /** Day of the window (1 = its first day). */
  day?: number;
  hour?: number;
  v?: Outcome;
  name?: string;
  bundleName?: string;
  category?: string;
}

function make(id: string, host: string, o: Opts): MatrixRun {
  const v = o.v ?? 'silent';
  return {
    pairKey: `${o.org ?? 'org-a'}|${id}|${host}`,
    ts: FROM + ((o.day ?? 10) - 1) * DAY + (o.hour ?? 9) * 3_600_000,
    protected: v !== 'silent',
    strictProtected: v === 'protected',
    edrPrevented: v === 'prevented',
    errorCodes: [],
    errorNames: [],
    hostname: host,
    testName: o.name ?? id,
    techniques: [],
    ...(o.category ? { category: o.category } : {}),
    ...(o.bundleName ? { bundleName: o.bundleName } : {}),
  };
}
const plain = (test: string, host: string, o: Opts = {}) => make(test, host, o);
const chain = (bundle: string, host: string, o: Opts = {}) => make(`bundle:${bundle}`, host, o);
const control = (bundle: string, id: string, host: string, o: Opts = {}) =>
  make(`${bundle}::${id}`, host, { bundleName: 'Baseline', category: 'cyber-hygiene', ...o });

const input = (i: Partial<MatrixInput>): MatrixInput => ({ window: W, runs: [], rawRuns: null, noVerdict: [], rawNoVerdict: null, ...i });
const tests = (i: Partial<MatrixInput>): CoverageMatrixTestsResponse => testsView(buildCoverageModel(input(i)), W.label);

/** The cell of a test on a host, by names. */
function cell(view: CoverageMatrixTestsResponse, testUuid: string, hostname: string, org = 'org-a'): MatrixCell | undefined {
  const row = view.tests.find((t) => t.testUuid === testUuid);
  const i = view.hosts.findIndex((h) => h.hostname === hostname && h.org === org);
  return row?.cells?.find((c) => c.i === i);
}
const iso = (day: number, hour = 9) => new Date(FROM + (day - 1) * DAY + hour * 3_600_000).toISOString();

describe('a cell is the pair\'s latest verdict', () => {
  it.each([
    ['protected', 'protected'],
    ['prevented', 'protected'],
    ['detected', 'detected'],
    ['silent', 'unprotected'],
  ] as const)('a %s pair is drawn %s', (v, verdict) => {
    const run = plain('t1', 'h1', { v });
    // The fixture means what its name says under the score's own rule.
    expect(classifyPairOutcome(run)).toBe(v);

    expect(cell(tests({ runs: [run] }), 't1', 'h1')).toEqual({ i: 0, verdict, at: iso(10) });
  });

  it('shows the latest run of the pair', () => {
    const view = tests({ runs: [plain('t1', 'h1', { day: 5, v: 'protected' }), plain('t1', 'h1', { day: 9, v: 'silent' })] });

    expect(cell(view, 't1', 'h1')).toMatchObject({ verdict: 'unprotected', at: iso(9) });
  });

  it('shows nothing for a run older than the window', () => {
    const old = plain('t1', 'h1', { day: -3 });
    const view = tests({ runs: [old, plain('t2', 'h1')] });

    expect(view.tests.map((t) => t.testUuid)).toEqual(['t2']);
  });

  it('shows the older conclusive result when the newest run has no verdict', () => {
    const view = tests({ runs: [plain('t1', 'h1', { day: 5, v: 'protected' })], noVerdict: [plain('t1', 'h1', { day: 20 })] });

    expect(cell(view, 't1', 'h1')).toMatchObject({ verdict: 'protected', at: iso(5) });
  });

  it('is "no verdict" for a pair that ran and never had a conclusive result', () => {
    const view = tests({ noVerdict: [plain('t1', 'h1', { day: 20, name: 'Always fails' })] });

    expect(cell(view, 't1', 'h1')).toEqual({ i: 0, verdict: 'no_verdict', at: iso(20) });
    expect(view.tests[0]).toMatchObject({ name: 'Always fails', counts: { noVerdict: 1, unprotected: 0 } });
  });

  it('is "risk accepted" for a pair the exclusion removed, and not counted as caught', () => {
    const accepted = plain('t1', 'h1', { v: 'protected', day: 8 });
    const view = tests({ runs: [plain('t1', 'h2', { v: 'protected' })], rawRuns: [accepted, plain('t1', 'h2', { v: 'protected' })] });

    expect(cell(view, 't1', 'h1')).toEqual({ i: view.hosts.findIndex((h) => h.hostname === 'h1'), verdict: 'risk_accepted', at: iso(8) });
    expect(view.tests[0].counts).toMatchObject({ protected: 1, riskAccepted: 1 });
  });

  it('is "risk accepted" for an accepted pair that never had a verdict', () => {
    const view = tests({ runs: [plain('t2', 'h1')], rawRuns: [plain('t2', 'h1')], rawNoVerdict: [plain('t1', 'h1', { day: 12, name: 'Not applicable here' })] });

    expect(cell(view, 't1', 'h1')).toEqual({ i: 0, verdict: 'risk_accepted', at: iso(12) });
    expect(view.tests.find((t) => t.testUuid === 't1')).toMatchObject({ name: 'Not applicable here', counts: { riskAccepted: 1, noVerdict: 0 } });
  });

  it('judges a pair by what the acceptance leaves of it: "no verdict" when only that remains', () => {
    // A chain whose one conclusive stage is accepted: its other stages still ran, without a verdict.
    const view = tests({
      rawRuns: [chain('b1', 'h1', { day: 8, v: 'protected' })],
      noVerdict: [chain('b1', 'h1', { day: 8 })],
      rawNoVerdict: [chain('b1', 'h1', { day: 8 })],
    });

    expect(cell(view, 'b1', 'h1')).toEqual({ i: 0, verdict: 'no_verdict', at: iso(8) });
  });

  it('is not "risk accepted" for a pair the unfiltered runs merely repeat', () => {
    const view = tests({
      runs: [plain('t1', 'h1', { v: 'protected' })],
      rawRuns: [plain('t1', 'h1', { v: 'protected' })],
      noVerdict: [plain('t2', 'h1', { day: 3 })],
      rawNoVerdict: [plain('t2', 'h1', { day: 3 }), plain('t1', 'h1', { day: 12 })],
    });

    expect(cell(view, 't1', 'h1')).toMatchObject({ verdict: 'protected' });
    expect(cell(view, 't2', 'h1')).toMatchObject({ verdict: 'no_verdict' });
  });
});

describe('rows', () => {
  it('counts the hosts on the axis that never ran a test', () => {
    const view = tests({ runs: [plain('t1', 'h1'), plain('t1', 'h2'), plain('t2', 'h3', { v: 'protected' })] });

    expect(view.tests.find((t) => t.testUuid === 't1')!.counts).toMatchObject({ unprotected: 2, neverRun: 1 });
    expect(view.tests.find((t) => t.testUuid === 't2')!.counts).toMatchObject({ protected: 1, neverRun: 2 });
    expect(view.hosts.find((h) => h.hostname === 'h3')!.counts).toMatchObject({ protected: 1, neverRun: 1 });
  });

  it('draws an attack chain as one row with one cell per host', () => {
    const view = tests({ runs: [chain('b1', 'h1', { v: 'detected', name: 'Chain A' }), chain('b1', 'h2', { name: 'Chain A' })] });

    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]).toMatchObject({ key: 'b1', testUuid: 'b1', kind: 'chain', name: 'Chain A' });
    expect(view.tests[0]).not.toHaveProperty('ratio');
    expect(cell(view, 'b1', 'h1')).toMatchObject({ verdict: 'detected' });
    expect(cell(view, 'b1', 'h2')).toMatchObject({ verdict: 'unprotected' });
  });

  it('gives one cell to a chain run and a run of the same test that ended before any stage', () => {
    // The score keys them as two pairs; one test on one host is one cell: the latest result.
    const view = tests({ runs: [chain('b1', 'h1', { day: 5, name: 'Chain A' }), plain('b1', 'h1', { day: 9, v: 'protected', name: 'Chain A' })] });

    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]).toMatchObject({ kind: 'chain', counts: { protected: 1, unprotected: 0 } });
    expect(cell(view, 'b1', 'h1')).toEqual({ i: 0, verdict: 'protected', at: iso(9), earlier: ['unprotected'] });
  });

  it('lists one earlier result for a day on which both of them ran', () => {
    const view = tests({
      runs: [chain('b1', 'h1', { day: 9 }), chain('b1', 'h1', { day: 5, hour: 7 }), plain('b1', 'h1', { day: 5, hour: 18, v: 'protected' })],
    });

    expect(cell(view, 'b1', 'h1')).toEqual({ i: 0, verdict: 'unprotected', at: iso(9), earlier: ['protected'] });
  });

  it('draws a cyber-hygiene bundle as one row with a ratio per host', () => {
    const view = tests({
      runs: [
        control('ch', 'CH-1', 'h1', { v: 'protected', day: 4 }),
        control('ch', 'CH-2', 'h1', { v: 'protected', day: 6 }),
        control('ch', 'CH-3', 'h1', { v: 'silent', day: 6 }),
        control('ch', 'CH-1', 'h2', { v: 'silent', day: 6 }),
      ],
      rawRuns: [
        control('ch', 'CH-1', 'h1', { v: 'protected', day: 4 }),
        control('ch', 'CH-2', 'h1', { v: 'protected', day: 6 }),
        control('ch', 'CH-3', 'h1', { v: 'silent', day: 6 }),
        control('ch', 'CH-1', 'h2', { v: 'silent', day: 6 }),
        control('ch', 'CH-4', 'h1', { v: 'silent', day: 6 }),
      ],
      noVerdict: [control('ch', 'CH-5', 'h1', { day: 6 }), control('ch', 'CH-1', 'h1', { day: 7 })],
      // CH-6 is accepted and never had a verdict: accepted, not "not assessed".
      rawNoVerdict: [control('ch', 'CH-5', 'h1', { day: 6 }), control('ch', 'CH-1', 'h1', { day: 7 }), control('ch', 'CH-6', 'h1', { day: 5 })],
    });

    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]).toMatchObject({
      key: 'ch',
      kind: 'controls',
      name: 'Baseline',
      category: 'cyber-hygiene',
      ratio: { compliant: 2, evaluated: 4, notAssessed: 1, accepted: 2 },
    });
    const h1 = cell(view, 'ch', 'h1')!;
    // CH-1 has a conclusive result, so its later non-conclusive run does not make it "not assessed".
    expect(h1).toEqual({ i: view.hosts.findIndex((h) => h.hostname === 'h1'), ratio: { compliant: 2, evaluated: 3, notAssessed: 1, accepted: 2 }, at: iso(6) });
    expect(cell(view, 'ch', 'h2')).toMatchObject({ ratio: { compliant: 0, evaluated: 1, notAssessed: 0, accepted: 0 } });
    expect(view.hosts.find((h) => h.hostname === 'h1')!.ratio).toEqual({ compliant: 2, evaluated: 3, notAssessed: 1, accepted: 2 });
  });

  it('shows "no verdict" on a bundle row for a host whose runs produced no control result', () => {
    const view = tests({
      runs: [control('ch', 'CH-1', 'h1', { v: 'protected' })],
      noVerdict: [plain('ch', 'h2', { day: 12, name: 'Baseline' })],
    });

    expect(view.tests).toHaveLength(1);
    expect(cell(view, 'ch', 'h2')).toEqual({ i: view.hosts.findIndex((h) => h.hostname === 'h2'), verdict: 'no_verdict', at: iso(12) });
  });

  it('names a bundle row by a whole-run result before a control\'s own name', () => {
    const view = tests({
      runs: [make('ch::CH-1', 'h1', { name: 'CH-1 check' })],
      noVerdict: [plain('ch', 'h2', { name: 'Baseline' })],
    });

    expect(view.tests[0]).toMatchObject({ kind: 'controls', name: 'Baseline' });
  });

  it('is a bundle row (ratio cells) when the same id has both controls and a chain run', () => {
    const view = tests({ runs: [control('x', 'CH-1', 'h1', { v: 'protected' }), chain('x', 'h2', { name: 'X as a chain' })] });

    expect(view.tests).toHaveLength(1);
    expect(view.tests[0]).toMatchObject({ kind: 'controls', name: 'Baseline' });
    expect(cell(view, 'x', 'h1')).toHaveProperty('ratio');
    expect(cell(view, 'x', 'h2')).toMatchObject({ verdict: 'unprotected' });
  });

  it('names a bundle row by a control\'s test name when the bundle name is unknown', () => {
    const view = tests({ runs: [make('ch::CH-1', 'h1', { name: 'CH-1 check' })] });

    expect(view.tests[0]).toMatchObject({ kind: 'controls', name: 'CH-1 check' });
  });
});

describe('earlier runs of an attack cell', () => {
  it('lists the days before the run shown, the latest of each day, newest first', () => {
    const view = tests({
      runs: [
        chain('b1', 'h1', { day: 10, hour: 15, v: 'protected' }),
        chain('b1', 'h1', { day: 10, hour: 8, v: 'silent' }), // same day as the run shown: not listed
        chain('b1', 'h1', { day: 8, hour: 7, v: 'protected' }),
        chain('b1', 'h1', { day: 8, hour: 18, v: 'detected' }), // the day's latest
        chain('b1', 'h1', { day: 3, v: 'silent' }),
      ],
    });

    expect(cell(view, 'b1', 'h1')).toEqual({ i: 0, verdict: 'protected', at: iso(10, 15), earlier: ['detected', 'unprotected'] });
  });

  it('lists them as the risk acceptance leaves them, like the cell', () => {
    // Without the accepted stage both runs are unprotected; the unfiltered runs say protected.
    const view = tests({
      runs: [chain('b1', 'h1', { day: 10 }), chain('b1', 'h1', { day: 5 })],
      rawRuns: [chain('b1', 'h1', { day: 10, v: 'protected' }), chain('b1', 'h1', { day: 5, v: 'protected' })],
    });

    expect(cell(view, 'b1', 'h1')).toEqual({ i: 0, verdict: 'unprotected', at: iso(10), earlier: ['unprotected'] });
  });

  it('lists at most six', () => {
    const runs = Array.from({ length: 9 }, (_, i) => plain('t1', 'h1', { day: 2 + i, v: i === 1 ? 'protected' : 'silent' }));

    const earlier = cell(tests({ runs }), 't1', 'h1')!.earlier!;

    expect(earlier).toHaveLength(6);
    // Days 9 down to 4: day 3 (the protected one) is the seventh and is left out.
    expect(earlier).toEqual(Array(6).fill('unprotected'));
  });

  it('lists no run from before the window', () => {
    const view = tests({ runs: [plain('t1', 'h1', { day: 10 }), plain('t1', 'h1', { day: -2, v: 'protected' })] });

    expect(cell(view, 't1', 'h1')).not.toHaveProperty('earlier');
  });

  it('is absent when the pair ran once', () => {
    expect(cell(tests({ runs: [plain('t1', 'h1')] }), 't1', 'h1')).not.toHaveProperty('earlier');
  });
});

describe('order', () => {
  it('puts the most exposed host first, in the same order for every row', () => {
    const view = tests({
      runs: [
        plain('t1', 'h-b', { v: 'protected' }),
        plain('t1', 'h-a', { v: 'protected' }),
        plain('t1', 'h-weak'),
        plain('t2', 'h-weak'),
        plain('t2', 'h-mid'),
        control('ch', 'CH-1', 'h-b'),
      ],
    });

    // Two unprotected, one unprotected, then no unprotected: the one with a failed control, then by name.
    expect(view.hosts.map((h) => h.hostname)).toEqual(['h-weak', 'h-mid', 'h-b', 'h-a']);
    expect(view.hosts.map((h) => h.key)).toEqual(['org-a|h-weak', 'org-a|h-mid', 'org-a|h-b', 'org-a|h-a']);
    for (const t of view.tests) {
      const order = t.cells!.map((c) => c.i);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('puts attack rows first, worst first, then bundles by compliant share', () => {
    const view = tests({
      runs: [
        plain('t-ok', 'h1', { v: 'protected', name: 'Zeta' }),
        plain('t-bad', 'h1', { name: 'Beta' }),
        plain('t-bad', 'h2', { name: 'Beta' }),
        plain('t-one', 'h1', { name: 'Alpha' }),
        plain('t-one2', 'h1', { name: 'Aaa' }),
        control('ch-good', 'CH-1', 'h1', { v: 'protected', bundleName: 'Good' }),
        control('ch-poor', 'CH-1', 'h1', { bundleName: 'Poor' }),
      ],
    });

    expect(view.tests.map((t) => t.name)).toEqual(['Beta', 'Aaa', 'Alpha', 'Zeta', 'Poor', 'Good']);
  });
});

describe('order of bundles', () => {
  it('puts a bundle with no evaluated control last', () => {
    const view = tests({
      runs: [control('ch-full', 'CH-1', 'h1', { v: 'protected', bundleName: 'Full' })],
      noVerdict: [control('ch-none', 'CH-1', 'h1', { bundleName: 'A bundle that never reported' })],
    });

    expect(view.tests.map((t) => t.name)).toEqual(['Full', 'A bundle that never reported']);
  });
});

describe('organizations', () => {
  it('keeps one hostname in two organizations as two columns', () => {
    const view = tests({ runs: [plain('t1', 'h1', { org: 'org-a', v: 'protected' }), plain('t1', 'h1', { org: 'org-b' })] });

    expect(view.hosts.map((h) => [h.key, h.hostname, h.org])).toEqual([
      ['org-b|h1', 'h1', 'org-b'],
      ['org-a|h1', 'h1', 'org-a'],
    ]);
    expect(view.tests).toHaveLength(1);
    expect(cell(view, 't1', 'h1', 'org-a')).toMatchObject({ verdict: 'protected' });
    expect(cell(view, 't1', 'h1', 'org-b')).toMatchObject({ verdict: 'unprotected' });
  });

  it('orders equally exposed hosts by hostname, not by organization', () => {
    const view = tests({ runs: [plain('t1', 'beta', { org: 'org-a' }), plain('t1', 'Alpha', { org: 'org-b' })] });

    expect(view.hosts.map((h) => h.key)).toEqual(['org-b|Alpha', 'org-a|beta']);
  });

  it('reports no organization as null', () => {
    const view = tests({ runs: [plain('t1', 'h1', { org: '' })] });

    expect(view.hosts[0]).toMatchObject({ key: '|h1', org: null });
  });
});

describe('limits', () => {
  it('are 150 hosts with cells and 500 rows', () => {
    // The page chooses its form from these; a change is a change of the contract in the API reference.
    expect([MATRIX_CELL_HOST_LIMIT, MATRIX_MAX_ROWS]).toEqual([150, 500]);
  });

  const fleet = (n: number) =>
    Array.from({ length: n }, (_, i) => plain('t1', `h${String(i).padStart(4, '0')}`, { v: i % 3 === 0 ? 'protected' : 'silent' }));

  it('includes cells up to the host limit', () => {
    const view = tests({ runs: fleet(MATRIX_CELL_HOST_LIMIT) });

    expect(view.cellsIncluded).toBe(true);
    expect(view.tests[0].cells).toHaveLength(MATRIX_CELL_HOST_LIMIT);
  });

  it('leaves cells out above it, with the same counts', () => {
    const view = tests({ runs: [...fleet(MATRIX_CELL_HOST_LIMIT + 1), plain('t2', 'h0000', { v: 'detected' })] });

    expect(view).toMatchObject({ cellsIncluded: false, hostCount: 151 });
    // No cell points at the axis, so it is not sent: rows = hosts pages through it.
    expect(view.hosts).toEqual([]);
    expect(view.tests.map((t) => t.cells)).toEqual([null, null]);
    // 151 hosts, every third protected (0, 3, ... 150): 51.
    expect(view.tests.find((t) => t.testUuid === 't1')!.counts).toEqual({
      protected: 51, detected: 0, unprotected: 100, noVerdict: 0, riskAccepted: 0, neverRun: 0,
    });
    expect(view.tests.find((t) => t.testUuid === 't2')!.counts).toMatchObject({ detected: 1, neverRun: 150 });
  });

  it('returns at most the row limit and says so', () => {
    const runs = Array.from({ length: MATRIX_MAX_ROWS + 3 }, (_, i) => plain(`t${String(i).padStart(4, '0')}`, 'h1'));

    const view = tests({ runs });

    expect(view.tests).toHaveLength(MATRIX_MAX_ROWS);
    expect(view).toMatchObject({ truncated: true, testCount: MATRIX_MAX_ROWS + 3 });
    // The host's counts cover every test, also those not listed.
    expect(view.hosts[0].counts.unprotected).toBe(MATRIX_MAX_ROWS + 3);

    const byHost = hostsView(buildCoverageModel(input({ runs })), W.label, { page: 1, pageSize: 25 });
    expect(byHost.tests).toHaveLength(MATRIX_MAX_ROWS);
    expect(byHost).toMatchObject({ truncated: true, testCount: MATRIX_MAX_ROWS + 3 });
    expect(byHost.hosts[0].cells).toHaveLength(MATRIX_MAX_ROWS);
  });

  it('is not truncated at the limit', () => {
    const runs = Array.from({ length: MATRIX_MAX_ROWS }, (_, i) => plain(`t${i}`, 'h1'));

    expect(tests({ runs })).toMatchObject({ truncated: false, testCount: MATRIX_MAX_ROWS });
  });

  it('is empty without results', () => {
    expect(tests({})).toEqual({
      rows: 'tests', windowLabel: '30d', hosts: [], hostCount: 0, tests: [], testCount: 0, cellsIncluded: true, truncated: false,
    });
  });
});

describe('rows = hosts', () => {
  const model = () =>
    buildCoverageModel(
      input({
        runs: [
          plain('t1', 'h1'), plain('t2', 'h1'), plain('t3', 'h1'),
          plain('t1', 'h2'), plain('t2', 'h2'),
          plain('t1', 'h3'),
          plain('t1', 'h4', { v: 'protected' }),
          plain('t2', 'h5', { v: 'detected' }),
        ],
      }),
    );

  it('returns one page of hosts in the matrix order, with a cell per test they ran', () => {
    const view = hostsView(model(), W.label, { page: 2, pageSize: 2 });

    expect(view).toMatchObject({ rows: 'hosts', windowLabel: '30d', page: 2, pageSize: 2, hostCount: 5, testCount: 3, truncated: false });
    expect(view.hosts.map((h) => h.hostname)).toEqual(['h3', 'h4']);
    expect(view.tests.map((t) => t.testUuid)).toEqual(['t1', 't2', 't3']);
    expect(view.hosts[0].cells).toEqual([{ i: 0, verdict: 'unprotected', at: iso(10) }]);
    expect(view.hosts[1].cells).toEqual([{ i: 0, verdict: 'protected', at: iso(10) }]);
  });

  it('has the same host order as rows = tests', () => {
    const m = model();

    expect(hostsView(m, W.label, { page: 1, pageSize: 100 }).hosts.map((h) => h.key)).toEqual(testsView(m, W.label).hosts.map((h) => h.key));
  });

  it('returns an empty page past the end', () => {
    expect(hostsView(model(), W.label, { page: 9, pageSize: 2 })).toMatchObject({ hosts: [], hostCount: 5 });
  });

  it('keeps one test and the hosts that have a cell for it', () => {
    const view = hostsView(model(), W.label, { page: 1, pageSize: 25, testUuid: 't2' });

    expect(view.tests.map((t) => t.testUuid)).toEqual(['t2']);
    expect(view.hosts.map((h) => h.hostname)).toEqual(['h1', 'h2', 'h5']);
    expect(view.hostCount).toBe(3);
    expect(view.hosts[2].cells).toEqual([{ i: 0, verdict: 'detected', at: iso(10) }]);
  });

  it('keeps the hosts whose cell for that test has the verdict', () => {
    const view = hostsView(model(), W.label, { page: 1, pageSize: 25, testUuid: 't2', verdict: 'unprotected' });

    expect(view.hosts.map((h) => h.hostname)).toEqual(['h1', 'h2']);
    expect(view.hostCount).toBe(2);
  });

  it('with a verdict and no test, keeps the hosts that have a cell with it', () => {
    const view = hostsView(model(), W.label, { page: 1, pageSize: 25, verdict: 'detected' });

    expect(view.hosts.map((h) => h.hostname)).toEqual(['h5']);
    expect(view.tests).toHaveLength(3);
  });

  it('lists no host for a test that is not in the window', () => {
    expect(hostsView(model(), W.label, { page: 1, pageSize: 25, testUuid: 'nope' })).toMatchObject({ hosts: [], hostCount: 0, tests: [], testCount: 0 });
  });
});
