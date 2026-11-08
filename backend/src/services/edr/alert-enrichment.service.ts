import type { Client } from '@elastic/elasticsearch';
// Shared evidence-correlation pass for every EDR alert index (Defender,
// CrowdStrike, SentinelOne, Sophos): matches alerts to Achilles result docs
// and writes f0rtika.<vendor>_detected / _stage_detected / _prevented /
// _prevention_action / _stage_prevented flags. Vendor subclasses bind the
// target (<vendor>/enrichment.service.ts); one test suite runs per vendor
// (edr/__tests__/alert-enrichment.vendors.test.ts).
import {
  buildCrowdStrikeEvidenceQuery,
  buildStageCrowdStrikeEvidenceQuery,
  extractBundleUuid,
} from './evidence-correlation.js';
import type { EnrichmentPassOptions, EnrichmentPassResult } from '../../types/edr.js';
import { isAchillesMitigated, ACHILLES_MITIGATION_FIELDS, ACHILLES_MITIGATED_QUERY } from '../shared/achillesMitigation.js';
import { alertCredit, isStageFile, isTestFile, MULTI_TEST_EVIDENCE_FIELDS } from './multiTestEvidence.js';
import { ACTION_TIME_FIELDS, actedInRun, actedInRunClause, inRunCutoff } from './preventionTiming.js';
import { enrichmentEligibleClauses } from '../analytics/enrichment-eligibility.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_DURATION_MS = 60_000;
// Conclusive outcomes PLUS error/inconclusive codes (0, 1, 259, 999). Error-category
// docs are scanned so EDR-killed stages — which land as 999/259, not a conclusive
// code — can earn detection flags when alert evidence actually matches them.
// Evidence decides the flag, not the exit code; unmatched error docs stay untouched.
// 260 (BlockedPreExecution) is deliberately excluded: it stems from ASR/app-control
// policy blocks, including the ASR rule the platform excludes by design
// (docs/defender-asr-exclusion-rationale.md).
// See docs/edr-killed-stage-detection.md.

// Exit codes proving a stage reached a conclusive outcome on its own
// (101 executed unprotected; 105/126/127 policy-prevented). A wide/bundle-level
// alert match must not claim vendor prevention for those stages — only
// stage-binary matches may. See docs/edr-prevention-action-detection.md.
const CONCLUSIVE_OUTCOME_CODES = new Set([101, 105, 126, 127]);

/**
 * Sub-queries read (nearly) every matching alert, because each one is
 * classified: a multi-test alert is evidence only for the files the vendor
 * marked malicious (multiTestEvidence.ts). Matches are narrow (this host, this
 * window, this test's or stage's binaries).
 */
const EVIDENCE_HITS_PER_SUBQUERY = 100;

/**
 * Marks a stage evaluated under the single-test stage-evidence rule. Stages
 * flagged before it are re-checked once (eligibility clause) and lose their
 * stage flags when no stage alert still in the index counts.
 */
export const STAGE_RULE = 'single_test';

/**
 * Marks a doc evaluated under the per-file verdict rule at test level (a
 * multi-test alert counts only through the vendor's verdict on this test's
 * own files). Docs detected before it are re-checked once and lose
 * `<vendor>_detected` when no alert still in the index counts for the test.
 */
export const EVIDENCE_RULE = 'file_verdict';

/**
 * Marks a doc evaluated under the in-run prevention rules: on a stage that
 * exited 101, an action counts only when it happened before the run ended
 * (preventionTiming.ts), and a
 * stage's own prevention comes only from actions on its own file or on a
 * process it started, when the alert records actions per evidence item
 * (multiTestEvidence.ts ownActions). Docs prevented before it are re-checked
 * once and lose the prevention flags when their alerts are still in the
 * index and no action qualifies.
 */
export const PREVENTION_RULE = 'in_run';

/**
 * Prevention actions that count as vendor-confirmed PREVENTION (vs.
 * detection-only). Derived from pattern_disposition_details at sync time —
 * see docs/edr-prevention-action-detection.md. 'kill_failed' is deliberately
 * NOT here: a failed kill is not prevention.
 */
