// Evidence-based technique coverage for the Defender, CrowdStrike, SentinelOne and Sophos tabs.
//
// One response drives both the Detection hero tile and the Technique Coverage
// table, so they can never disagree. Detection comes from the flags the
// enrichment passes write onto test docs, not from a technique ± hour-window
// match against alerts (the older /correlation/detection-rate, kept for the CLI).
//
// Kept byte-identical in backend/ and backend-serverless/.

import type { Client } from '@elastic/elasticsearch';
import type {
  AggregationsAggregationContainer,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types.js';
import { techniqueInfo } from '../../data/attackTechniques.js';
import { attackSimulationExclusions } from './attack-simulation-filter.js';
import { ENRICHMENT_ELIGIBLE_ERROR_CODES } from './enrichment-eligibility.js';
import { windowRange } from './integration-window.js';
import type { TimeWindow } from './integration-window.js';

export type CoverageVendor = 'crowdstrike' | 'defender' | 'sentinelone' | 'sophos';

/**
 * The hosts a vendor covers, so its tab is not divided by hosts it never saw.
 * `inventory`: the vendor's own agent/endpoint list; `alerts`: hosts that
 * raised one of its alerts recently. Names may be FQDNs in any case; they are
 * matched to result docs by short host name, case-insensitively.
 */
export type CoverageHostSource = 'inventory' | 'alerts';
export interface CoverageHostScope {
  source: CoverageHostSource;
  hostnames: string[];
}

export interface TechniqueCoverageItem {
  technique: string;
  name: string | null;
  executions: number;
  prevented: number;
  detectedOnly: number;
  missed: number;
  /**
   * Distinct vendor alerts in the window tagged with this id or any of its
   * `<id>.` sub-techniques (the drawer's rule). Parent alerts are not
   * credited to a sub-technique row.
   */
  alerts: number;
}

export interface TechniqueCoverageResponse {
  overall: {
    executions: number;
    prevented: number;
    detectedOnly: number;
    missed: number;
    /** % of distinct executions, 1 dp, 0 when executions = 0. */
    detectionRate: number;
    /** % of distinct executions, 1 dp, 0 when executions = 0. */
    preventionRate: number;
    testedTechniques: number;
    detectedTechniques: number;
  };
  /** Detected (prevented + detectedOnly > 0) first, then executions desc. */
  byTechnique: TechniqueCoverageItem[];
  /**
   * Which hosts the counts cover: the vendor's (`inventory` / `alerts`) or
   * every host with a result (`fleet`, no host scope given). `hosts` = hosts
   * with a counted result.
   */
  scope: { source: CoverageHostSource | 'fleet'; hosts: number };
}

export const COVERAGE_DEFAULT_DAYS = 30;
const TERMS_SIZE = 500;
const HOST_TERMS_SIZE = 10_000;
const DAY_MS = 86_400_000;

/** The route's window when from/to are absent: the last 30 days up to now. */
export function defaultCoverageWindow(now: number = Date.now()): TimeWindow {
  return {
    from: new Date(now - COVERAGE_DEFAULT_DAYS * DAY_MS).toISOString(),
    to: new Date(now).toISOString(),
  };
}

/**
 * Detected per execution (enrichment only ever writes these flags as `true`):
 *   - `<v>_stage_detected: true` — the doc's own stage/test was matched; or
 *   - `<v>_detected: true` on a doc that is NOT a bundle control — a standalone
 *     test's own detection. On a bundle control the wide flag only means the
 *     bundle UUID matched, so a stage is never credited because a sibling
 *     stage was caught; or
 *   - `<v>_prevented: true` — a vendor-confirmed prevention is a detection; or
 *   - the vendor killed the agent mid-run (`edr_terminated_vendors`).
 */
export function detectedClause(vendor: CoverageVendor): QueryDslQueryContainer {
  return {
    bool: {
      should: [
        { term: { [`f0rtika.${vendor}_stage_detected`]: true } },
        {
          bool: {
            filter: [{ term: { [`f0rtika.${vendor}_detected`]: true } }],
            must_not: [{ term: { 'f0rtika.is_bundle_control': true } }],
          },
        },
        { term: { [`f0rtika.${vendor}_prevented`]: true } },
        killedBy(vendor),
      ],
      minimum_should_match: 1,
    },
  };
}

/**
 * Prevented = `<v>_prevented: true` (a launch block's doc carries it too), or
 * the vendor killed the agent mid-run: that whole-test doc carries no vendor
 * flags, only `edr_terminated_vendors`. The detected predicate counts both.
 */
export function preventedClause(vendor: CoverageVendor): QueryDslQueryContainer {
  return {
    bool: {
      should: [{ term: { [`f0rtika.${vendor}_prevented`]: true } }, killedBy(vendor)],
      minimum_should_match: 1,
    },
  };
}

function killedBy(vendor: CoverageVendor): QueryDslQueryContainer {
  return { term: { 'f0rtika.edr_terminated_vendors': vendor } };
}

/**
 * Docs where stages ran: not a stageless whole-test doc for a run the EDR
 * killed with the agent (`edr_terminated`) or blocked at launch
 * (`edr_launch_blocked`). Such a run counts in the totals (it was stopped)
 * but never under a technique, since no stage exercised one.
 */
const STAGES_RAN: QueryDslQueryContainer = {
  bool: {
    must_not: [
      { term: { 'f0rtika.edr_terminated': true } },
      { term: { 'f0rtika.edr_launch_blocked': true } },
    ],
  },
};

/** Short host name, lower-cased: `WS-01.corp.example` and `ws-01` are one host. */
function hostKey(h: string): string {
  return h.trim().toLowerCase().split('.')[0];
}

function outcomeAgg(vendor: CoverageVendor): AggregationsAggregationContainer {
  return { filters: { filters: { prevented: preventedClause(vendor), detected: detectedClause(vendor) } } };
}

type OutcomeBuckets = { buckets?: { prevented?: { doc_count: number }; detected?: { doc_count: number } } };
type TechniqueBucket = { key: string; doc_count: number; outcome?: OutcomeBuckets };
type HostBucket = { key: string | number };

function outcomeCounts(agg: OutcomeBuckets | undefined): { prevented: number; detected: number } {
  return {
    prevented: agg?.buckets?.prevented?.doc_count ?? 0,
    detected: agg?.buckets?.detected?.doc_count ?? 0,
  };
}

function totalHits(total: unknown): number {
  if (typeof total === 'number') return total;
  if (total && typeof total === 'object' && 'value' in total) return Number((total as { value: number }).value) || 0;
  return 0;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export async function getTechniqueCoverage(
  client: Client,
  opts: {
    vendor: CoverageVendor;
    resultsIndex: string;
    alertIndex: string;
    window: TimeWindow;
    /** Count only these hosts' results; absent = every host (`scope.source: 'fleet'`). */
    hostScope?: CoverageHostScope;
  },
): Promise<TechniqueCoverageResponse> {
  const { vendor, resultsIndex, alertIndex, window, hostScope } = opts;
  const outcome = outcomeAgg(vendor);
  // The window is always set here, so windowRange never returns null.
  const inWindow = (field: string) => windowRange(field, window) as QueryDslQueryContainer;

  // The coverage execution set: attack simulations in the window with an
  // enrichment-eligible exit code. Stageless runs stay in (see STAGES_RAN).
  const eligible: QueryDslQueryContainer[] = [
    inWindow('routing.event_time'),
    { terms: { 'event.ERROR': ENRICHMENT_ELIGIBLE_ERROR_CODES } },
  ];
  const must_not = attackSimulationExclusions();
  let hostFilter: QueryDslQueryContainer[] = [];

  // Host scope: resolve the scope's names to the exact routing.hostname
  // values of the counted results (short name, any case). No match leaves an
  // empty terms filter, which matches nothing.
  if (hostScope) {
    const wanted = new Set(hostScope.hostnames.map(hostKey).filter((h) => h !== ''));
    const hostResponse = await client.search({
      index: resultsIndex,
      size: 0,
      query: { bool: { filter: eligible, must_not } },
      aggs: { hosts: { terms: { field: 'routing.hostname', size: HOST_TERMS_SIZE } } },
    });
    const hostAggs = hostResponse.aggregations as Record<string, unknown> | undefined;
    const buckets = ((hostAggs?.hosts as { buckets?: HostBucket[] } | undefined)?.buckets) ?? [];
    const matched = buckets.map((b) => String(b.key)).filter((h) => wanted.has(hostKey(h)));
    hostFilter = [{ terms: { 'routing.hostname': matched } }];
  }

  // Request 1: totals over the counted set, technique rows over the docs
  // where stages ran.
  const resultsResponse = await client.search({
    index: resultsIndex,
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [...eligible, ...hostFilter], must_not } },
    aggs: {
      overall: outcome,
      host_count: { cardinality: { field: 'routing.hostname' } },
      techniques: {
        filter: STAGES_RAN,
        aggs: {
          list: {
            terms: { field: 'f0rtika.techniques', size: TERMS_SIZE },
            aggs: { outcome },
          },
        },
      },
    },
  });

  const aggs = resultsResponse.aggregations as Record<string, unknown> | undefined;
  const techniqueBuckets =
    ((aggs?.techniques as { list?: { buckets?: TechniqueBucket[] } } | undefined)?.list?.buckets) ?? [];
  const hostCount = Number((aggs?.host_count as { value?: number } | undefined)?.value) || 0;

  // Request 2: vendor alerts per tested technique — one filters bucket per row
  // matching the id or an `<id>.` sub-technique, the same rule as
  // getAlerts({ techniques: [id] }) so the cell equals its drawer. A filters
  // bucket counts each alert once however many of the row's subs it carries.
  const alertCounts = new Map<string, number>();
  if (techniqueBuckets.length > 0) {
    const alertResponse = await client.search({
      index: alertIndex,
      size: 0,
      query: {
        bool: {
          filter: [{ term: { doc_type: 'alert' } }, inWindow('created_at')],
        },
      },
      aggs: {
        techniques: {
          filters: {
            filters: Object.fromEntries(
              techniqueBuckets.map((b): [string, QueryDslQueryContainer] => [
                b.key,
                {
                  bool: {
                    should: [
                      { term: { mitre_techniques: b.key } },
                      { prefix: { mitre_techniques: `${b.key}.` } },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ]),
            ),
          },
        },
      },
    });
    const alertAggs = alertResponse.aggregations as Record<string, unknown> | undefined;
    const buckets =
      (alertAggs?.techniques as { buckets?: Record<string, { doc_count: number }> } | undefined)?.buckets ?? {};
    for (const [key, b] of Object.entries(buckets)) alertCounts.set(key, b.doc_count);
  }

  const byTechnique: TechniqueCoverageItem[] = techniqueBuckets.map((b) => {
    const { prevented, detected } = outcomeCounts(b.outcome);
    return {
      technique: b.key,
      name: techniqueInfo(b.key)?.name ?? null,
      executions: b.doc_count,
      prevented,
      detectedOnly: detected - prevented,
      missed: b.doc_count - detected,
      alerts: alertCounts.get(b.key) ?? 0,
    };
  });

  const isDetected = (t: TechniqueCoverageItem) => t.prevented + t.detectedOnly > 0;
  byTechnique.sort((a, b) => {
    const da = isDetected(a);
    const db = isDetected(b);
    if (da !== db) return da ? -1 : 1;
    if (a.executions !== b.executions) return b.executions - a.executions;
    return a.technique.localeCompare(b.technique);
  });

  // Overall counts are distinct executions (one doc = one execution, judged by
  // its own flags), so the rows can sum past these totals.
  const executions = totalHits(resultsResponse.hits?.total);
  const overallCounts = outcomeCounts(aggs?.overall as OutcomeBuckets | undefined);

  return {
    overall: {
      executions,
      prevented: overallCounts.prevented,
      detectedOnly: overallCounts.detected - overallCounts.prevented,
      missed: executions - overallCounts.detected,
      detectionRate: pct(overallCounts.detected, executions),
      preventionRate: pct(overallCounts.prevented, executions),
      testedTechniques: byTechnique.length,
      detectedTechniques: byTechnique.filter(isDetected).length,
    },
    byTechnique,
    scope: { source: hostScope?.source ?? 'fleet', hosts: hostCount },
  };
}
