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
import type { PairRun, PostureWindow } from './posture.js';
import { pairControlId, pairOrg, pairTestUuid } from './pairKeys.js';
import type { MovementOrigin, MovementOutcome } from '../../types/analytics.js';

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
  /** A failure in play: one the card accounts for. */
  inPlay: boolean;
  /** Set exactly when inPlay. */
  origin?: MovementOrigin;
  /** Set exactly when inPlay. */
  outcome?: MovementOutcome;
  /** Verdict of its first period result; undefined when it has none. */
  firstPeriodProtected?: boolean;
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
    inPlay,
    ...(period.length > 0 ? { firstPeriodProtected: period[0].protected } : {}),
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
