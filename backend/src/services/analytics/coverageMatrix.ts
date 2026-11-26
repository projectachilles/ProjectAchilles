/**
 * Coverage matrix: the latest result per test and host, for All Executions.
 *
 * A pivot of the Defense Score's latest-basis, any-stage pairs. Nothing here
 * decides a verdict: the latest pick is latestPairsAsOf, the verdict is
 * classifyPairOutcome. Pure (no Elasticsearch); ElasticsearchService fetches
 * the runs.
 */
import { latestPairsAsOf } from './posture.js';
import type { PostureWindow } from './posture.js';
import { classifyPairOutcome } from './outcomeBreakdown.js';
import type { OutcomeRun, PairOutcome } from './outcomeBreakdown.js';
import { pairControlId, pairIsBundle, pairOrg, pairTestUuid } from './pairKeys.js';
import type {
  CoverageMatrixHostsResponse,
  CoverageMatrixTestsResponse,
  MatrixCell,
  MatrixCounts,
  MatrixHost,
  MatrixRatio,
  MatrixTest,
  MatrixVerdict,
} from '../../types/analytics.js';

/** Above this many hosts a row is drawn as one bar, so the cells are not sent. */
export const MATRIX_CELL_HOST_LIMIT = 150;
/** Most tests listed in one response. */
export const MATRIX_MAX_ROWS = 500;
/** Most earlier results listed on a cell. */
export const MATRIX_EARLIER_RUNS = 6;

const DAY_MS = 86_400_000;

/** A pair run, with the bundle name a cyber-hygiene control's row is named by. */
export type MatrixRun = OutcomeRun & { bundleName?: string };

export interface MatrixInput {
  window: PostureWindow;
  /** Conclusive runs with the risk-acceptance exclusion applied: every run of each pair (one per day at least). */
  runs: MatrixRun[];
  /** The same without the exclusion; null when nothing is excluded. */
  rawRuns: MatrixRun[] | null;
  /** Non-conclusive runs of the window, exclusion applied. */
  noVerdict: MatrixRun[];
  /** The same without the exclusion; null when nothing is excluded. */
  rawNoVerdict: MatrixRun[] | null;
}

interface ModelCell {
  verdict?: MatrixVerdict;
  ratio?: MatrixRatio;
  atMs: number;
  earlier?: MatrixVerdict[];
}

/** The whole matrix; testsView and hostsView cut a response out of it. */
export interface CoverageModel {
  hosts: MatrixHost[];
  tests: MatrixTest[];
  /** cells[t]: host index -> the cell of tests[t] on that host. */
  cells: Map<number, ModelCell>[];
}

/** Prevented is drawn as protected: the test did not get through. */
const VERDICT_OF: Record<PairOutcome, MatrixVerdict> = {
  protected: 'protected',
  prevented: 'protected',
  detected: 'detected',
  silent: 'unprotected',
};

const COUNT_OF: Record<MatrixVerdict, keyof MatrixCounts> = {
  protected: 'protected',
  detected: 'detected',
  unprotected: 'unprotected',
  no_verdict: 'noVerdict',
  risk_accepted: 'riskAccepted',
};

type State = 'conclusive' | 'accepted' | 'noVerdict';
interface Entry {
  run: MatrixRun;
  state: State;
}
/** One test on one host: its control pairs (a cyber-hygiene bundle) and its other pairs. */
interface Slot {
  controls: Entry[];
  others: Entry[];
}
interface TestDraft {
  uuid: string;
  slots: Map<string, Slot>;
}

const emptyCounts = (): MatrixCounts => ({ protected: 0, detected: 0, unprotected: 0, noVerdict: 0, riskAccepted: 0, neverRun: 0 });
const emptyRatio = (): MatrixRatio => ({ compliant: 0, evaluated: 0, notAssessed: 0, accepted: 0 });

