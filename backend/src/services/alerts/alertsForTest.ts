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

import { AppError } from '../../middleware/error.middleware.js';
import { projectAlertHit } from './alertHit.js';

export interface AlertsForTestRequest {
  techniques: string[];
  timestamp: string;
  windowMinutes: number;
  hostname?: string;
  /** `<bundle-uuid>.exe` */
  binaryName?: string;
  bundleName?: string;
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
    { terms: { mitre_techniques: req.techniques } },
    deps.buildTimeWindow(from, to),
  ];
  // With a host, keep it in the last tier too: during fleet-wide runs an
  // unscoped technique + window match would pull in sibling hosts' alerts.
  if (req.hostname) must.push(hostClause(req.hostname));
  tiers.push({ size: PAGE_SIZE, query: { bool: { must } }, sort: SORT });
  return tiers;
}

function totalOf(page: HitsPage): number {
  const total = page.hits?.total;
  return typeof total === 'number' ? total : total?.value ?? 0;
}

/** Project hits, collect matched techniques, sort by proximity to the run. */
export function toAlertsForTestResult(req: AlertsForTestRequest, page: HitsPage): AlertsForTestResult {
  const testTime = new Date(req.timestamp).getTime();
  // Stage attribution: alerts naming `<uuid>-<technique>.exe` vs the bundle.
  const bundleUuid = req.binaryName ? req.binaryName.toLowerCase().replace(/\.exe$/, '') : '';
  const matched = new Set<string>();
  const alerts = (page.hits?.hits ?? []).map((hit) => {
    const source = (hit._source ?? {}) as Record<string, unknown>;
    for (const t of (source.mitre_techniques as string[] | undefined) ?? []) {
      if (req.techniques.includes(t)) matched.add(t);
    }
    return projectAlertHit(source, bundleUuid);
  });
  alerts.sort(
    (a, b) =>
      Math.abs(new Date(a.created_at).getTime() - testTime) -
      Math.abs(new Date(b.created_at).getTime() - testTime),
  );
  return { alerts, matchedTechniques: Array.from(matched), total: totalOf(page) };
}

/** One lookup, tier by tier with client.search. */
export async function findAlertsForTest(
  client: SearchClient,
  req: AlertsForTestRequest,
  deps: AlertsForTestDeps,
): Promise<AlertsForTestResult> {
  const tiers = alertsForTestTiers(req, deps);
  let page: HitsPage = {};
  for (const body of tiers) {
    page = (await client.search({ index: deps.index, ...body } as never)) as HitsPage;
    if (totalOf(page) > 0) break;
  }
  return toAlertsForTestResult(req, page);
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
  const lastPage: HitsPage[] = reqs.map(() => ({}));

  for (let tier = 0; results.some((r) => r === undefined); tier++) {
    const pending = reqs
      .map((_, i) => i)
      .filter((i) => results[i] === undefined && tier < plans[i].length);
    // Stages that ran out of tiers keep their last (empty) answer.
    reqs.forEach((req, i) => {
      if (results[i] === undefined && tier >= plans[i].length) results[i] = toAlertsForTestResult(req, lastPage[i]);
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
      lastPage[i] = page;
      if (totalOf(page) > 0 || tier === plans[i].length - 1) {
        results[i] = toAlertsForTestResult(reqs[i], page);
      }
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
