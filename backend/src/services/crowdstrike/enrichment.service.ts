import type { Client } from '@elastic/elasticsearch';
import {
  buildCrowdStrikeEvidenceQuery,
  buildStageCrowdStrikeEvidenceQuery,
  extractBundleUuid,
} from './evidence-correlation.js';
import { CROWDSTRIKE_INDEX } from './index-management.js';
import type { EnrichmentPassOptions, EnrichmentPassResult } from '../../types/crowdstrike.js';
import { isAchillesMitigated, ACHILLES_MITIGATION_FIELDS } from '../shared/achillesMitigation.js';
import { enrichmentEligibleClauses } from '../analytics/enrichment-eligibility.js';

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
 * Cap on the number of alert hits we pull back per sub-query. A single test
 * doc rarely matches more than a handful of CrowdStrike alerts; this bound
 * both protects the request shape and deduplicates naturally when a bundle's
 * stages all hit the same orchestrator alert.
 */
const ALERT_HITS_PER_SUBQUERY = 5;

/**
 * Prevention actions that count as vendor-confirmed PREVENTION (vs.
 * detection-only). Derived from pattern_disposition_details at sync time —
 * see docs/edr-prevention-action-detection.md. 'kill_failed' is deliberately
 * NOT here: a failed kill is not prevention.
 */
const PREVENTION_ACTIONS = new Set(['quarantined', 'process_killed', 'blocked']);

/**
 * Which vendor's alert index to read and which `f0rtika.<vendor>_*` flags to
 * write. Defaults to CrowdStrike; SentinelOne reuses the same pass because its
 * normalized alert docs share the evidence_* / prevention_action shape.
 */
export interface EnrichmentVendorTarget {
  alertIndex: string;
  flagPrefix: 'crowdstrike' | 'sentinelone';
  /**
   * Ignore the prevention action of alerts that ProjectAchilles itself
   * mitigated (SentinelOne automatic mitigation writes an
   * `f0rtika.auto_mitigated` receipt). Our own kill / quarantine is not the
   * EDR preventing the test, so it must never turn into `<vendor>_prevented`.
   */
  ignoreAchillesMitigated?: boolean;
}

const CROWDSTRIKE_TARGET: EnrichmentVendorTarget = { alertIndex: CROWDSTRIKE_INDEX, flagPrefix: 'crowdstrike' };

export class CrowdStrikeEnrichmentService {
  constructor(
    private readonly client: Client,
    private readonly resultsIndexPattern: string,
    private readonly target: EnrichmentVendorTarget = CROWDSTRIKE_TARGET,
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
      type SubQuery = { kind: 'wide' | 'stage'; hit: any; body: Record<string, unknown>; bundleUuid: string };
      const queries: SubQuery[] = [];
      for (const hit of hits) {
        const src = hit._source?.f0rtika ?? {};
        const routing = hit._source?.routing ?? {};
        const testUuid = src.test_uuid ?? '';
        const wideQuery = buildCrowdStrikeEvidenceQuery({
          test_uuid: testUuid,
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
          bundle_name: src.bundle_name,
        });
        const stageQuery = buildStageCrowdStrikeEvidenceQuery({
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
        if (wideQuery)  queries.push({ kind: 'wide',  hit, body: wideQuery,  bundleUuid });
        if (stageQuery) queries.push({ kind: 'stage', hit, body: stageQuery, bundleUuid });
      }

      // 3. Execute msearch. size=ALERT_HITS_PER_SUBQUERY so we get back the
      //    matched alert _ids (needed for the alert-side correlation update).
      //    _source carries only prevention_action — just enough to flip the
      //    test doc's crowdstrike_prevented flags without pulling full docs.
      if (queries.length > 0) {
        const searches: unknown[] = [];
        for (const q of queries) {
          searches.push({ index: this.target.alertIndex });
          const source = this.target.ignoreAchillesMitigated
            ? ['prevention_action', ...ACHILLES_MITIGATION_FIELDS]
            : ['prevention_action'];
          searches.push({ size: ALERT_HITS_PER_SUBQUERY, _source: source, query: q.body });
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
          /** Qualifying prevention actions from matched alerts (first one wins on the test doc). */
          preventionActions: string[];
        }
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
          if (total === 0) continue;

          const alertHits = (resp.hits?.hits ?? []) as any[];
          const alertIds = alertHits
            .map((h) => h._id)
            .filter((id): id is string => typeof id === 'string');
          // Prevention-flag qualification rule (docs/edr-prevention-action-detection.md):
          //   - stage matches always qualify — the alert names this stage's own binary;
          //   - wide/bundle matches qualify only when this stage did NOT reach a
          //     conclusive outcome (101 executed; 105/126/127 policy-prevented) —
          //     a sibling stage that ran to completion was not prevented by the
          //     alert that killed a later stage (prod: Falcon killed T1486 while
          //     stages 1–4 had already exited 101).
          const preventionActions = alertHits
            .filter((h) => !(this.target.ignoreAchillesMitigated && isAchillesMitigated(h._source)))
            .map((h) => h._source?.prevention_action)
            .filter((a): a is string => typeof a === 'string' && PREVENTION_ACTIONS.has(a));

          const docErrorCode = q.hit._source?.event?.ERROR as number | undefined;
          const preventionQualifies = q.kind === 'stage'
            || docErrorCode === undefined
            || !CONCLUSIVE_OUTCOME_CODES.has(docErrorCode);

          const hitId = q.hit._id as string;
          let entry = updatesByHitId.get(hitId);
          if (!entry) {
            entry = { hit: q.hit, bundleUuid: q.bundleUuid, wideMatched: false, stageMatched: false, alertIds: new Set(), preventionActions: [] };
            updatesByHitId.set(hitId, entry);
          }
          if (q.kind === 'wide')  entry.wideMatched = true;
          if (q.kind === 'stage') entry.stageMatched = true;
          for (const id of alertIds) entry.alertIds.add(id);
          if (preventionQualifies) entry.preventionActions.push(...preventionActions);
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
            if (u.wideMatched)  f0rtika[`${v}_detected`]       = true;
            if (u.stageMatched) f0rtika[`${v}_stage_detected`] = true;
            // Vendor-confirmed prevention — rides alongside the detected flags.
            // preventionActions is already qualification-filtered above
            // (stage matches always; wide matches only for non-conclusive docs).
            // Prevention ⊆ detection: a prevention flag implies a matched alert.
            if (u.preventionActions.length > 0) {
              f0rtika[`${v}_prevented`] = true;
              f0rtika[`${v}_prevention_action`] = u.preventionActions[0];
            }
            operations.push({ update: { _index: u.hit._index, _id: u.hit._id } });
            operations.push({ doc: { f0rtika } });
            testOpMeta.push({ kind: 'test', wide: u.wideMatched, stage: u.stageMatched });

            // Alert-doc updates (dedup per batch)
            for (const alertId of u.alertIds) {
              if (alertIdsEmitted.has(alertId)) continue;
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
    return {
      bool: {
        filter: [
          { range: { 'routing.event_time': { gte: `now-${lookbackDays}d` } } },
          ...enrichmentEligibleClauses(),
          {
            bool: {
              should: [
                missingFlag(`f0rtika.${this.target.flagPrefix}_detected`),
                missingFlag(`f0rtika.${this.target.flagPrefix}_stage_detected`),
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    };
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
