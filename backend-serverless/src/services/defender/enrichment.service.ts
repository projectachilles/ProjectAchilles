import type { Client } from '@elastic/elasticsearch';
import {
  buildDefenderEvidenceQuery,
  buildStageDefenderEvidenceQuery,
  extractBundleUuid,
} from './evidence-correlation.js';
import { DEFENDER_INDEX } from './index-management.js';
import type { EnrichmentPassOptions, EnrichmentPassResult } from '../../types/defender.js';
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
// stage-binary matches may. See docs/defender-prevention-action-detection.md.
const CONCLUSIVE_OUTCOME_CODES = new Set([101, 105, 126, 127]);

/**
 * Cap on the number of alert hits we pull back per sub-query. A single test
 * doc rarely matches more than a handful of Defender alerts; this bound both
 * protects the request shape and deduplicates naturally when a bundle's
 * stages all hit the same orchestrator alert.
 */
const ALERT_HITS_PER_SUBQUERY = 5;

/**
 * Prevention actions that count as vendor-confirmed PREVENTION (vs.
 * detection-only). Derived from evidence[].remediationStatus at sync time —
 * see docs/defender-prevention-action-detection.md.
 */
const PREVENTION_ACTIONS = new Set(['quarantined', 'process_killed', 'blocked']);

export class DefenderEnrichmentService {
  constructor(
    private readonly client: Client,
    private readonly resultsIndexPattern: string,
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
          // but the next enrichment pass self-heals via the defender_detected != true filter.
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

      // 2. Build msearch body. Two sub-queries per scanned hit: wide bundle
      //    (drives defender_detected) and narrow stage-binary (drives
      //    defender_stage_detected). See backend mirror for full rationale.
      type SubQuery = { kind: 'wide' | 'stage'; hit: any; body: Record<string, unknown>; bundleUuid: string };
      const queries: SubQuery[] = [];
      for (const hit of hits) {
        const src = hit._source?.f0rtika ?? {};
        const routing = hit._source?.routing ?? {};
        const testUuid = src.test_uuid ?? '';
        const wideQuery = buildDefenderEvidenceQuery({
          test_uuid: testUuid,
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
          bundle_name: src.bundle_name,
        });
        const stageQuery = buildStageDefenderEvidenceQuery({
          test_uuid: testUuid,
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
          control_id: src.control_id ?? '',
        });
        if (!wideQuery && !stageQuery) {
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
      //    test doc's defender_prevented flags without pulling full docs.
      if (queries.length > 0) {
        const searches: unknown[] = [];
        for (const q of queries) {
          searches.push({ index: DEFENDER_INDEX });
          searches.push({ size: ALERT_HITS_PER_SUBQUERY, _source: ['prevention_action'], query: q.body });
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
          // Prevention-flag qualification rule (docs/defender-prevention-action-detection.md):
          // stage matches always qualify; wide/bundle matches qualify only
          // when this stage did NOT reach a conclusive outcome.
          const preventionActions = alertHits
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
          // Exit 101 means the stage ran to completion: never prevented, whatever the alert says.
          const stageCompleted = Number(q.hit._source?.event?.ERROR) === 101;
          if (preventionQualifies && !stageCompleted) entry.preventionActions.push(...preventionActions);
        }

        // 5. Bulk update matched docs — test-doc flag(s) + alert-side flags.
        //    Alert-side writes are deduplicated per batch.
        if (updatesByHitId.size > 0) {
          const operations: unknown[] = [];
          const testOpMeta: Array<{ kind: 'test' | 'alert'; alertId?: string; wide: boolean; stage: boolean }> = [];
          const alertIdsEmitted = new Set<string>();
          const matchedAt = new Date().toISOString();

          for (const u of updatesByHitId.values()) {
            const f0rtika: Record<string, unknown> = {};
            if (u.wideMatched)  f0rtika.defender_detected       = true;
            if (u.stageMatched) f0rtika.defender_stage_detected = true;
            // Vendor-confirmed prevention — rides alongside the detected
            // flags (already qualification-filtered above).
            if (u.preventionActions.length > 0) {
              f0rtika.defender_prevented = true;
              f0rtika.defender_prevention_action = u.preventionActions[0];
            }
            operations.push({ update: { _index: u.hit._index, _id: u.hit._id } });
            operations.push({ doc: { f0rtika } });
            testOpMeta.push({ kind: 'test', wide: u.wideMatched, stage: u.stageMatched });

            for (const alertId of u.alertIds) {
              if (alertIdsEmitted.has(alertId)) continue;
              alertIdsEmitted.add(alertId);
              operations.push({ update: { _index: DEFENDER_INDEX, _id: alertId } });
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
    // Match docs missing EITHER flag — covers new docs and backfill of
    // pre-stage-flag docs that already have defender_detected:true but no
    // defender_stage_detected.
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
                missingFlag('f0rtika.defender_detected'),
                missingFlag('f0rtika.defender_stage_detected'),
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
