/**
 * Score movement: what became of each failure in a period, and how new tests
 * did on their first run, for the Dashboard's "What moved the score" card.
 *
 * Built from the Defense Score's own latest-basis, any-stage pair runs: a
 * result is failing exactly when the score's `protected` flag is false. The
 * unit is one test on one endpoint (an item): the chain pair and the plain
 * pair of one test on one host are merged, as the coverage matrix does; a
 * cyber-hygiene control stays its own item. Pure (no Elasticsearch);
 * ElasticsearchService fetches the runs.
 */
import { latestPairsAsOf, summarizePairs } from './posture.js';
import type { PairRun, PostureWindow } from './posture.js';
import { pairControlId, pairOrg, pairTestUuid } from './pairKeys.js';
import type {
  MovementList,
  MovementListKey,
  MovementOrigin,
  MovementOutcome,
  MovementRow,
  ScoreMovementResponse,
} from '../../types/analytics.js';

/** Rows kept per list; each list's total stays the full count. */
export const MOVEMENT_LIST_LIMIT = 200;

export interface MovementInput {
  window: PostureWindow;
  /** Latest result per score pair in [from - 365d, from), exclusion applied. */
  prior: PairRun[];
  /** Results in [from, to], exclusion applied, any order. */
  period: PairRun[];
  /** The same two without the risk-acceptance exclusion; null when nothing is excluded. */
  rawPrior: PairRun[] | null;
  rawPeriod: PairRun[] | null;
  /** testKeyOf() of every test with a conclusive result before `from`, org scope only. */
  knownTests: ReadonlySet<string>;
}

export interface MovementItem {
  /** itemKeyOf() of its runs. */
  key: string;
  /** testKeyOf() of its pair keys. */
  testKey: string;
  testUuid: string;
  controlId?: string;
  hostname: string;
  /** From the item's latest result. */
  testName: string;
  /** Any of its results has category 'cyber-hygiene'. */
  cyberHygiene: boolean;
  hasPrior: boolean;
  /** Time of its prior result (the latest before the period); undefined without one. */
  priorMs?: number;
  /** A failure in play: one the card accounts for. */
  inPlay: boolean;
  /** Set exactly when inPlay. */
  origin?: MovementOrigin;
  /** Set exactly when inPlay. */
  outcome?: MovementOutcome;
  /** Verdict of its first period result; undefined when it has none. */
  firstPeriodProtected?: boolean;
  /** Time of its first period result; undefined when it has none. */
  firstPeriodMs?: number;
  /** First period result of the failing run the row describes; null when openBeforePeriod or not inPlay. */
  failingSinceMs: number | null;
  /** That failing run includes the prior result, so its true start was not read. */
  openBeforePeriod: boolean;
  /** First protected result after that failing run. */
  fixedAtMs?: number;
  lastResultMs: number;
  /** Its score pairs whose latest period result is failing. */
  scoreFailingPairs: number;
}

/** `${org}|${testUuid}`: one test in one organization. */
export function testKeyOf(pairKey: string): string {
  return `${pairOrg(pairKey)}|${pairTestUuid(pairKey)}`;
}

/**
 * One test on one endpoint. A control keeps its pair key; otherwise
 * `${org}|${testUuid}|${run.hostname}`, which merges a `bundle:` key and the
 * plain key of the same test and host. The hostname is the run's, not parsed
 * out of the key, because a hostname may contain the key separator.
 */
