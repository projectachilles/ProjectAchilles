import type { Client } from '@elastic/elasticsearch';
import {
  buildDefenderEvidenceQuery,
  buildStageDefenderEvidenceQuery,
  extractBundleUuid,
} from './evidence-correlation.js';
import { DEFENDER_INDEX } from './index-management.js';
import type { EnrichmentPassOptions, EnrichmentPassResult } from '../../types/defender.js';

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_DURATION_MS = 60_000;
const CONCLUSIVE_ERROR_CODES = [101, 105, 126, 127];

/**
 * Cap on the number of alert hits we pull back per sub-query. A single test
 * doc rarely matches more than a handful of Defender alerts; this bound both
 * protects the request shape and deduplicates naturally when a bundle's
 * stages all hit the same orchestrator alert.
 */
const ALERT_HITS_PER_SUBQUERY = 5;

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

      // 2. Build msearch body. For each scanned hit, queue TWO sub-queries:
      //    a wide bundle-level query (drives f0rtika.defender_detected) and
      //    a narrow stage-specific query (drives f0rtika.defender_stage_detected).
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
      if (queries.length > 0) {
        const searches: unknown[] = [];
        for (const q of queries) {
          searches.push({ index: DEFENDER_INDEX });
          searches.push({ size: ALERT_HITS_PER_SUBQUERY, _source: false, query: q.body });
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

          const hitId = q.hit._id as string;
          let entry = updatesByHitId.get(hitId);
          if (!entry) {
            entry = { hit: q.hit, bundleUuid: q.bundleUuid, wideMatched: false, stageMatched: false, alertIds: new Set() };
            updatesByHitId.set(hitId, entry);
          }
          if (q.kind === 'wide')  entry.wideMatched = true;
          if (q.kind === 'stage') entry.stageMatched = true;
          for (const id of alertIds) entry.alertIds.add(id);
        }

        // 5. Bulk update matched docs.
        //    - Test-doc update: flip f0rtika.defender_detected when the wide
        //      query matched, and/or f0rtika.defender_stage_detected when the
        //      stage query matched. A doc that already has defender_detected
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
            if (u.wideMatched)  f0rtika.defender_detected       = true;
            if (u.stageMatched) f0rtika.defender_stage_detected = true;
            operations.push({ update: { _index: u.hit._index, _id: u.hit._id } });
            operations.push({ doc: { f0rtika } });
            testOpMeta.push({ kind: 'test', wide: u.wideMatched, stage: u.stageMatched });

            // Alert-doc updates (dedup per batch)
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
    // A doc is eligible if EITHER flag is unset (or false). This serves two
    // populations in one query:
    //   - New docs: neither flag is set → both queries run, both flags get
    //     considered.
    //   - Backfill docs from before the stage-specific flag existed: have
    //     defender_detected: true but no defender_stage_detected. We re-evaluate
    //     the stage query (the wide one is a no-op because that flag is
    //     already true; bulk update only flips the missing field).
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
          { terms: { 'event.ERROR': CONCLUSIVE_ERROR_CODES } },
          { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } },
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
