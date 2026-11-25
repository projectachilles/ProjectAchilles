// "Alerts for this test run" lookup, shared by Defender and the endpoint EDRs
// (CrowdStrike, SentinelOne, Sophos). A lookup is a chain of tiers, each one
// only tried when the previous found nothing:
//
//   1. evidence: the vendor's evidence query (binary + host), when both known
//   2. technique + host, when the host is known
//   3. technique only, when the host is NOT known
//
// The old per-vendor code also ran tier 3 with the host clause after an empty
// tier 2: the same clauses in another order, so always the same empty answer
// and one wasted round trip per stage. It is not planned here.
//
// findAlertsForTests() answers many stages (an Executions bundle row) with one
// msearch per tier instead of one HTTP request and up to three sequential
// searches per stage.
//
// With `runStartedAt` the lookup has a run window (edr/runEvidence.ts): an
// alert that names this test only in another run's evidence is left out of
// every tier, and a tier whose hits are all left out counts as empty, so the
// lookup falls through to the next one. The searches request whole documents
// (no `_source` filter) because the run view reads `evidence_items`.

import { AppError } from '../../middleware/error.middleware.js';
import { leftOutOfRun, projectAlertHit } from './alertHit.js';
import { runWindow } from '../edr/runEvidence.js';
import { expandTechniqueAliases, techniqueAliases } from '../../data/techniqueAliases.js';

export interface AlertsForTestRequest {
  techniques: string[];
  timestamp: string;
  windowMinutes: number;
  hostname?: string;
  /** `<bundle-uuid>.exe` */
  binaryName?: string;
  bundleName?: string;
  /** When the run started (the result's `routing.run_started_at`); with `timestamp` it gives the run window. */
  runStartedAt?: string;
}

export interface EvidenceQueryInput {
  test_uuid: string;
  routing_event_time: string;
  routing_hostname: string;
  bundle_name?: string;
}

export interface AlertsForTestDeps {
  index: string;
  buildEvidenceQuery: (input: EvidenceQueryInput) => Record<string, unknown> | null;
  buildTimeWindow: (fromIso: string, toIso: string) => Record<string, unknown>;
  /**
   * The vendor's rule for a path that names the test, the one its enrichment
   * pass uses (Defender: `defenderPathNamesTest`). With a run window it decides
   * which paths count when an alert is left out of the run; without it, a
   * path names the test when it contains the uuid.
   */
  pathNamesTest?: (input: { test_uuid: string; bundle_name?: string }) => (path: string) => boolean;
}

type AlertItem = ReturnType<typeof projectAlertHit>;

/** The two client calls used here (an ES Client, or a test double). */
interface SearchClient {
  search(params: never): Promise<unknown>;
}
interface MsearchClient {
  msearch(params: never): Promise<unknown>;
}

export interface AlertsForTestResult {
  alerts: AlertItem[];
  matchedTechniques: string[];
  /** The number of alerts returned (after leaving out other runs' alerts). */
  total: number;
}

interface SearchBody {
  size: number;
  query: Record<string, unknown>;
  sort: Array<Record<string, unknown>>;
}

interface HitsPage {
  hits?: { total?: number | { value?: number }; hits?: Array<{ _source?: unknown }> };
}

// Alerts can fire during execution, before the result's timestamp.
const PRE_WINDOW_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;
const SORT = [{ created_at: { order: 'asc' } }];

function hostClause(hostname: string): Record<string, unknown> {
  const value = `${hostname.toUpperCase()}*`;
  return {
    bool: {
      should: [
        { wildcard: { evidence_hostnames: { value } } },
        { wildcard: { 'evidence_hostnames.keyword': { value } } },
      ],
      minimum_should_match: 1,
    },
  };
}

