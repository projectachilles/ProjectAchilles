// Reconciliation pass for test runs an EDR blocked at launch. Windows refuses
// to create the orchestrator's process, the agent reports exit 260
// (BlockedPreExecution) and the run stays inconclusive: the agent can't tell
// an EDR block from Defender ASR rule 01443614, a prevalence gate the platform
// deliberately does not count as protection. When an EDR's own prevention
// alert names that run's task directory (or the test's orchestrator binary in
// the correlation window), the run was the EDR protecting the endpoint, so the
// 260 doc is rewritten in place to 126 Protected, credited to that EDR, with
// the audit trail in f0rtika.launch_block (rule: launch-block-evidence.ts).
// Like an EDR-killed run, it counts for the test but never for a technique.
//
// Order of work: the vendors' prevention alerts that name an Achilles run come
// first (they are few), then only the 260 docs they could prove. A fleet where
// ASR blocks many launches has many 260 docs; this keeps the pass cheap there.
//
// Unlike the agent-kill pass (whose alerts get a separate achilles_agent_kill_*
// link), the proving alerts here are marked `f0rtika.achilles_correlated`
// exactly as the enrichment pass marks them: the alert names this test's own
// binary or run directory, which is the same evidence enrichment trusts, so
// auto-resolve may act on them. An agent-kill alert names no test at all.
import type { Client, estypes } from '@elastic/elasticsearch';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { RESULTS_INDEX_MAPPING } from '../analytics/index-management.service.js';
import { ERROR_CODE_MAP } from '../analytics/elasticsearch.js';
import { CONFIRMED_PREVENTION_ACTIONS, getSourceField } from '../reports/stageOutcome.js';
import { isAchillesMitigated, ACHILLES_MITIGATION_FIELDS, ACHILLES_MITIGATED_QUERY } from '../shared/achillesMitigation.js';
import { edrFlagField } from '../outcomes/vendors.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';
import { VENDOR_INDICES, launchBlockVendorIndices } from './edr-configured.js';
import type { VendorIndex } from './edr-configured.js';
import { resolveBundleNames } from './bundle-identity.js';
import { POST_WINDOW_MS, PRE_WINDOW_MS, extractBundleUuid } from './evidence-correlation.js';
import { parseSqliteUtc, shortHostname } from './agent-kill-evidence.js';
import {
  BLOCKED_PRE_EXECUTION_CODE,
  TASK_PATH_WINDOW_MS,
  evidenceKeys,
  matchLaunchBlocks,
  summarizeLaunchBlock,
} from './launch-block-evidence.js';
import type { LaunchBlockCandidate, LaunchBlockEvidenceAlert, LaunchBlockMatch, LaunchBlockSibling } from './launch-block-evidence.js';
import type { LaunchBlockPassResult } from '../../types/launch-block.js';

export type { LaunchBlockPassResult };

/** Lookback of a process's first full pass: the enrichment pass's span, so past runs are reconciled after an upgrade. */
const DEFAULT_LOOKBACK_DAYS = 90;
/** Lookback of every later pass; vendor alerts sync within minutes, so 2 days is ample. */
const RECENT_LOOKBACK_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
/** Per vendor per pass. More means a pathological index; the rest waits for the next pass. */
const MAX_ALERTS_PER_VENDOR = 5_000;
/** Task ids / test uuids per results search. */
const KEYS_PER_SEARCH = 1_000;

const INDEX_OF_VENDOR = new Map<EdrVendorKey, string>(VENDOR_INDICES.map((v) => [v.vendor, v.index]));

/** The exit code a proved launch block becomes: execution prevented. */
const PROTECTED_CODE = 126;

/** On an alert doc: the result doc it proved a launch block for. An alert proves at most one run, ever. */
const RECEIPT_FIELD = 'achilles_launch_block_doc_id';
/** Sibling-run clauses (one per file-name-only alert) per results search. */
const SIBLING_CLAUSES_PER_SEARCH = 100;