function addRatio(into: MatrixRatio, r: MatrixRatio): void {
  into.compliant += r.compliant;
  into.evaluated += r.evaluated;
  into.notAssessed += r.notAssessed;
  into.accepted += r.accepted;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const newest = (entries: Entry[]): Entry | undefined => entries.reduce<Entry | undefined>((best, e) => (!best || e.run.ts >= best.run.ts ? e : best), undefined);
const hostKeyOf = (run: MatrixRun): string => `${pairOrg(run.pairKey)}|${run.hostname}`;

export function buildCoverageModel(input: MatrixInput): CoverageModel {
  const { window } = input;
  const latestOf = (runs: MatrixRun[]): MatrixRun[] => latestPairsAsOf(runs, window.toMs, window.freshnessMs) as MatrixRun[];

  // A pair is judged by what the risk-acceptance exclusion leaves of it: its
  // latest conclusive result, else that it ran without a verdict. It is "risk
  // accepted" only when the exclusion leaves nothing: an acceptance on one
  // stage of a chain does not accept the chain.
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const take = (runs: MatrixRun[], state: State): void => {
    for (const run of latestOf(runs)) {
      if (seen.has(run.pairKey)) continue;
      seen.add(run.pairKey);
      entries.push({ run, state });
    }
  };
  take(input.runs, 'conclusive');
  take(input.noVerdict, 'noVerdict');
  if (input.rawRuns) take(input.rawRuns, 'accepted');
  if (input.rawNoVerdict) take(input.rawNoVerdict, 'accepted');

  const hostInfo = new Map<string, { hostname: string; org: string | null }>();
  const drafts = new Map<string, TestDraft>();
  for (const entry of entries) {
    const { run } = entry;
    const hostKey = hostKeyOf(run);
    if (!hostInfo.has(hostKey)) hostInfo.set(hostKey, { hostname: run.hostname, org: pairOrg(run.pairKey) || null });
    const uuid = pairTestUuid(run.pairKey);
    let draft = drafts.get(uuid);
    if (!draft) drafts.set(uuid, (draft = { uuid, slots: new Map() }));
    let slot = draft.slots.get(hostKey);
    if (!slot) draft.slots.set(hostKey, (slot = { controls: [], others: [] }));
    (pairControlId(run.pairKey) !== undefined ? slot.controls : slot.others).push(entry);
  }

  const history = earlierRuns(input.runs, window);

  // Cells and rows first, by host key; the host order needs every row's cells.
  const rows = [...drafts.values()].map((draft) => {
    const cells = new Map<string, ModelCell>();
    for (const [hostKey, slot] of draft.slots) cells.set(hostKey, cellOf(slot, history));
    const counts = emptyCounts();
    const ratio = emptyRatio();
    for (const cell of cells.values()) {
      if (cell.ratio) addRatio(ratio, cell.ratio);
      else if (cell.verdict) counts[COUNT_OF[cell.verdict]]++;
    }
    counts.neverRun = hostInfo.size - cells.size;
    const test = describeTest(draft, counts, ratio);
    return { test, cells };
  });
  rows.sort((a, b) => compareTests(a.test, b.test));

  const hostCounts = new Map<string, { counts: MatrixCounts; ratio: MatrixRatio; cells: number }>();
  for (const key of hostInfo.keys()) hostCounts.set(key, { counts: emptyCounts(), ratio: emptyRatio(), cells: 0 });
  for (const row of rows) {
    for (const [hostKey, cell] of row.cells) {
      const h = hostCounts.get(hostKey)!;
      h.cells++;
      if (cell.ratio) addRatio(h.ratio, cell.ratio);
      else if (cell.verdict) h.counts[COUNT_OF[cell.verdict]]++;
    }
  }
  const hosts: MatrixHost[] = [...hostInfo].map(([key, info]) => {
    const h = hostCounts.get(key)!;
    h.counts.neverRun = rows.length - h.cells;
    return { key, hostname: info.hostname, org: info.org, counts: h.counts, ratio: h.ratio };
  });
  hosts.sort(compareHosts);

  const indexOf = new Map(hosts.map((h, i) => [h.key, i]));
  return {
    hosts,
    tests: rows.map((r) => r.test),
    cells: rows.map((r) => new Map([...r.cells].map(([hostKey, cell]) => [indexOf.get(hostKey)!, cell]))),
  };
}

/**
 * Per plain or chain pair: its conclusive runs in the window, latest of each
 * UTC day, newest first. Control pairs have no history (their cell is a ratio).
 */
function earlierRuns(runs: MatrixRun[], window: PostureWindow): Map<string, MatrixRun[]> {
  const cutoff = window.toMs - window.freshnessMs;
  const byPairDay = new Map<string, Map<number, MatrixRun>>();
  for (const run of runs) {
    if (run.ts > window.toMs || run.ts < cutoff) continue;
    if (pairControlId(run.pairKey) !== undefined) continue;
    let days = byPairDay.get(run.pairKey);
    if (!days) byPairDay.set(run.pairKey, (days = new Map()));
    const day = Math.floor(run.ts / DAY_MS);
    const cur = days.get(day);
    if (!cur || run.ts >= cur.ts) days.set(day, run);
  }
  const out = new Map<string, MatrixRun[]>();
  for (const [key, days] of byPairDay) out.set(key, [...days.values()]);
  return out;
}

function cellOf(slot: Slot, history: Map<string, MatrixRun[]>): ModelCell {
  // A bundle's controls on this host: a ratio. Its whole-run results (a run
  // that produced no control) only matter where no control ever reported.
  if (slot.controls.length > 0) {
    const ratio = emptyRatio();
    let atMs = Number.NEGATIVE_INFINITY;
    for (const { run, state } of slot.controls) {
      if (state === 'conclusive') {
        ratio.evaluated++;
        if (run.protected) ratio.compliant++;
      } else if (state === 'accepted') ratio.accepted++;
      else ratio.notAssessed++;
      if (run.ts > atMs) atMs = run.ts;
    }
    return { ratio, atMs };
  }

  // One test on one host can be two pairs (a chain run, and a run that ended
  // before any stage): the latest conclusive result of either is the cell.
  const conclusive = slot.others.filter((e) => e.state === 'conclusive');
  const shown = newest(conclusive);
  if (shown) {
    const shownDay = Math.floor(shown.run.ts / DAY_MS);
    const before = conclusive
      .flatMap((e) => history.get(e.run.pairKey) ?? [])
      .filter((r) => Math.floor(r.ts / DAY_MS) < shownDay)
      .sort((a, b) => b.ts - a.ts);
    const days = new Set<number>();
    const earlier: MatrixVerdict[] = [];
    for (const r of before) {
      const day = Math.floor(r.ts / DAY_MS);
      if (days.has(day)) continue; // two pairs ran that day: the later one is listed
      days.add(day);
      earlier.push(VERDICT_OF[classifyPairOutcome(r)]);
      if (earlier.length === MATRIX_EARLIER_RUNS) break;
    }
    return { verdict: VERDICT_OF[classifyPairOutcome(shown.run)], atMs: shown.run.ts, ...(earlier.length > 0 ? { earlier } : {}) };
  }
  const ran = newest(slot.others.filter((e) => e.state === 'noVerdict'));
  if (ran) return { verdict: 'no_verdict', atMs: ran.run.ts };
  return { verdict: 'risk_accepted', atMs: newest(slot.others)!.run.ts };
}

function describeTest(draft: TestDraft, counts: MatrixCounts, ratio: MatrixRatio): MatrixTest {
  const controls: Entry[] = [];
  const others: Entry[] = [];
  for (const slot of draft.slots.values()) {
    controls.push(...slot.controls);
    others.push(...slot.others);
  }
  const chains = others.filter((e) => pairIsBundle(e.run.pairKey));
  const kind: MatrixTest['kind'] = controls.length > 0 ? 'controls' : chains.length > 0 ? 'chain' : 'test';

  // A control's own test name is the control's, so a bundle row prefers the
  // bundle name, then the name of a whole-run result, then a control's.
  const named = (entries: Entry[], of: (r: MatrixRun) => string | undefined): string | undefined => {
    let best: Entry | undefined;
    for (const e of entries) if (of(e.run) && (!best || e.run.ts >= best.run.ts)) best = e;
    return best ? of(best.run) : undefined;
  };
  const testName = (r: MatrixRun) => r.testName || undefined;
  const name =
    (kind === 'controls'
      ? named(controls, (r) => r.bundleName || undefined) ?? named(others, testName) ?? named(controls, testName)
      : named(chains, testName) ?? named(others, testName)) ?? draft.uuid;
  const category = named([...controls, ...others], (r) => r.category || undefined);

  return {
    key: draft.uuid,
    testUuid: draft.uuid,
    name,
    kind,
    ...(category ? { category } : {}),
    counts,
    ...(kind === 'controls' ? { ratio } : {}),
  };
}

/** Attack rows first, most unprotected hosts first; then bundles, lowest compliant share first. */
function compareTests(a: MatrixTest, b: MatrixTest): number {
  const aBundle = a.kind === 'controls';
  if (aBundle !== (b.kind === 'controls')) return aBundle ? 1 : -1;
  if (aBundle) {
    const share = (t: MatrixTest) => (t.ratio && t.ratio.evaluated > 0 ? t.ratio.compliant / t.ratio.evaluated : Number.POSITIVE_INFINITY);
    const d = share(a) - share(b);
    if (d !== 0 && !Number.isNaN(d)) return d;
  } else if (a.counts.unprotected !== b.counts.unprotected) {
    return b.counts.unprotected - a.counts.unprotected;
  }
  return byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.key, b.key);
}