/** The ordered searches for one lookup (see the file header). */
export function alertsForTestTiers(req: AlertsForTestRequest, deps: AlertsForTestDeps): SearchBody[] {
  const testTime = new Date(req.timestamp).getTime();
  const from = new Date(testTime - PRE_WINDOW_MS).toISOString();
  const to = new Date(testTime + req.windowMinutes * 60 * 1000).toISOString();
  const tiers: SearchBody[] = [];

  if (req.binaryName && req.hostname) {
    // The evidence matcher is `<bundleUuid>*`; binaryName is `<bundleUuid>.exe`.
    const evidence = deps.buildEvidenceQuery({
      test_uuid: req.binaryName.toLowerCase().replace(/\.exe$/, ''),
      routing_event_time: req.timestamp,
      routing_hostname: req.hostname,
      bundle_name: req.bundleName,
    });
    if (evidence) tiers.push({ size: PAGE_SIZE, query: evidence, sort: SORT });
  }

  const must: Array<Record<string, unknown>> = [
    { term: { doc_type: 'alert' } },
    { terms: { mitre_techniques: expandTechniqueAliases(req.techniques) } },
    deps.buildTimeWindow(from, to),
  ];
  // With a host, keep it in the last tier too: during fleet-wide runs an
  // unscoped technique + window match would pull in sibling hosts' alerts.
  if (req.hostname) must.push(hostClause(req.hostname));
  tiers.push({ size: PAGE_SIZE, query: { bool: { must } }, sort: SORT });
  return tiers;
}

/**
 * Project hits, collect matched techniques, sort by proximity to the run.
 * Alerts left out of the run are dropped first; `total` counts what is kept.
 */
export function toAlertsForTestResult(
  req: AlertsForTestRequest,
  page: HitsPage,
  pathNamesTest?: AlertsForTestDeps['pathNamesTest'],
): AlertsForTestResult {
  const testTime = new Date(req.timestamp).getTime();
  // Stage attribution: alerts naming `<uuid>-<technique>.exe` vs the bundle.
  const bundleUuid = req.binaryName ? req.binaryName.toLowerCase().replace(/\.exe$/, '') : '';
  const window = runWindow(req.runStartedAt, req.timestamp);
  const pathRule = pathNamesTest?.({ test_uuid: bundleUuid, bundle_name: req.bundleName });
  const matched = new Set<string>();
  const alerts = (page.hits?.hits ?? [])
    .map((hit) => (hit._source ?? {}) as Record<string, unknown>)
    .filter((source) => !leftOutOfRun(source, bundleUuid, window, pathRule))
    .map((source) => {
      // Report the test's own id even when the alert used a renumbered one.
      for (const t of (source.mitre_techniques as string[] | undefined) ?? []) {
        for (const r of req.techniques) if (techniqueAliases(r).includes(t)) matched.add(r);
      }
      return projectAlertHit(source, bundleUuid, window);
    });
  alerts.sort(
    (a, b) =>
      Math.abs(new Date(a.created_at).getTime() - testTime) -
      Math.abs(new Date(b.created_at).getTime() - testTime),
  );
  return { alerts, matchedTechniques: Array.from(matched), total: alerts.length };
}

/** One lookup, tier by tier with client.search. */
export async function findAlertsForTest(
  client: SearchClient,
  req: AlertsForTestRequest,
  deps: AlertsForTestDeps,
): Promise<AlertsForTestResult> {
  const tiers = alertsForTestTiers(req, deps);
  let result = toAlertsForTestResult(req, {});
  for (const body of tiers) {
    const page = (await client.search({ index: deps.index, ...body } as never)) as HitsPage;
    result = toAlertsForTestResult(req, page, deps.pathNamesTest);
    if (result.alerts.length > 0) break;
  }
  return result;
}

/**
 * Many lookups with one msearch per tier: every stage's first tier in one
 * round trip, then the next tier only for stages still empty. Results come
 * back in input order; a stage whose search errored is null.
 */
export async function findAlertsForTests(
  client: MsearchClient,
  reqs: AlertsForTestRequest[],
  deps: AlertsForTestDeps,
): Promise<Array<AlertsForTestResult | null>> {
  const plans = reqs.map((req) => alertsForTestTiers(req, deps));
  const results: Array<AlertsForTestResult | null | undefined> = reqs.map(() => undefined);
  const lastResult: AlertsForTestResult[] = reqs.map((req) => toAlertsForTestResult(req, {}));

  for (let tier = 0; results.some((r) => r === undefined); tier++) {
    const pending = reqs
      .map((_, i) => i)
      .filter((i) => results[i] === undefined && tier < plans[i].length);
    // Stages that ran out of tiers keep their last (empty) answer.
    reqs.forEach((_, i) => {
      if (results[i] === undefined && tier >= plans[i].length) results[i] = lastResult[i];
    });
    if (pending.length === 0) break;

    const response = (await client.msearch({
      searches: pending.flatMap((i) => [{ index: deps.index }, plans[i][tier]]),
    } as never)) as { responses: Array<HitsPage & { error?: unknown }> };

    pending.forEach((i, k) => {
      const page = response.responses[k];
      if (!page || page.error) {
        results[i] = null;
        return;
      }
      // Decide on the alerts kept, not on the raw hit count.
      lastResult[i] = toAlertsForTestResult(reqs[i], page, deps.pathNamesTest);
      if (lastResult[i].alerts.length > 0 || tier === plans[i].length - 1) results[i] = lastResult[i];
    });
  }
  return results.map((r) => r ?? null);
}

