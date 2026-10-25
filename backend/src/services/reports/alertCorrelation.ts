// Bulk EDR alert correlation for the execution report (spec §5.3).
//
// The console correlates one stage at a time (alerts-for-test) and repeats
// the identical evidence query for every stage of a run. The report
// deduplicates to ONE evidence sub-search per run, batched with msearch,
// then runs the technique+host fallback only for runs that came back empty.
// Those are the console's tiers whenever a hostname is known: its two
// fallbacks build the same query once a hostname is present.
//
// A sub-search error is never read as "no alerts". Any error other than
// index_not_found_exception is counted in `failed`, so the report can warn,
// and so is a sub-search missing from a short msearch response. `searched`
// lists the runs some sub-search actually answered for, so a run that was
// never searched does not read as clean. A missing index is an expected empty
// result (it counts as searched), and when every tier-1 search reports it,
// tier 2 is skipped because it would fail the same way.

import type { Client } from '@elastic/elasticsearch';
import {
  buildAlertTimeWindowQuery as defenderTimeWindow,
  buildDefenderEvidenceQuery,
  type TestEvidenceInput,
} from '../defender/evidence-correlation.js';
import {
  buildAlertTimeWindowQuery as crowdstrikeTimeWindow,
  buildCrowdStrikeEvidenceQuery,
} from '../crowdstrike/evidence-correlation.js';
import { DEFENDER_INDEX } from '../defender/index-management.js';
import { CROWDSTRIKE_INDEX } from '../crowdstrike/index-management.js';
import { SENTINELONE_INDEX } from '../sentinelone/index-management.js';
import { projectAlertHit } from '../alerts/alertHit.js';
import { isAchillesMitigated, ACHILLES_MITIGATION_FIELDS } from '../shared/achillesMitigation.js';
import type { ReportAlert } from '../../types/reports.js';

/** Same lead and default post-window the console uses. */
const PRE_WINDOW_MS = 5 * 60 * 1000;
const POST_WINDOW_MS = 30 * 60 * 1000;
export const CORRELATION_BATCH_SIZE = 100;
const HITS_PER_RUN = 50;
const ALERT_SOURCE_FIELDS = [
  'alert_id', 'alert_title', 'description', 'severity', 'status', 'category', 'service_source',
  'mitre_techniques', 'created_at', 'updated_at', 'resolved_at', 'recommended_actions',
  'evidence_filenames', 'prevention_action', 'portal_url', 'f0rtika.auto_resolved_at',
  'f0rtika.auto_resolve_mode', 'f0rtika.auto_resolve_error', ...ACHILLES_MITIGATION_FIELDS,
];

export interface VendorAdapter {
  vendor: ReportAlert['vendor'];
  index: string;
  buildEvidenceQuery: (input: TestEvidenceInput) => Record<string, unknown> | null;
  buildTimeWindowQuery: (fromIso: string, toIso: string) => Record<string, unknown>;
}

export const DEFENDER_ADAPTER: VendorAdapter = {
  vendor: 'defender',
  index: DEFENDER_INDEX,
  buildEvidenceQuery: buildDefenderEvidenceQuery,
  buildTimeWindowQuery: defenderTimeWindow,
};

export const CROWDSTRIKE_ADAPTER: VendorAdapter = {
  vendor: 'crowdstrike',
  index: CROWDSTRIKE_INDEX,
  buildEvidenceQuery: buildCrowdStrikeEvidenceQuery,
  buildTimeWindowQuery: crowdstrikeTimeWindow,
};

/** SentinelOne docs share the CrowdStrike evidence shape and correlation rules. */
export const SENTINELONE_ADAPTER: VendorAdapter = {
  vendor: 'sentinelone',
  index: SENTINELONE_INDEX,
  buildEvidenceQuery: buildCrowdStrikeEvidenceQuery,
  buildTimeWindowQuery: crowdstrikeTimeWindow,
};

export interface CorrelationRun {
  key: string;
  /** Bundle UUID or standalone test UUID — the evidence binary prefix. */
  testKey: string;
  hostname: string;
  completedAt: string;
  bundleName?: string;
  techniques: string[];
}

export interface CorrelationResult {
  alerts: Map<string, ReportAlert[]>;
  /** false when the deadline cut correlation short. */
  complete: boolean;
  /**
   * Sub-searches (tier 1 and tier 2) that errored with anything other than
   * index_not_found_exception, or got no response at all (a short msearch
   * response). A run counted here may have no entry in `alerts` because the
   * search failed, not because it was clean.
   */
  failed: number;
  /**
   * Keys of the runs a sub-search answered for without error: tier 1, or tier 2
   * when tier 1 had no query or failed. index_not_found_exception counts as an
   * answer (the vendor has no alerts). A run missing here was never checked,
   * which is not the same as having no alerts.
   */
  searched: Set<string>;
}

export function buildHostTechniqueQuery(adapter: VendorAdapter, run: CorrelationRun): Record<string, unknown> {
  const completed = Date.parse(run.completedAt);
  const host = `${run.hostname.toUpperCase()}*`;
  return {
    bool: {
      must: [
        { term: { doc_type: 'alert' } },
        { terms: { mitre_techniques: run.techniques } },
        {
          bool: {
            should: [
              { wildcard: { evidence_hostnames: { value: host } } },
              { wildcard: { 'evidence_hostnames.keyword': { value: host } } },
            ],
            minimum_should_match: 1,
          },
        },
        adapter.buildTimeWindowQuery(
          new Date(completed - PRE_WINDOW_MS).toISOString(),
          new Date(completed + POST_WINDOW_MS).toISOString(),
        ),
      ],
    },
  };
}