/** Most exposed first: unprotected cells, then controls that are not compliant, then the name. */
function compareHosts(a: MatrixHost, b: MatrixHost): number {
  if (a.counts.unprotected !== b.counts.unprotected) return b.counts.unprotected - a.counts.unprotected;
  const failed = (h: MatrixHost) => h.ratio.evaluated - h.ratio.compliant;
  if (failed(a) !== failed(b)) return failed(b) - failed(a);
  return byText(a.hostname.toLowerCase(), b.hostname.toLowerCase()) || byText(a.key, b.key);
}

function toCell(i: number, cell: ModelCell): MatrixCell {
  return {
    i,
    ...(cell.verdict ? { verdict: cell.verdict } : {}),
    ...(cell.ratio ? { ratio: cell.ratio } : {}),
    at: new Date(cell.atMs).toISOString(),
    ...(cell.earlier ? { earlier: cell.earlier } : {}),
  };
}

/** Rows = tests: the host axis once, and per test its counts and (up to the host limit) its cells. */
export function testsView(model: CoverageModel, windowLabel: string): CoverageMatrixTestsResponse {
  const cellsIncluded = model.hosts.length <= MATRIX_CELL_HOST_LIMIT;
  const listed = model.tests.slice(0, MATRIX_MAX_ROWS);
  return {
    rows: 'tests',
    windowLabel,
    hosts: model.hosts,
    hostCount: model.hosts.length,
    tests: listed.map((test, t) => ({
      ...test,
      cells: cellsIncluded ? [...model.cells[t]].sort((a, b) => a[0] - b[0]).map(([i, cell]) => toCell(i, cell)) : null,
    })),
    testCount: model.tests.length,
    cellsIncluded,
    truncated: model.tests.length > listed.length,
  };
}