const PREVENTION_ACTIONS = new Set(['quarantined', 'process_killed', 'blocked']);

/**
 * How long a stage that is detected but not prevented by its own alert keeps
 * being re-checked. EDRs often attach the action after the alert was first
 * matched: Defender updates an alert's remediation status, SentinelOne adds
 * mitigation entries, Sophos sends the remedy as a separate SIEM event
 * (live: a Defender "blocked" status landed 23 minutes after the alert).
 */
export const DEFAULT_RECHECK_UNPREVENTED_HOURS = 72;

/** Distinct prevention actions per alert sub-query (aggregated over every matching alert). */
const PREVENTION_ACTION_BUCKETS = 10;

/** The wide (bundle) and stage alert queries for one result doc. */
export interface EvidenceQueryBuilders {
  wide: typeof buildCrowdStrikeEvidenceQuery;
  stage: typeof buildStageCrowdStrikeEvidenceQuery;
}

/**
 * Which vendor's alert index to read and which `f0rtika.<vendor>_*` flags to
 * write. Vendors share the pass because their normalized alert docs share the
 * evidence_* / prevention_action shape.
 */
export interface EnrichmentVendorTarget {
  alertIndex: string;
  flagPrefix: EdrVendorKey;
  /**
   * Ignore the prevention action of alerts that ProjectAchilles itself
   * mitigated (SentinelOne automatic mitigation writes an
   * `f0rtika.auto_mitigated` receipt). Our own kill / quarantine is not the
   * EDR preventing the test, so it must never turn into `<vendor>_prevented`.
   */
  ignoreAchillesMitigated?: boolean;
  /**
   * Re-check stages flagged `<vendor>_stage_detected` but not
   * `<vendor>_stage_prevented` whose routing.event_time is within this many
   * hours (default DEFAULT_RECHECK_UNPREVENTED_HOURS), so an action that
   * reaches the alert after the first match still counts. A re-checked doc
   * only gets flags it lacks, and only alerts not yet `achilles_correlated`
   * get the alert-side write, so passes over an unchanged doc write nothing.
   */
  recheckUnpreventedHours?: number;
  /**
   * The wide (bundle) and stage evidence queries. Defaults to the shared
   * builders; Defender passes its own, whose time window handles its alert
   * aggregation and re-fires (defender/evidence-correlation.ts).
   */
  evidenceQueries?: EvidenceQueryBuilders;
}

export class EdrAlertEnrichmentService {
  constructor(
    private readonly client: Client,
    private readonly resultsIndexPattern: string,
    private readonly target: EnrichmentVendorTarget,
  ) {}