function toReportAlert(adapter: VendorAdapter, source: Record<string, unknown>, run: CorrelationRun): ReportAlert {
  const p = projectAlertHit(source, run.testKey);
  return {
    vendor: adapter.vendor,
    title: p.alert_title,
    severity: p.severity,
    status: p.status,
    createdAt: p.created_at,
    stageControlId: p.attribution === 'stage' ? p.attributed_control_id ?? null : null,
    // Achilles' own automatic mitigation is not the EDR's prevention (same rule as Analytics).
    preventionAction: isAchillesMitigated(source) ? null : p.prevention_action ?? null,
    portalUrl: p.portal_url ?? null,
    autoResolvedAt: p.auto_resolved_at ?? null,
  };
}

interface Entry { run: CorrelationRun; query: Record<string, unknown> }

/** Outcome of one sub-search. `missing-index` is an expected empty result; `failed` is not. */
interface SubOutcome {
  sources: Record<string, unknown>[];
  failure: 'missing-index' | 'failed' | null;
}

/**
 * One msearch: one outcome per entry. A sub-response with `error` yields no sources and is
 * classified by its error type; an entry the response has no sub-response for is a failure.
 */
async function msearchSources(
  client: Client,
  adapter: VendorAdapter,
  entries: Entry[],
): Promise<SubOutcome[]> {
  if (entries.length === 0) return [];
  const searches = entries.flatMap(({ query }) => [
    { index: adapter.index },
    { size: HITS_PER_RUN, query, sort: [{ created_at: { order: 'asc' } }], _source: ALERT_SOURCE_FIELDS },
  ]);
  const response = await client.msearch({ searches } as never);
  const responses = (response as { responses?: unknown[] }).responses ?? [];
  return entries.map((_, i): SubOutcome => {
    const sub = responses[i] as { error?: unknown; hits?: { hits?: { _source?: Record<string, unknown> }[] } } | undefined;
    if (!sub) return { sources: [], failure: 'failed' };
    if (sub.error) {
      // An error with no type counts as a failure; only the known missing-index case is expected.
      const type = (sub.error as { type?: string } | undefined)?.type;
      return { sources: [], failure: type === 'index_not_found_exception' ? 'missing-index' : 'failed' };
    }
    return { sources: (sub.hits?.hits ?? []).map((h) => h._source ?? {}), failure: null };
  });
}

export async function correlateRuns(
  client: Client,
  adapter: VendorAdapter,
  runs: CorrelationRun[],
  opts: { deadline: number; batchSize?: number },
): Promise<CorrelationResult> {
  const alerts = new Map<string, ReportAlert[]>();
  const searched = new Set<string>();
  const batchSize = opts.batchSize ?? CORRELATION_BATCH_SIZE;
  const unmatched: CorrelationRun[] = [];
  let failed = 0;
  let tier1Searches = 0;
  let tier1MissingIndex = 0;

  const record = (entries: Entry[], outcomes: SubOutcome[], onEmpty?: (run: CorrelationRun) => void) => {
    entries.forEach(({ run }, i) => {
      const outcome = outcomes[i];
      if (outcome.failure === 'failed') failed += 1;
      else searched.add(run.key);
      const hits = outcome.sources;
      if (hits.length > 0) alerts.set(run.key, hits.map((s) => toReportAlert(adapter, s, run)));
      else onEmpty?.(run);
    });
  };

  // Tier 1: evidence (the same query the enrichment pass uses).
  for (let i = 0; i < runs.length; i += batchSize) {
    if (Date.now() > opts.deadline) return { alerts, complete: false, failed, searched };
    const entries: Entry[] = [];
    for (const run of runs.slice(i, i + batchSize)) {
      const query = adapter.buildEvidenceQuery({
        test_uuid: run.testKey,
        routing_event_time: run.completedAt,
        routing_hostname: run.hostname,
        bundle_name: run.bundleName,
      });
      if (query) entries.push({ run, query });
      else unmatched.push(run);
    }
    const outcomes = await msearchSources(client, adapter, entries);
    tier1Searches += entries.length;
    tier1MissingIndex += outcomes.filter((o) => o.failure === 'missing-index').length;
    record(entries, outcomes, (run) => unmatched.push(run));
  }

  // Tier 2: technique + host, only for runs the evidence tier missed. Skipped when
  // every tier-1 search reported a missing index: the vendor has no alert index,
  // so the fallback cannot match either.
  const indexMissing = tier1Searches > 0 && tier1MissingIndex === tier1Searches;
  const fallback = indexMissing ? [] : unmatched.filter((r) => r.techniques.length > 0);
  for (let i = 0; i < fallback.length; i += batchSize) {
    if (Date.now() > opts.deadline) return { alerts, complete: false, failed, searched };
    const entries = fallback.slice(i, i + batchSize).map((run) => ({ run, query: buildHostTechniqueQuery(adapter, run) }));
    record(entries, await msearchSources(client, adapter, entries));
  }

  return { alerts, complete: true, failed, searched };
}