export const MAX_ALERTS_FOR_TESTS_ITEMS = 100;
const MAX_TEXT = 300;

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new AppError(`Invalid ${name}`, 400);
  return value;
}

/** A stage the batch could not look up, reported in place of its result. */
export interface InvalidAlertsForTestItem {
  error: string;
}

function parseItem(raw: unknown): AlertsForTestRequest {
  const item = (raw ?? {}) as Record<string, unknown>;
  const techniques = item.techniques;
  if (
    !Array.isArray(techniques) ||
    techniques.length === 0 ||
    typeof item.timestamp !== 'string' ||
    !item.timestamp
  ) {
    throw new AppError('techniques and timestamp are required', 400);
  }
  // Test metadata lists long-form labels too ("T1562.001 (Impair Defenses:
  // Disable or Modify Tools)", 52 chars), so a per-technique cap must leave
  // room for them.
  if (!techniques.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TEXT) || techniques.length > 100) {
    throw new AppError('Invalid techniques', 400);
  }
  if (Number.isNaN(new Date(item.timestamp).getTime())) throw new AppError('Invalid timestamp', 400);
  const runStartedAt = optionalText(item.runStartedAt, 'runStartedAt');
  if (runStartedAt !== undefined && Number.isNaN(new Date(runStartedAt).getTime())) {
    throw new AppError('Invalid runStartedAt', 400);
  }
  const windowMinutes = item.windowMinutes === undefined ? 30 : item.windowMinutes;
  if (!Number.isInteger(windowMinutes) || (windowMinutes as number) < 1 || (windowMinutes as number) > 1440) {
    throw new AppError('Invalid windowMinutes', 400);
  }
  return {
    techniques: techniques as string[],
    timestamp: item.timestamp,
    windowMinutes: windowMinutes as number,
    hostname: optionalText(item.hostname, 'hostname'),
    binaryName: optionalText(item.binaryName, 'binaryName'),
    bundleName: optionalText(item.bundleName, 'bundleName'),
    ...(runStartedAt !== undefined ? { runStartedAt } : {}),
  };
}

/**
 * Validate a POST /correlation/alerts-for-tests body. A malformed request
 * (no items, too many) is a 400; a malformed stage is reported in its own
 * slot, so one bad stage never blanks the rest of an Executions row.
 */
export function parseAlertsForTestsBody(body: unknown): Array<AlertsForTestRequest | InvalidAlertsForTestItem> {
  const items = (body as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items) || items.length === 0) throw new AppError('items is required', 400);
  if (items.length > MAX_ALERTS_FOR_TESTS_ITEMS) {
    throw new AppError(`At most ${MAX_ALERTS_FOR_TESTS_ITEMS} items`, 400);
  }
  return items.map((raw) => {
    try {
      return parseItem(raw);
    } catch (err) {
      if (err instanceof AppError) return { error: err.message };
      throw err;
    }
  });
}

/**
 * The batch route's answer: valid stages looked up with `run` (one call),
 * invalid ones `null` in `results` with their reason in `errors` (same index).
 */
export async function answerAlertsForTests<R>(
  body: unknown,
  run: (requests: AlertsForTestRequest[]) => Promise<Array<R | null>>,
): Promise<{ results: Array<R | null>; errors: Array<string | null> }> {
  const parsed = parseAlertsForTestsBody(body);
  const valid = parsed.filter((p): p is AlertsForTestRequest => !('error' in p));
  const answers = valid.length > 0 ? await run(valid) : [];
  let next = 0;
  const results = parsed.map((p) => ('error' in p ? null : answers[next++] ?? null));
  const errors = parsed.map((p) => ('error' in p ? p.error : null));
  return { results, errors };
}