  async runEnrichmentPass(
    options: EnrichmentPassOptions = {},
  ): Promise<EnrichmentPassResult> {
    const startedAt = Date.now();
    const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

    const result: EnrichmentPassResult = {
      scanned: 0,
      detected: 0,
      stageDetected: 0,
      skipped: 0,
      batches: 0,
      alertsMarkedCorrelated: 0,
      errors: [],
      durationMs: 0,
    };

    let searchAfter: unknown[] | undefined;

    while (Date.now() - startedAt < maxDurationMs) {
      // 1. Scan next batch of eligible docs
      let scanResponse;
      try {
        scanResponse = await this.client.search({
          index: this.resultsIndexPattern,
          size: batchSize,
          query: this.buildEligibilityQuery(lookbackDays),
          // Sort by event_time only — _id fielddata is disabled on Elastic Cloud
          // Serverless. Ties (same ms timestamp) may skip a doc across pages,
          // but the next enrichment pass self-heals via the crowdstrike_detected != true filter.
          sort: [{ 'routing.event_time': 'desc' }],
          ...(searchAfter ? { search_after: searchAfter } : {}),
        } as any);
      } catch (err) {
        result.errors.push(`scan: ${this.errMsg(err)}`);
        break;
      }

      const hits = ((scanResponse as any).hits?.hits ?? []) as any[];
      if (hits.length === 0) break;
      result.scanned += hits.length;
      result.batches += 1;

      // 2. Build msearch body. For each scanned hit, queue TWO sub-queries:
      //    a wide bundle-level query (drives f0rtika.crowdstrike_detected) and
      //    a narrow stage-specific query (drives f0rtika.crowdstrike_stage_detected).
      //    The wide query matches any alert with bundle UUID in evidence; the
      //    narrow query requires the SPECIFIC stage binary
      //    (`<uuid>-<control_id>[-<variant>].exe`) to appear in evidence_filenames.
      //    Building both in the same msearch keeps round-trips at 1 per batch.
      type SubQuery = { kind: 'wide' | 'stage'; hit: any; body: Record<string, unknown>; bundleUuid: string; controlId: string };
      const queries: SubQuery[] = [];
      for (const hit of hits) {
        const src = hit._source?.f0rtika ?? {};
        const routing = hit._source?.routing ?? {};
        const testUuid = src.test_uuid ?? '';
        const wideQuery = this.evidenceQueries.wide({
          test_uuid: testUuid,
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
          bundle_name: src.bundle_name,
        });
        const stageQuery = this.evidenceQueries.stage({
          test_uuid: testUuid,
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
          control_id: src.control_id ?? '',
        });
        if (!wideQuery && !stageQuery) {
          // No usable query at all (probably malformed input).
          result.skipped += 1;
          continue;
        }
        const bundleUuid = extractBundleUuid(testUuid);
        const controlId = String(src.control_id ?? '');
        if (wideQuery)  queries.push({ kind: 'wide',  hit, body: wideQuery,  bundleUuid, controlId });
        if (stageQuery) queries.push({ kind: 'stage', hit, body: stageQuery, bundleUuid, controlId });
      }

      // 3. Execute msearch. size=EVIDENCE_HITS_PER_SUBQUERY so we get back the
      //    matched alert _ids (needed for the alert-side correlation update)
      //    and can classify each alert. _source carries only what the flags
      //    need (prevention_action + the multi-test evidence fields).
      if (queries.length > 0) {
        const searches: unknown[] = [];
        for (const q of queries) {
          searches.push({ index: this.target.alertIndex });
          const source = this.target.ignoreAchillesMitigated
            ? ['prevention_action', ...ACHILLES_MITIGATION_FIELDS, 'f0rtika.achilles_correlated', ...MULTI_TEST_EVIDENCE_FIELDS, ...ACTION_TIME_FIELDS]
            : ['prevention_action', 'f0rtika.achilles_correlated', ...MULTI_TEST_EVIDENCE_FIELDS, ...ACTION_TIME_FIELDS];
          // On a stage that exited 101, only actions taken before the run
          // ended count (preventionTiming.ts).
          const cutoff = this.inRunCutoffFor(q.hit);
          const preventionFilter = this.target.ignoreAchillesMitigated
            ? { bool: { must_not: [ACHILLES_MITIGATED_QUERY], filter: [actedInRunClause(cutoff)] } }
            : actedInRunClause(cutoff);
          searches.push({
            size: EVIDENCE_HITS_PER_SUBQUERY,
            _source: source,
            query: q.body,
            // Every matching alert's action, not just the hits returned: a
            // stage with many alerts (a LOLBin storm) can have its one
            // kill / quarantine outside the first EVIDENCE_HITS_PER_SUBQUERY.
            aggs: {
              prevention: {
                filter: preventionFilter,
                aggs: { actions: { terms: { field: 'prevention_action', size: PREVENTION_ACTION_BUCKETS } } },
              },
            },
          });
        }

        let msearchResponse;
        try {
          msearchResponse = await this.client.msearch({ searches } as any);
        } catch (err) {
          result.errors.push(`msearch: ${this.errMsg(err)}`);
          searchAfter = hits[hits.length - 1].sort;
          if (hits.length < batchSize) break;
          continue;
        }

        // 4. Collapse the two sub-responses per hit into a single update spec.
        //    Indexed by hit._id; tracks which flag(s) need flipping and the
        //    union of matched alert IDs (the wide query is a superset of the
        //    stage query, so alerts from the stage match are typically a
        //    subset — union keeps the alert-side update authoritative either
        //    way).
        interface PerHitUpdate {
          hit: any;
          bundleUuid: string;
          wideMatched: boolean;
          stageMatched: boolean;
          alertIds: Set<string>;
          /** Confirmed actions of alerts naming THIS stage's binary (stage query). */
          stageActions: string[];
          /** Qualifying confirmed actions of bundle-wide matches. */
          wideActions: string[];
          /** Matched alerts already achilles_correlated. */
          correlatedAlertIds: Set<string>;
          /** The stage sub-query ran and answered this pass. */
          stageQueried: boolean;
          /** Alerts the stage query matched, and how many of them count for this stage. */
          stageHitsAll: number;
          stageHitsSingle: number;
          /** The wide sub-query ran and answered this pass. */
          wideQueried: boolean;
          /** Alerts the wide query matched, and how many of them count for this test. */
          wideHitsAll: number;
          wideHitsCounting: number;
        }
        const emptyUpdate = (hit: any, bundleUuid: string): PerHitUpdate => ({
          hit, bundleUuid, wideMatched: false, stageMatched: false, alertIds: new Set(), stageActions: [], wideActions: [],
          correlatedAlertIds: new Set(), stageQueried: false, stageHitsAll: 0, stageHitsSingle: 0,
          wideQueried: false, wideHitsAll: 0, wideHitsCounting: 0,
        });
        const updatesByHitId = new Map<string, PerHitUpdate>();
        const responses = (msearchResponse as any).responses ?? [];
        for (let i = 0; i < queries.length; i++) {
          const resp = responses[i];
          const q = queries[i];
          if (!resp) continue;
          if (resp.error) {
            result.errors.push(`msearch[${i}/${q.kind}]: ${JSON.stringify(resp.error).slice(0, 200)}`);
            continue;
          }
          const total = typeof resp.hits?.total === 'number'
            ? resp.hits.total
            : resp.hits?.total?.value ?? 0;
          const hitId = q.hit._id as string;
          let entry = updatesByHitId.get(hitId);
          if (!entry) {
            entry = emptyUpdate(q.hit, q.bundleUuid);
            updatesByHitId.set(hitId, entry);
          }
          if (q.kind === 'stage') entry.stageQueried = true;
          else entry.wideQueried = true;
          if (total === 0) continue;

          const allHits = (resp.hits?.hits ?? []) as any[];
          // Which alerts count (multiTestEvidence.ts): a single-test alert
          // always; a multi-test one only through the vendor's verdict on this
          // stage's binary (stage query) or on any of this test's files (wide).
          const mine = q.kind === 'stage'
            ? (f: string) => isStageFile(f, q.bundleUuid, q.controlId)
            : (f: string) => isTestFile(f, q.bundleUuid);
          // A stage takes only its own file's actions (and its child
          // processes') where the alert records them per evidence item.
          const credited = allHits
            .map((h) => ({ h, credit: alertCredit(h._source ?? {}, mine, { ownActionsOnly: q.kind === 'stage' }) }))
            .filter((c) => c.credit.counts);
          const cutoff = this.inRunCutoffFor(q.hit);
          const alertHits = credited.map((c) => c.h);
          // Alerts beyond the hits read can't be classified: they count, as
          // every match did before the multi-test rules.
          const unread = Math.max(0, total - allHits.length);
          const counting = alertHits.length + unread;
          if (q.kind === 'stage') {
            entry.stageHitsAll += allHits.length + unread;
            entry.stageHitsSingle += counting;
          } else {
            entry.wideHitsAll += allHits.length + unread;
            entry.wideHitsCounting += counting;
          }
          const alertIds = allHits
            .map((h) => h._id)
            .filter((id): id is string => typeof id === 'string');
          // Prevention-flag qualification rule (docs/edr-prevention-action-detection.md):
          //   - stage matches always qualify — the alert names this stage's own binary;
          //   - wide/bundle matches qualify only when this stage did NOT reach a
          //     conclusive outcome (101 executed; 105/126/127 policy-prevented) —
          //     a sibling stage that ran to completion was not prevented by the
          //     alert that killed a later stage (prod: Falcon killed T1486 while
          //     stages 1–4 had already exited 101).
          // A multi-test alert brings its credited files' own actions, never
          // the alert-wide one (one file blocked, another only detected).
          // On an exit-101 stage, an action after the run ended is cleanup, not prevention.
          const hitActions = credited
            .filter((c) => !(this.target.ignoreAchillesMitigated && isAchillesMitigated(c.h._source)))
            .filter((c) => actedInRun(c.h._source ?? {}, cutoff))
            .flatMap((c) => c.credit.actions ?? [c.h._source?.prevention_action]);
          // The aggregation can't tell multi-test alerts apart: it is used
          // only when more alerts matched than the query could read.
          const aggUsable = total > allHits.length;
          const aggActions = aggUsable ? ((resp.aggregations?.prevention?.actions?.buckets ?? []) as any[]).map((b) => b.key) : [];
          const preventionActions = [...new Set([...hitActions, ...aggActions])]
            .filter((a): a is string => typeof a === 'string' && PREVENTION_ACTIONS.has(a));

          const docErrorCode = q.hit._source?.event?.ERROR as number | undefined;
          const preventionQualifies = q.kind === 'stage'
            || docErrorCode === undefined
            || !CONCLUSIVE_OUTCOME_CODES.has(docErrorCode);

          if (!entry.bundleUuid) entry.bundleUuid = q.bundleUuid;
          if (q.kind === 'wide' && counting > 0) entry.wideMatched = true;
          if (q.kind === 'stage' && counting > 0) entry.stageMatched = true;
          for (const id of alertIds) entry.alertIds.add(id);
          for (const h of allHits) if (typeof h._id === 'string' && h._source?.f0rtika?.achilles_correlated === true) entry.correlatedAlertIds.add(h._id);
          if (q.kind === 'stage') entry.stageActions.push(...preventionActions);
          else if (preventionQualifies) entry.wideActions.push(...preventionActions);
        }
        // Scanned docs nothing matched still get an entry, so an older stage
        // can be settled below instead of staying eligible every pass.
        for (const hit of hits) {
          if (!updatesByHitId.has(hit._id)) updatesByHitId.set(hit._id, emptyUpdate(hit, ''));
        }

        // 5. Bulk update matched docs.
        //    - Test-doc update: flip f0rtika.crowdstrike_detected when the wide
        //      query matched, and/or f0rtika.crowdstrike_stage_detected when the
        //      stage query matched. A doc that already has crowdstrike_detected
        //      from a prior pass but is now stage-matchable will be re-found
        //      via the eligibility query (which checks for missing stage
        //      flag) and get its stage flag set on this pass.
        //    - Alert-doc update(s): write f0rtika.achilles_correlated + test_uuid + matched_at.
        //      Alert updates are deduplicated per batch — if two test docs
        //      in the same batch match the same alert, we emit only one
        //      alert-side update (the first). The second is implicitly a
        //      no-op; subsequent passes self-heal if the first failed.
        if (updatesByHitId.size > 0) {
          const operations: unknown[] = [];
          const testOpMeta: Array<{ kind: 'test' | 'alert'; alertId?: string; wide: boolean; stage: boolean }> = [];
          const alertIdsEmitted = new Set<string>();
          const matchedAt = new Date().toISOString();

          for (const u of updatesByHitId.values()) {
            // Test-doc update: only set the fields that flipped to true.
            const f0rtika: Record<string, unknown> = {};
            const v = this.target.flagPrefix;
            // A doc already flagged by an earlier pass only gets the flags it
            // lacks (so an unchanged doc is never re-written).
            const existing = u.hit._source?.f0rtika ?? {};
            const recheck = existing[`${v}_detected`] === true;
            const wide = u.wideMatched && existing[`${v}_detected`] !== true;
            const stage = u.stageMatched && existing[`${v}_stage_detected`] !== true;
            if (wide)  f0rtika[`${v}_detected`]       = true;
            if (stage) f0rtika[`${v}_stage_detected`] = true;
            // Vendor-confirmed prevention — rides alongside the detected flags.
            // The actions are already qualification-filtered above (stage
            // matches always; wide matches only for non-conclusive docs), and
            // the stage's own action is preferred over a wide one.
            // Prevention ⊆ detection: a prevention flag implies a matched alert.
            const actions = [...u.stageActions, ...u.wideActions];
            if (actions.length > 0 && existing[`${v}_prevented`] !== true) {
              f0rtika[`${v}_prevented`] = true;
              f0rtika[`${v}_prevention_action`] = actions[0];
            }
            // Provenance: did an alert naming THIS stage's binary carry the
            // action? Decided only when the stage query matched this pass (a
            // stage whose alerts are gone keeps what it has). Only ever
            // upgrades; false marks "evaluated" so the doc leaves the
            // backfill clause of the eligibility query.
            if (u.stageMatched) {
              if (u.stageActions.length > 0) {
                if (existing[`${v}_stage_prevented`] !== true) {
                  f0rtika[`${v}_stage_prevented`] = true;
                  const current = f0rtika[`${v}_prevention_action`] ?? existing[`${v}_prevention_action`];
                  if (current !== u.stageActions[0]) f0rtika[`${v}_prevention_action`] = u.stageActions[0];
                }
              } else if (existing[`${v}_stage_prevented`] === undefined) {
                f0rtika[`${v}_stage_prevented`] = false;
              }
            } else if (
              existing[`${v}_stage_detected`] === true
              && existing[`${v}_stage_prevented`] === undefined
              && existing[`${v}_prevention_action`] === undefined
            ) {
              // An older stage whose alerts no longer match (e.g. a Defender
              // alert resolved since): with no action on record there is
              // nothing to lose, so settle it. One that has an action keeps the
              // older rule rather than being downgraded without evidence.
              f0rtika[`${v}_stage_prevented`] = false;
            }
            // Single-test stage rule (multiTestEvidence.ts). A stage stored
            // under the older rule is checked once: when its stage alerts are
            // still in the index and every one names several tests, it was
            // only ever credited by alerts listing leftover binaries, so its
            // stage flags go (and, on a conclusive exit, its prevention, which
            // there can only have come from the stage match). No visible
            // stage alerts (aged out): nothing is downgraded.
            if (u.stageQueried && existing[`${v}_stage_rule`] !== STAGE_RULE) {
              const wasStage = existing[`${v}_stage_detected`] === true;
              if (wasStage && u.stageHitsAll > 0 && u.stageHitsSingle === 0) {
                f0rtika[`${v}_stage_detected`] = false;
                f0rtika[`${v}_stage_prevented`] = false;
                const code = u.hit._source?.event?.ERROR as number | undefined;
                if (code !== undefined && CONCLUSIVE_OUTCOME_CODES.has(code)) {
                  f0rtika[`${v}_prevented`] = false;
                  f0rtika[`${v}_prevention_action`] = null;
                }
              }
              if (wasStage || u.stageMatched) f0rtika[`${v}_stage_rule`] = STAGE_RULE;
            }
            // Per-file verdict rule at test level (multiTestEvidence.ts). A doc
            // detected under the older rule is checked once: when its alerts are
            // still in the index and none counts for this test (each one a
            // multi-test listing), it loses `_detected`, and its prevention
            // too unless the stage itself stays detected. No visible alerts
            // (aged out): nothing is downgraded.
            if (u.wideQueried && existing[`${v}_evidence_rule`] !== EVIDENCE_RULE) {
              const wasWide = existing[`${v}_detected`] === true;
              if (wasWide && u.wideHitsAll > 0 && u.wideHitsCounting === 0) {
                f0rtika[`${v}_detected`] = false;
                const stageAfter = (f0rtika[`${v}_stage_detected`] ?? existing[`${v}_stage_detected`]) === true;
                if (!stageAfter) {
                  f0rtika[`${v}_prevented`] = false;
                  f0rtika[`${v}_prevention_action`] = null;
                }
              }
              if (wasWide || u.wideMatched) f0rtika[`${v}_evidence_rule`] = EVIDENCE_RULE;
            }
            // In-run prevention rules (PREVENTION_RULE). A doc prevented under
            // the older rules is checked once: when its alerts are still in the
            // index and no action now qualifies (taken after the run, or on
            // another file), the prevention flags go; detection stays. No
            // visible alerts (aged out): nothing is downgraded.
            if ((u.stageQueried || u.wideQueried) && existing[`${v}_prevention_rule`] !== PREVENTION_RULE) {
              const now = (k: string) => (k in f0rtika ? f0rtika[k] : existing[k]);
              const wasPrevented = now(`${v}_prevented`) === true;
              const wasStagePrevented = now(`${v}_stage_prevented`) === true;
              const qualifying = [...u.stageActions, ...u.wideActions];
              const recheckable = existing[`${v}_prevented`] === true || existing[`${v}_stage_prevented`] === true;
              if (recheckable) {
                if (wasStagePrevented && u.stageQueried && u.stageHitsAll > 0 && u.stageActions.length === 0) {
                  f0rtika[`${v}_stage_prevented`] = false;
                }
                // `_prevented` comes from the stage's alerts on a conclusive
                // exit, else from the test-level ones too: those must be visible.
                const code = u.hit._source?.event?.ERROR as number | undefined;
                const conclusive = code !== undefined && CONCLUSIVE_OUTCOME_CODES.has(code);
                const sourceVisible = conclusive ? u.stageHitsAll > 0 : u.wideHitsAll > 0;
                if (wasPrevented && sourceVisible) {
                  if (qualifying.length === 0) {
                    f0rtika[`${v}_prevented`] = false;
                    f0rtika[`${v}_prevention_action`] = null;
                  } else if (!qualifying.includes(String(now(`${v}_prevention_action`)))) {
                    f0rtika[`${v}_prevention_action`] = qualifying[0];
                  }
                }
              }
              if (recheckable || qualifying.length > 0) f0rtika[`${v}_prevention_rule`] = PREVENTION_RULE;
            }
            if (Object.keys(f0rtika).length > 0) {
              operations.push({ update: { _index: u.hit._index, _id: u.hit._id } });
              operations.push({ doc: { f0rtika } });
              testOpMeta.push({ kind: 'test', wide, stage });
            }

            // Alert-doc updates (dedup per batch)
            for (const alertId of u.alertIds) {
              if (alertIdsEmitted.has(alertId)) continue;
              // A re-checked doc never re-stamps an alert that is already correlated.
              if (recheck && u.correlatedAlertIds.has(alertId)) continue;
              alertIdsEmitted.add(alertId);
              operations.push({ update: { _index: this.target.alertIndex, _id: alertId } });
              operations.push({
                doc: {
                  f0rtika: {
                    achilles_correlated: true,
                    achilles_test_uuid: u.bundleUuid,
                    achilles_matched_at: matchedAt,
                  },
                },
              });
              testOpMeta.push({ kind: 'alert', alertId, wide: false, stage: false });
            }
          }

          // Nothing to write when every matched doc was re-checked unchanged.
          if (operations.length > 0) {
            try {
              const bulkResponse = await this.client.bulk({ operations } as any);
              const items = (bulkResponse as any).items ?? [];
              for (let i = 0; i < items.length; i++) {
                const item = items[i]?.update;
                const meta = testOpMeta[i];
                if (item?.error) {
                  result.errors.push(`bulk[${i}]: ${item.error.reason ?? 'unknown'}`);
                  continue;
                }
                if (meta?.kind === 'test') {
                  if (meta.wide)  result.detected += 1;
                  if (meta.stage) result.stageDetected += 1;
                } else if (meta?.kind === 'alert') {
                  result.alertsMarkedCorrelated += 1;
                }
              }
            } catch (err) {
              result.errors.push(`bulk: ${this.errMsg(err)}`);
            }
          }
        }
      }

      // Prepare for next iteration
      searchAfter = hits[hits.length - 1].sort;
      if (hits.length < batchSize) break;
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  private buildEligibilityQuery(lookbackDays: number): Record<string, unknown> {
    // A doc is eligible if EITHER flag is unset (or false). This serves two
    // populations in one query:
    //   - New docs: neither flag is set → both queries run, both flags get
    //     considered.
    //   - Backfill docs from before the stage-specific flag existed: have
    //     crowdstrike_detected: true but no crowdstrike_stage_detected. We
    //     re-evaluate the stage query (the wide one is a no-op because that
    //     flag is already true; bulk update only flips the missing field).
    //
    // Docs where both flags are already true (or where the stage flag is true
    // but the wide is false, which can't legitimately happen) are excluded.
    const missingFlag = (field: string) => ({
      bool: { must_not: [{ term: { [field]: true } }] },
    });
    const v = this.target.flagPrefix;
    const eligible: Record<string, unknown>[] = [
      missingFlag(`f0rtika.${v}_detected`),
      missingFlag(`f0rtika.${v}_stage_detected`),
    ];
    // Late prevention (see recheckUnpreventedHours): a recent stage its own
    // alerts haven't proven prevented yet.
    eligible.push({
      bool: {
        filter: [
          { term: { [`f0rtika.${v}_stage_detected`]: true } },
          { range: { 'routing.event_time': { gte: `now-${this.recheckHours}h` } } },
        ],
        must_not: [{ term: { [`f0rtika.${v}_stage_prevented`]: true } }],
      },
    });
    // Per-file verdict rule: a doc detected before it is checked once.
    eligible.push({
      bool: {
        filter: [{ term: { [`f0rtika.${v}_detected`]: true } }],
        must_not: [{ term: { [`f0rtika.${v}_evidence_rule`]: EVIDENCE_RULE } }],
      },
    });
    // In-run prevention rules: a doc prevented before them is checked once.
    eligible.push({
      bool: {
        should: [
          { term: { [`f0rtika.${v}_prevented`]: true } },
          { term: { [`f0rtika.${v}_stage_prevented`]: true } },
        ],
        minimum_should_match: 1,
        must_not: [{ term: { [`f0rtika.${v}_prevention_rule`]: PREVENTION_RULE } }],
      },
    });
    // Single-test stage rule: a stage flagged before it is checked once.
    eligible.push({
      bool: {
        filter: [{ term: { [`f0rtika.${v}_stage_detected`]: true } }],
        must_not: [{ term: { [`f0rtika.${v}_stage_rule`]: STAGE_RULE } }],
      },
    });
    // Provenance backfill: a stage flagged before `_stage_prevented` existed
    // is evaluated once (it also picks up actions that arrived late).
    eligible.push({
      bool: {
        filter: [{ term: { [`f0rtika.${v}_stage_detected`]: true } }],
        must_not: [{ exists: { field: `f0rtika.${v}_stage_prevented` } }],
      },
    });
    return {
      bool: {
        filter: [
          { range: { 'routing.event_time': { gte: `now-${lookbackDays}d` } } },
          ...enrichmentEligibleClauses(),
          {
            bool: {
              should: eligible,
              minimum_should_match: 1,
            },
          },
        ],
      },
    };
  }

  /**
   * The in-run cut-off for a result that exited 101 (it ran to completion, so
   * calling it Prevented needs an action taken during the run), else null (no
   * gate). An error-coded stage keeps every action: the error itself fits the
   * EDR having stopped it, and Defender keeps adding later activity to an
   * alert for hours, so its last activity is no bound there.
   */
  private inRunCutoffFor(hit: any): number | null {
    return hit._source?.event?.ERROR === 101 ? inRunCutoff(hit._source?.routing?.event_time) : null;
  }

  private get recheckHours(): number {
    return this.target.recheckUnpreventedHours ?? DEFAULT_RECHECK_UNPREVENTED_HOURS;
  }

  private get evidenceQueries(): EvidenceQueryBuilders {
    return this.target.evidenceQueries ?? { wide: buildCrowdStrikeEvidenceQuery, stage: buildStageCrowdStrikeEvidenceQuery };
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