export interface HostsViewOptions {
  page: number;
  pageSize: number;
  /** Only this test, and only the hosts that have a cell for it. */
  testUuid?: string;
  /** Only hosts whose cell (for `testUuid`, or for any test) shows this verdict. */
  verdict?: MatrixVerdict;
}

/** Rows = hosts: one page of hosts in the matrix's host order, each with a cell per test it ran. */
export function hostsView(model: CoverageModel, windowLabel: string, opts: HostsViewOptions): CoverageMatrixHostsResponse {
  const all = model.tests.map((_, t) => t);
  const wanted = opts.testUuid === undefined ? all : all.filter((t) => model.tests[t].testUuid === opts.testUuid);
  const axis = wanted.slice(0, MATRIX_MAX_ROWS);

  const matching: number[] = [];
  model.hosts.forEach((_, h) => {
    if (opts.testUuid !== undefined || opts.verdict !== undefined) {
      const ok = wanted.some((t) => {
        const cell = model.cells[t].get(h);
        return cell !== undefined && (opts.verdict === undefined || cell.verdict === opts.verdict);
      });
      if (!ok) return;
    }
    matching.push(h);
  });

  const start = (opts.page - 1) * opts.pageSize;
  return {
    rows: 'hosts',
    windowLabel,
    tests: axis.map((t) => model.tests[t]),
    testCount: wanted.length,
    hosts: matching.slice(start, start + opts.pageSize).map((h) => ({
      ...model.hosts[h],
      cells: axis.flatMap((t, i) => {
        const cell = model.cells[t].get(h);
        return cell ? [toCell(i, cell)] : [];
      }),
    })),
    hostCount: matching.length,
    page: opts.page,
    pageSize: opts.pageSize,
    truncated: wanted.length > axis.length,
  };
}