const ALERT_SOURCE_FIELDS = [
  'created_at', 'evidence_hostnames', 'evidence_filenames', 'evidence_filepaths', 'prevention_action',
  'f0rtika.achilles_test_uuid', 'f0rtika.achilles_correlated', `f0rtika.${RECEIPT_FIELD}`, ...ACHILLES_MITIGATION_FIELDS,
];
const RESULT_SOURCE_FIELDS = [
  'routing.event_time', 'routing.hostname', 'event.ERROR', 'f0rtika.test_uuid', 'f0rtika.error_name',
  'f0rtika.category', 'f0rtika.is_bundle_control', 'f0rtika.edr_launch_blocked',
];

interface Candidate extends LaunchBlockCandidate {
  index: string;
  seqNo?: number;
  primaryTerm?: number;
  errorName?: string;
}

interface AlertLink {
  vendor: EdrVendorKey;
  alertId: string;
  docId: string;
  testUuid: string;
}

interface PlannedWrite {
  candidate: Candidate;
  proofs: Array<{ alert: LaunchBlockEvidenceAlert; match: LaunchBlockMatch }>;
}

function emptyResult(errors: string[] = []): LaunchBlockPassResult {
  return { evidenceAlerts: 0, candidates: 0, resolved: 0, errors };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function isMissingIndex(err: unknown): boolean {
  const e = err as { meta?: { body?: { error?: { type?: string } } }; message?: string } | null;
  return e?.meta?.body?.error?.type === 'index_not_found_exception' || /index_not_found_exception/.test(e?.message ?? '');
}

/** `wildcard` on both the bare field and `.keyword`: alert indices map evidence_* either way. */
function wildcardEither(field: string, value: string): estypes.QueryDslQueryContainer[] {
  return [
    { wildcard: { [field]: { value, case_insensitive: true } } },
    { wildcard: { [`${field}.keyword`]: { value, case_insensitive: true } } },
  ];
}

/**
 * Coarse ES prefilter for one vendor's alerts. `alertProvesLaunchBlock` is the
 * authority; this only keeps prevention alerts whose evidence could name an
 * Achilles run directory or an orchestrator binary.
 */
function evidenceAlertQuery(sinceIso: string): estypes.QueryDslQueryContainer {
  return {
    bool: {
      filter: [
        { term: { doc_type: 'alert' } },
        { range: { created_at: { gte: sinceIso } } },
        { terms: { prevention_action: [...CONFIRMED_PREVENTION_ACTIONS] } },
        {
          bool: {
            should: [
              ...wildcardEither('evidence_filepaths', '*task-*'),
              ...wildcardEither('evidence_filenames', '*????????-????-????-????-????????????.exe'),
            ],
            minimum_should_match: 1,
          },
        },
      ],
      // Already proved a run: never another one.
      must_not: [ACHILLES_MITIGATED_QUERY, { exists: { field: `f0rtika.${RECEIPT_FIELD}` } }],
    },
  };
}

export class EdrLaunchBlockReconciler {
  /** Result and alert indices whose launch-block mapping was put during this pass. */
  private readonly mappedIndices = new Set<string>();
  /** The last pass stopped at a page cap, so it did not see everything in its lookback. */
  truncated = false;

  constructor(
    private readonly client: Client,
    private readonly resultsIndexPattern: string,
  ) {}

  async runPass(opts: { lookbackDays?: number; now?: Date } = {}): Promise<LaunchBlockPassResult> {
    const result = emptyResult();
    this.truncated = false;
    const vendors = launchBlockVendorIndices();
    if (vendors.length === 0) return result;

    const now = opts.now ?? new Date();
    const sinceMs = now.getTime() - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * DAY_MS;
    // First link the alerts of docs resolved earlier whose alert write failed,
    // so auto-resolve sees them and their receipt keeps them to that one run.
    await this.relinkResolved(vendors, new Date(sinceMs).toISOString(), now.toISOString(), result.errors);
    // A task-path alert may be up to a day away from its result.
    const alerts = await this.fetchEvidenceAlerts(vendors, new Date(sinceMs - TASK_PATH_WINDOW_MS).toISOString(), result.errors);
    result.evidenceAlerts = alerts.length;

    const keys = evidenceKeys(alerts);
    if (keys.taskIds.length === 0 && keys.testUuids.length === 0) return result;

    const candidates = await this.fetchCandidates(keys, new Date(sinceMs).toISOString(), result.errors);
    result.candidates = candidates.length;
    if (candidates.length === 0) return result;

    const siblings = await this.fetchSiblings(alerts, result.errors);
    // Without the sibling runs a file-name-only alert could go to the wrong
    // run, so only task-folder evidence counts on such a pass.
    const usable = siblings ? alerts : alerts.filter((a) => evidenceKeys([a]).taskIds.length > 0);
    const proofs = matchLaunchBlocks(candidates, usable, siblings ?? []);
    const planned: PlannedWrite[] = candidates
      .filter((c) => proofs.has(c.docId))
      .map((c) => ({ candidate: c, proofs: proofs.get(c.docId)! }));
    if (planned.length === 0) return result;

    const uuids = [...new Set(planned.map((p) => extractBundleUuid(p.candidate.testUuid)))];
    let bundles = new Map<string, string>();
    try {
      bundles = await resolveBundleNames(this.client, this.resultsIndexPattern, uuids);
    } catch (err) {
      // Without the bundle decision a multi-stage doc would score as its own
      // pair next to the bundle's; wait for the next pass instead.
      result.errors.push(`bundle lookup: ${errMsg(err)}`);
      return result;
    }

    result.resolved = await this.write(planned, bundles, now.toISOString(), result.errors);
    return result;
  }

  /** Prevention alerts naming an Achilles run or orchestrator, per launch-block-capable vendor. */
  private async fetchEvidenceAlerts(vendors: VendorIndex[], sinceIso: string, errors: string[]): Promise<LaunchBlockEvidenceAlert[]> {
    const out: LaunchBlockEvidenceAlert[] = [];
    for (const { vendor, index } of vendors) {
      let searchAfter: estypes.SortResults | undefined;
      let fetched = 0;
      for (;;) {
        let res: estypes.SearchResponse<Record<string, unknown>>;
        try {
          res = await this.client.search<Record<string, unknown>>({
            index,
            ignore_unavailable: true,
            allow_no_indices: true,
            size: PAGE_SIZE,
            sort: [{ created_at: 'asc' }],
            _source: ALERT_SOURCE_FIELDS,
            query: evidenceAlertQuery(sinceIso),
            ...(searchAfter ? { search_after: searchAfter } : {}),
          });
        } catch (err) {
          if (!isMissingIndex(err)) errors.push(`alerts[${vendor}]: ${errMsg(err)}`);
          break;
        }
        const hits = res.hits.hits;
        for (const hit of hits) {
          if (!hit._id) continue;
          const s = hit._source ?? {};
          const f0 = (s.f0rtika ?? {}) as Record<string, unknown>;
          out.push({
            id: hit._id,
            vendor,
            createdAt: typeof s.created_at === 'string' ? s.created_at : null,
            evidenceHostnames: strings(s.evidence_hostnames),
            evidenceFilenames: strings(s.evidence_filenames),
            evidenceFilepaths: strings(s.evidence_filepaths),
            preventionAction: typeof s.prevention_action === 'string' ? s.prevention_action : undefined,
            achillesMitigated: isAchillesMitigated(s),
            ...(typeof f0.achilles_test_uuid === 'string' ? { achillesTestUuid: f0.achilles_test_uuid } : {}),
            ...(f0.achilles_correlated === true ? { achillesCorrelated: true } : {}),
            ...(typeof f0[RECEIPT_FIELD] === 'string' ? { launchBlockDocId: f0[RECEIPT_FIELD] as string } : {}),
          });
        }
        fetched += hits.length;
        if (hits.length < PAGE_SIZE) break;
        if (fetched >= MAX_ALERTS_PER_VENDOR) {
          this.truncated = true;
          console.warn(`[EDR-LaunchBlock] ${vendor}: stopped at ${fetched} evidence alerts; the rest waits for the next pass`);
          break;
        }
        searchAfter = hits[hits.length - 1].sort;
        if (!searchAfter) break;
      }
    }
    return out;
  }

  /** The unresolved standalone 260 docs the alerts name (by task id or test uuid). */
  private async fetchCandidates(keys: { taskIds: string[]; testUuids: string[] }, sinceIso: string, errors: string[]): Promise<Candidate[]> {
    const byKey = new Map<string, Candidate>();
    const chunks = Math.max(Math.ceil(keys.taskIds.length / KEYS_PER_SEARCH), Math.ceil(keys.testUuids.length / KEYS_PER_SEARCH));
    for (let i = 0; i < chunks; i++) {
      const taskIds = keys.taskIds.slice(i * KEYS_PER_SEARCH, (i + 1) * KEYS_PER_SEARCH);
      const testUuids = keys.testUuids.slice(i * KEYS_PER_SEARCH, (i + 1) * KEYS_PER_SEARCH);
      const should: estypes.QueryDslQueryContainer[] = [];
      if (taskIds.length > 0) should.push({ ids: { values: taskIds } });
      if (testUuids.length > 0) should.push({ terms: { 'f0rtika.test_uuid': testUuids } });
      let searchAfter: estypes.SortResults | undefined;
      for (;;) {
        let res: estypes.SearchResponse<Record<string, unknown>>;
        try {
          res = await this.client.search<Record<string, unknown>>({
            index: this.resultsIndexPattern,
            ignore_unavailable: true,
            allow_no_indices: true,
            size: PAGE_SIZE,
            seq_no_primary_term: true,
            sort: [{ 'routing.event_time': 'desc' }],
            _source: RESULT_SOURCE_FIELDS,
            query: {
              bool: {
                filter: [
                  { term: { 'event.ERROR': BLOCKED_PRE_EXECUTION_CODE } },
                  { range: { 'routing.event_time': { gte: sinceIso } } },
                  { bool: { should, minimum_should_match: 1 } },
                ],
                must_not: [
                  { term: { 'f0rtika.is_bundle_control': true } },
                  { term: { 'f0rtika.category': 'cyber-hygiene' } },
                  { term: { 'f0rtika.edr_launch_blocked': true } },
                ],
              },
            },
            ...(searchAfter ? { search_after: searchAfter } : {}),
          });
        } catch (err) {
          errors.push(`results: ${errMsg(err)}`);
          break;
        }
        const hits = res.hits.hits;
        for (const hit of hits) {
          const c = toCandidate(hit);
          if (c) byKey.set(`${c.index}/${c.docId}`, c);
        }
        if (hits.length < PAGE_SIZE) break;
        searchAfter = hits[hits.length - 1].sort;
        if (!searchAfter) break;
      }
    }
    return [...byKey.values()];
  }

  /**
   * Result docs first (conditional on the version that was evaluated), then
   * the alert links for the docs that were written. Returns how many docs were
   * resolved. A failed doc write links nothing and is retried next pass.
   */
  private async write(planned: PlannedWrite[], bundles: Map<string, string>, nowIso: string, errors: string[]): Promise<number> {
    for (const index of new Set(planned.map((p) => p.candidate.index))) await this.ensureMapping(index);

    const operations: NonNullable<estypes.BulkRequest['operations']> = [];
    for (const p of planned) {
      const c = p.candidate;
      operations.push({
        update: {
          _index: c.index,
          _id: c.docId,
          ...(c.seqNo !== undefined && c.primaryTerm !== undefined ? { if_seq_no: c.seqNo, if_primary_term: c.primaryTerm } : {}),
        },
      });
      operations.push({ doc: resolvedDoc(c, p.proofs, bundles.get(extractBundleUuid(c.testUuid)), nowIso) });
    }

    const written: PlannedWrite[] = [];
    try {
      const res = await this.client.bulk({ operations });
      res.items.forEach((item, i) => {
        const error = item.update?.error;
        if (error) errors.push(`result ${planned[i].candidate.docId}: ${error.reason ?? error.type}`);
        else written.push(planned[i]);
      });
    } catch (err) {
      errors.push(`results bulk: ${errMsg(err)}`);
      return 0;
    }

    const markerError = await this.markAlerts(
      written.flatMap((p) => p.proofs.map(({ alert }) => ({
        vendor: alert.vendor, alertId: alert.id, docId: p.candidate.docId, testUuid: p.candidate.testUuid,
      }))),
      nowIso,
    );
    if (markerError) errors.push(`alert links: ${markerError}`);
    return written.length;
  }

  /**
   * Link the proving alerts to their test, as the enrichment pass does, plus
   * the receipt naming the one run each proved. Returns an error message, or null.
   */
  private async markAlerts(links: AlertLink[], nowIso: string): Promise<string | null> {
    const operations: NonNullable<estypes.BulkRequest['operations']> = [];
    const seen = new Set<string>();
    for (const l of links) {
      const key = `${l.vendor}/${l.alertId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const index = INDEX_OF_VENDOR.get(l.vendor);
      if (!index) continue;
      await this.ensureAlertMapping(index);
      operations.push({ update: { _index: index, _id: l.alertId, retry_on_conflict: 3 } });
      operations.push({
        doc: {
          f0rtika: {
            achilles_correlated: true,
            achilles_test_uuid: extractBundleUuid(l.testUuid),
            achilles_matched_at: nowIso,
            [RECEIPT_FIELD]: l.docId,
          },
        },
      });
    }
    if (operations.length === 0) return null;
    try {
      const res = await this.client.bulk({ operations });
      if (!res.errors) return null;
      const reasons = res.items
        .map((item) => item.update?.error?.reason)
        .filter((r): r is string => typeof r === 'string');
      return reasons.slice(0, 3).join('; ') || 'bulk reported errors';
    } catch (err) {
      return errMsg(err);
    }
  }

  /**
   * Docs resolved in the lookback whose proving alerts carry no receipt yet
   * (the alert write failed after the doc write): link them now. Cheap: only
   * docs this pass resolved, then one ids lookup per vendor.
   */
  private async relinkResolved(vendors: VendorIndex[], sinceIso: string, nowIso: string, errors: string[]): Promise<void> {
    let res: estypes.SearchResponse<Record<string, unknown>>;
    try {
      res = await this.client.search<Record<string, unknown>>({
        index: this.resultsIndexPattern,
        ignore_unavailable: true,
        allow_no_indices: true,
        size: PAGE_SIZE,
        sort: [{ 'routing.event_time': 'desc' }],
        _source: ['f0rtika.test_uuid', 'f0rtika.edr_launch_blocked', 'f0rtika.launch_block.alert_ids', 'f0rtika.launch_block.vendors'],
        query: {
          bool: {
            filter: [
              { term: { 'f0rtika.edr_launch_blocked': true } },
              { range: { 'routing.event_time': { gte: sinceIso } } },
            ],
          },
        },
      });
    } catch (err) {
      errors.push(`relink: ${errMsg(err)}`);
      return;
    }
    // "<vendor>/<alert id>" -> the doc it proved
    const owners = new Map<string, { docId: string; testUuid: string }>();
    for (const hit of res.hits.hits) {
      const s = hit._source ?? {};
      const testUuid = getSourceField(s, 'f0rtika.test_uuid');
      if (!hit._id || getSourceField(s, 'f0rtika.edr_launch_blocked') !== true || typeof testUuid !== 'string') continue;
      const docVendors = strings(getSourceField(s, 'f0rtika.launch_block.vendors'));
      for (const alertId of strings(getSourceField(s, 'f0rtika.launch_block.alert_ids'))) {
        for (const v of docVendors) owners.set(`${v}/${alertId}`, { docId: hit._id, testUuid });
      }
    }
    if (owners.size === 0) return;

    const links: AlertLink[] = [];
    for (const { vendor, index } of vendors) {
      const ids = [...owners.keys()].filter((k) => k.startsWith(`${vendor}/`)).map((k) => k.slice(vendor.length + 1));
      for (let i = 0; i < ids.length; i += KEYS_PER_SEARCH) {
        const chunk = ids.slice(i, i + KEYS_PER_SEARCH);
        let found: estypes.SearchResponse<Record<string, unknown>>;
        try {
          found = await this.client.search<Record<string, unknown>>({
            index,
            ignore_unavailable: true,
            allow_no_indices: true,
            size: chunk.length,
            _source: [`f0rtika.${RECEIPT_FIELD}`],
            query: { bool: { filter: [{ ids: { values: chunk } }], must_not: [{ exists: { field: `f0rtika.${RECEIPT_FIELD}` } }] } },
          });
        } catch (err) {
          if (!isMissingIndex(err)) errors.push(`relink[${vendor}]: ${errMsg(err)}`);
          continue;
        }
        const wanted = new Set(chunk);
        for (const hit of found.hits.hits) {
          if (!hit._id || !wanted.has(hit._id)) continue;
          if (typeof getSourceField(hit._source ?? {}, `f0rtika.${RECEIPT_FIELD}`) === 'string') continue;
          const owner = owners.get(`${vendor}/${hit._id}`);
          if (owner) links.push({ vendor, alertId: hit._id, docId: owner.docId, testUuid: owner.testUuid });
        }
      }
    }
    const markerError = await this.markAlerts(links, nowIso);
    if (markerError) errors.push(`relink alert links: ${markerError}`);
  }

  /**
   * Other runs of the tests the file-name-only alerts name, on the alert's
   * host and inside its correlation window: results that executed (any code
   * but an unresolved whole-test 260, stage docs included) or were already
   * resolved. An alert as near to one of them is that run's (matchLaunchBlocks).
   * Null when the lookup failed.
   */
  private async fetchSiblings(alerts: LaunchBlockEvidenceAlert[], errors: string[]): Promise<LaunchBlockSibling[] | null> {
    const clauses: estypes.QueryDslQueryContainer[] = [];
    for (const a of alerts) {
      const keys = evidenceKeys([a]);
      const created = a.createdAt ? parseSqliteUtc(a.createdAt) : NaN;
      if (keys.taskIds.length > 0 || keys.testUuids.length === 0 || !Number.isFinite(created)) continue;
      const hosts = [...new Set(a.evidenceHostnames.map(shortHostname).filter(Boolean))];
      if (hosts.length === 0) continue;
      clauses.push({
        bool: {
          filter: [
            {
              bool: {
                should: [{ terms: { 'f0rtika.test_uuid': keys.testUuids } }, { terms: { 'f0rtika.bundle_id': keys.testUuids } }],
                minimum_should_match: 1,
              },
            },
            { range: { 'routing.event_time': { gte: new Date(created - POST_WINDOW_MS).toISOString(), lte: new Date(created + PRE_WINDOW_MS).toISOString() } } },
            {
              bool: {
                should: hosts.map((h) => ({ wildcard: { 'routing.hostname': { value: `${h.replace(/[*?\\]/g, '')}*`, case_insensitive: true } } })),
                minimum_should_match: 1,
              },
            },
          ],
        },
      });
    }
    const siblings: LaunchBlockSibling[] = [];
    for (let i = 0; i < clauses.length; i += SIBLING_CLAUSES_PER_SEARCH) {
      const should = clauses.slice(i, i + SIBLING_CLAUSES_PER_SEARCH);
      let searchAfter: estypes.SortResults | undefined;
      for (;;) {
        let res: estypes.SearchResponse<Record<string, unknown>>;
        try {
          res = await this.client.search<Record<string, unknown>>({
            index: this.resultsIndexPattern,
            ignore_unavailable: true,
            allow_no_indices: true,
            size: PAGE_SIZE,
            sort: [{ 'routing.event_time': 'desc' }],
            _source: ['routing.event_time', 'routing.hostname', 'event.ERROR', 'f0rtika.test_uuid', 'f0rtika.is_bundle_control'],
            query: { bool: { should, minimum_should_match: 1 } },
            ...(searchAfter ? { search_after: searchAfter } : {}),
          });
        } catch (err) {
          errors.push(`siblings: ${errMsg(err)}`);
          return null;
        }
        const hits = res.hits.hits;
        for (const hit of hits) {
          const s = hit._source ?? {};
          const unresolved260 = Number(getSourceField(s, 'event.ERROR')) === BLOCKED_PRE_EXECUTION_CODE
            && getSourceField(s, 'f0rtika.is_bundle_control') !== true;
          if (unresolved260) continue;
          const testUuid = getSourceField(s, 'f0rtika.test_uuid');
          const hostname = getSourceField(s, 'routing.hostname');
          const eventTime = getSourceField(s, 'routing.event_time');
          const eventTimeMs = typeof eventTime === 'string' ? parseSqliteUtc(eventTime) : NaN;
          if (typeof testUuid !== 'string' || typeof hostname !== 'string' || !Number.isFinite(eventTimeMs)) continue;
          siblings.push({ testUuid, hostname, eventTimeMs });
        }
        if (hits.length < PAGE_SIZE) break;
        searchAfter = hits[hits.length - 1].sort;
        if (!searchAfter) break;
      }
    }
    return siblings;
  }

  /**
   * Declare the launch-block fields on the doc's index before the first write,
   * so an index whose mapping predates them doesn't map them dynamically
   * (alert ids as text). Additive and non-fatal.
   */
  /** Declare the receipt on an alert index before its first write (additive, non-fatal). */
  private async ensureAlertMapping(index: string): Promise<void> {
    if (this.mappedIndices.has(index)) return;
    this.mappedIndices.add(index);
    try {
      await this.client.indices.putMapping({ index, properties: { f0rtika: { properties: { [RECEIPT_FIELD]: { type: 'keyword' } } } } });
    } catch (err) {
      console.warn(`[EDR-LaunchBlock] putMapping failed for ${index}: ${errMsg(err)}`);
    }
  }

  private async ensureMapping(index: string): Promise<void> {
    if (this.mappedIndices.has(index)) return;
    this.mappedIndices.add(index);
    const all = RESULTS_INDEX_MAPPING.mappings.properties.f0rtika.properties;
    try {
      await this.client.indices.putMapping({
        index,
        properties: { f0rtika: { properties: { edr_launch_blocked: all.edr_launch_blocked, launch_block: all.launch_block } } },
      });
    } catch (err) {
      console.warn(`[EDR-LaunchBlock] putMapping failed for ${index}: ${errMsg(err)}`);
    }
  }
}

function toCandidate(hit: estypes.SearchHit<Record<string, unknown>>): Candidate | null {
  const s = hit._source ?? {};
  if (!hit._id || !hit._index) return null;
  // The query already excludes these; checked again so a loose mapping can't let one through.
  if (Number(getSourceField(s, 'event.ERROR')) !== BLOCKED_PRE_EXECUTION_CODE) return null;
  if (getSourceField(s, 'f0rtika.is_bundle_control') === true) return null;
  if (getSourceField(s, 'f0rtika.category') === 'cyber-hygiene') return null;
  if (getSourceField(s, 'f0rtika.edr_launch_blocked') === true) return null;
  const hostname = getSourceField(s, 'routing.hostname');
  const testUuid = getSourceField(s, 'f0rtika.test_uuid');
  const eventTime = getSourceField(s, 'routing.event_time');
  const eventTimeMs = typeof eventTime === 'string' ? parseSqliteUtc(eventTime) : NaN;
  if (typeof hostname !== 'string' || !hostname || typeof testUuid !== 'string' || !testUuid || !Number.isFinite(eventTimeMs)) return null;
  const errorName = getSourceField(s, 'f0rtika.error_name');
  return {
    docId: hit._id,
    index: hit._index,
    testUuid,
    hostname,
    eventTimeMs,
    ...(typeof hit._seq_no === 'number' ? { seqNo: hit._seq_no } : {}),
    ...(typeof hit._primary_term === 'number' ? { primaryTerm: hit._primary_term } : {}),
    ...(typeof errorName === 'string' ? { errorName } : {}),
  };
}

/** The partial update that turns a 260 doc into the EDR's Protected result. */
function resolvedDoc(
  c: Candidate,
  proofs: Array<{ alert: LaunchBlockEvidenceAlert; match: LaunchBlockMatch }>,
  bundleName: string | undefined,
  nowIso: string,
): Record<string, unknown> {
  const { actions, ...block } = summarizeLaunchBlock(proofs, nowIso);
  const flags: Record<string, unknown> = {};
  const nested = (field: string) => field.slice('f0rtika.'.length);
  for (const v of block.vendors) {
    flags[nested(edrFlagField(v, 'detected'))] = true;
    flags[nested(edrFlagField(v, 'prevented'))] = true;
    if (actions[v]) flags[nested(edrFlagField(v, 'prevention_action'))] = actions[v];
  }
  return {
    event: { ERROR: PROTECTED_CODE },
    f0rtika: {
      is_protected: true,
      error_name: ERROR_CODE_MAP[PROTECTED_CODE].name,
      edr_launch_blocked: true,
      launch_block: {
        original_exit_code: block.original_exit_code,
        original_error_name: c.errorName ?? ERROR_CODE_MAP[BLOCKED_PRE_EXECUTION_CODE].name,
        vendors: block.vendors,
        alert_ids: block.alert_ids,
        evidence: block.evidence,
        resolved_at: block.resolved_at,
      },
      ...flags,
      ...(bundleName ? { bundle_id: extractBundleUuid(c.testUuid), bundle_name: bundleName } : {}),
    },
  };
}

/** What a vendor sync records when the pass could not run at all. */
export function failedLaunchBlockPass(err: unknown): LaunchBlockPassResult {
  return emptyResult([errMsg(err)]);
}

let current: Promise<LaunchBlockPassResult> | null = null;
let trailing: Promise<LaunchBlockPassResult> | null = null;
/** Set once this process has run a clean, complete 90-day pass with a launch-block-capable EDR configured. */
let fullLookbackDone = false;

/** Test hook: forget that the first full-lookback pass ran. */
export function resetLaunchBlockLookback(): void {
  fullLookbackDone = false;
}

/**
 * Run one reconciliation pass with the analytics ES client. Never throws:
 * failures come back in `errors` and the next sync retries. Passes never
 * overlap: a call made while one runs waits for it and then gets exactly one
 * trailing pass (shared by every such caller), so alerts a vendor synced
 * mid-pass are still seen.
 */
export function runLaunchBlockReconciliation(): Promise<LaunchBlockPassResult> {
  if (trailing) return trailing;
  if (!current) return startPass();
  trailing = current.then(() => {
    trailing = null;
    return startPass();
  });
  return trailing;
}

function startPass(): Promise<LaunchBlockPassResult> {
  const pass: Promise<LaunchBlockPassResult> = runOnce().finally(() => {
    if (current === pass) current = null;
  });
  current = pass;
  return pass;
}

async function runOnce(): Promise<LaunchBlockPassResult> {
  try {
    const settings = new SettingsService().getSettings();
    if (!settings.configured) return emptyResult(['Elasticsearch is not configured']);
    const reconciler = new EdrLaunchBlockReconciler(createEsClient(settings), settings.indexPattern);
    // The first pass per process looks back 90 days (runs from before an
    // upgrade, restart or deploy); later passes only 2. A pass that hit
    // errors, stopped at a cap, or had no capable EDR doesn't count.
    const lookbackDays = fullLookbackDone ? RECENT_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS;
    const result = await reconciler.runPass({ lookbackDays });
    if (result.errors.length === 0 && !reconciler.truncated && launchBlockVendorIndices().length > 0) fullLookbackDone = true;
    if (result.resolved || result.errors.length) {
      console.log(
        `[EDR-LaunchBlock] evidenceAlerts=${result.evidenceAlerts} candidates=${result.candidates} ` +
        `resolved=${result.resolved} errors=${result.errors.length}`,
      );
      for (const e of result.errors.slice(0, 5)) console.warn(`[EDR-LaunchBlock-ERROR] ${e}`);
    }
    return result;
  } catch (err) {
    const msg = errMsg(err);
    console.error(`[EDR-LaunchBlock] pass threw: ${msg}`);
    return emptyResult([msg]);
  }
}