export function itemKeyOf(run: PairRun): string {
  if (pairControlId(run.pairKey) !== undefined) return run.pairKey;
  return `${testKeyOf(run.pairKey)}|${run.hostname}`;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every item with a result before or inside the period, ordered by key. */
export function classifyItems(input: Pick<MovementInput, 'window' | 'prior' | 'period' | 'knownTests'>): MovementItem[] {
  const groups = new Map<string, PairRun[]>();
  for (const run of [...input.prior, ...input.period]) {
    const key = itemKeyOf(run);
    let runs = groups.get(key);
    if (!runs) groups.set(key, (runs = []));
    runs.push(run);
  }
  const items: MovementItem[] = [];
  for (const [key, runs] of groups) {
    const item = classifyItem(key, runs, input.window, input.knownTests);
    if (item) items.push(item);
  }
  return items.sort((a, b) => byText(a.key, b.key));
}

function classifyItem(key: string, runs: PairRun[], window: PostureWindow, knownTests: ReadonlySet<string>): MovementItem | null {
  // One result read twice (the first and the last of a day are one document) counts once.
  const seen = new Set<string>();
  const unique = runs.filter((r) => {
    const id = `${r.ts}|${r.pairKey}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  unique.sort((a, b) => a.ts - b.ts || byText(a.pairKey, b.pairKey));

  // The timeline is the prior result (the latest before the period) and every period result.
  const prior = unique.filter((r) => r.ts < window.fromMs).at(-1);
  const period = unique.filter((r) => r.ts >= window.fromMs && r.ts <= window.toMs);
  const timeline = prior ? [prior, ...period] : period;
  const latest = timeline.at(-1);
  if (!latest) return null;

  const testKey = testKeyOf(latest.pairKey);
  const controlId = pairControlId(latest.pairKey);
  const cyberHygiene = unique.some((r) => r.category === 'cyber-hygiene');

  const latestPerPair = new Map<string, PairRun>();
  for (const r of period) latestPerPair.set(r.pairKey, r);
  let scoreFailingPairs = 0;
  for (const r of latestPerPair.values()) if (!r.protected) scoreFailingPairs++;

  const priorFailing = prior !== undefined && !prior.protected;
  const inScoreAtStart = prior !== undefined && prior.ts >= window.fromMs - window.freshnessMs;
  const inPlay = (priorFailing && (inScoreAtStart || period.length > 0)) || period.some((r) => !r.protected);

  const item: MovementItem = {
    key,
    testKey,
    testUuid: pairTestUuid(latest.pairKey),
    ...(controlId !== undefined ? { controlId } : {}),
    hostname: latest.hostname,
    testName: latest.testName,
    cyberHygiene,
    hasPrior: prior !== undefined,
    ...(prior !== undefined ? { priorMs: prior.ts } : {}),
    inPlay,
    ...(period.length > 0 ? { firstPeriodProtected: period[0].protected, firstPeriodMs: period[0].ts } : {}),
    failingSinceMs: null,
    openBeforePeriod: false,
    lastResultMs: latest.ts,
    scoreFailingPairs,
  };
  if (!inPlay) return item;

  // The last unbroken run of failing results on the timeline: for an open
  // item the one that ends with its latest result, for a fixed item the one
  // before its latest protected result.
  let end = timeline.length - 1;
  while (end >= 0 && timeline[end].protected) end--;
  let start = end;
  while (start > 0 && !timeline[start - 1].protected) start--;
  const openBeforePeriod = prior !== undefined && start === 0;

  item.origin = originOf(timeline[0], priorFailing, inScoreAtStart, cyberHygiene, knownTests.has(testKey));
  item.outcome = period.length === 0 ? 'left_untested' : latest.protected ? 'fixed' : end > start ? 'still_failing' : 'not_retested';
  item.openBeforePeriod = openBeforePeriod;
  item.failingSinceMs = openBeforePeriod ? null : timeline[start].ts;
  if (end < timeline.length - 1) item.fixedAtMs = timeline[end + 1].ts;
  return item;
}

/** The origin rows in precedence order: a failing prior result wins over a regression. */
function originOf(first: PairRun, priorFailing: boolean, inScoreAtStart: boolean, cyberHygiene: boolean, known: boolean): MovementOrigin {
  if (priorFailing) return inScoreAtStart ? 'open_at_start' : 'older_retested';
  // Not a failing prior, so the first result on the timeline is protected
  // exactly when a protected result comes before the first failing one.
  if (first.protected) return 'regression';
  return !known && !cyberHygiene ? 'new_test' : 'first_on_endpoint';
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const rate = (part: number, whole: number): number | null => (whole === 0 ? null : round2((part / whole) * 100));
const iso = (ms: number): string => new Date(ms).toISOString();
const isOpen = (outcome: MovementOutcome | undefined): boolean =>
  outcome === 'still_failing' || outcome === 'not_retested' || outcome === 'left_untested';

/** A pair of a new attack test: no prior result, a period result, not cyber-hygiene, the test not known. */
function isNewTestPair(item: MovementItem, knownTests: ReadonlySet<string>): boolean {
  return !item.hasPrior && item.firstPeriodMs !== undefined && !item.cyberHygiene && !knownTests.has(item.testKey);
}

function rowOf(item: MovementItem, withOrigin: boolean): MovementRow {
  return {
    testUuid: item.testUuid,
    testName: item.testName,
    ...(item.controlId !== undefined ? { controlId: item.controlId } : {}),
    hostname: item.hostname,
    ...(withOrigin && item.origin !== undefined ? { origin: item.origin } : {}),
    failingSince: item.failingSinceMs === null ? null : iso(item.failingSinceMs),
    ...(item.openBeforePeriod ? { openBeforePeriod: true as const } : {}),
    ...(item.fixedAtMs !== undefined ? { fixedAt: iso(item.fixedAtMs) } : {}),
    lastResultAt: iso(item.lastResultMs),
  };
}

const byTie = (a: MovementItem, b: MovementItem): number => byText(a.testUuid, b.testUuid) || byText(a.hostname, b.hostname);

/** Work lists: failures open before the period first, oldest prior result first; then oldest failingSince first. */
function byOldestFailure(a: MovementItem, b: MovementItem): number {
  if (a.openBeforePeriod !== b.openBeforePeriod) return a.openBeforePeriod ? -1 : 1;
  const ta = a.openBeforePeriod ? (a.priorMs ?? 0) : (a.failingSinceMs ?? 0);
  const tb = b.openBeforePeriod ? (b.priorMs ?? 0) : (b.failingSinceMs ?? 0);
  return ta - tb || byTie(a, b);
}
const byNewestFix = (a: MovementItem, b: MovementItem): number => (b.fixedAtMs ?? 0) - (a.fixedAtMs ?? 0) || byTie(a, b);
const byNewestFirstRun = (a: MovementItem, b: MovementItem): number =>
  (b.firstPeriodMs ?? 0) - (a.firstPeriodMs ?? 0) || byTie(a, b);

function listOf(items: MovementItem[], order: (a: MovementItem, b: MovementItem) => number, withOrigin = true): MovementList {
  const rows = items.slice().sort(order).slice(0, MOVEMENT_LIST_LIMIT).map((item) => rowOf(item, withOrigin));
  return { total: items.length, rows };
}

/** Open failures that the risk-acceptance exclusion removes entirely; null when nothing is excluded. */
function riskAcceptedCount(input: MovementInput): number | null {
  if (input.rawPrior === null && input.rawPeriod === null) return null;
  const kept = new Set<string>();
  for (const run of [...input.prior, ...input.period]) kept.add(itemKeyOf(run));
  const raw = classifyItems({
    window: input.window,
    prior: input.rawPrior ?? input.prior,
    period: input.rawPeriod ?? input.period,
    knownTests: input.knownTests,
  });
  return raw.filter((item) => isOpen(item.outcome) && !kept.has(item.key)).length;
}

/** The "What moved the score" response for one period. */
export function buildScoreMovement(input: MovementInput): ScoreMovementResponse {
  const { window, knownTests } = input;
  const items = classifyItems(input);
  const inPlay = items.filter((item) => item.inPlay);
  const withOutcome = (outcome: MovementOutcome) => inPlay.filter((item) => item.outcome === outcome);
  const withOrigin = (origin: MovementOrigin) => inPlay.filter((item) => item.origin === origin).length;

  const fixed = withOutcome('fixed');
  const stillFailing = withOutcome('still_failing');
  const notRetested = withOutcome('not_retested');
  const leftUntested = withOutcome('left_untested');

  const newPairs = items.filter((item) => isNewTestPair(item, knownTests));
  const newStopped = newPairs.filter((item) => item.firstPeriodProtected === true);
  const newGotThrough = newPairs.filter((item) => item.firstPeriodProtected === false);
  const gotThroughFixed = newGotThrough.filter((item) => item.outcome === 'fixed').length;

  const firstOnEndpoint = items.filter(
    (item) => !item.hasPrior && item.firstPeriodMs !== undefined && !isNewTestPair(item, knownTests),
  );
  const regressed = inPlay.filter((item) => item.origin === 'regression');

  const start = summarizePairs(latestPairsAsOf(input.prior, window.fromMs, window.freshnessMs));
  const end = summarizePairs(latestPairsAsOf(input.period, window.toMs, window.freshnessMs));

  const lists: Record<MovementListKey, MovementList> = {
    fixed: listOf(fixed, byNewestFix),
    stillFailing: listOf(stillFailing, byOldestFailure),
    notRetested: listOf(notRetested, byOldestFailure),
    leftUntested: listOf(leftUntested, byOldestFailure),
    newStopped: listOf(newStopped, byNewestFirstRun, false),
    newGotThrough: listOf(newGotThrough, byNewestFirstRun),
  };

  return {
    window: { from: iso(window.fromMs), to: iso(window.toMs), label: window.label },
    pairs: { start: start.pairCount, end: end.pairCount },
    failing: { start: start.pairCount - start.protectedCount, end: end.pairCount - end.protectedCount },
    scoreDifference: {
      fixedButCounted: fixed.filter((item) => item.scoreFailingPairs >= 1).length,
      countedTwice: [...stillFailing, ...notRetested].filter((item) => item.scoreFailingPairs === 2).length,
    },
    failures: {
      total: inPlay.length,
      fixed: fixed.length,
      stillFailing: stillFailing.length,
      notRetested: notRetested.length,
      leftUntested: leftUntested.length,
      fixRate: rate(fixed.length, inPlay.length),
      origins: {
        openAtStart: withOrigin('open_at_start'),
        olderRetested: withOrigin('older_retested'),
        regression: withOrigin('regression'),
        newTest: withOrigin('new_test'),
        firstOnEndpoint: withOrigin('first_on_endpoint'),
      },
    },
    newTests: {
      tests: new Set(newPairs.map((item) => item.testKey)).size,
      pairs: newPairs.length,
      stopped: newStopped.length,
      gotThrough: newGotThrough.length,
      rate: rate(newStopped.length, newPairs.length),
      gotThroughFixed,
      gotThroughOpen: newGotThrough.length - gotThroughFixed,
    },
    regressed: { total: regressed.length, fixed: regressed.filter((item) => item.outcome === 'fixed').length },
    firstOnEndpoint: {
      pairs: firstOnEndpoint.length,
      stopped: firstOnEndpoint.filter((item) => item.firstPeriodProtected === true).length,
    },
    riskAccepted: riskAcceptedCount(input),
    lists,
  };
}
