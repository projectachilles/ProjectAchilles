import type { Client } from '@elastic/elasticsearch';
import { buildDefenderEvidenceQuery, extractBundleUuid } from './evidence-correlation.js';
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

      // 2. Build msearch body, skipping docs where helper returns null.
      //    Remember the bundle UUID per queried test so we can write it back
      //    to each matched alert's f0rtika.achilles_test_uuid in step 5.
      const queries: Array<{ hit: any; body: Record<string, unknown>; bundleUuid: string }> = [];
      for (const hit of hits) {
        const src = hit._source?.f0rtika ?? {};
        const routing = hit._source?.routing ?? {};
        const testUuid = src.test_uuid ?? '';
        const query = buildDefenderEvidenceQuery({
          test_uuid: testUuid,
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
          bundle_name: src.bundle_name,
        });
        if (!query) {
          result.skipped += 1;
          continue;
        }
        queries.push({ hit, body: query, bundleUuid: extractBundleUuid(testUuid) });
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

        // 4. Collect matched test docs along with the alert _ids that matched
        //    them. Each entry is one test hit plus the list of alert _ids that
        //    will receive alert-side correlation flags in the bulk update.
        const updates: Array<{ hit: any; bundleUuid: string; alertIds: string[] }> = [];
        const responses = (msearchResponse as any).responses ?? [];
        for (let i = 0; i < queries.length; i++) {
          const resp = responses[i];
          if (!resp) continue;
          if (resp.error) {
            result.errors.push(`msearch[${i}]: ${JSON.stringify(resp.error).slice(0, 200)}`);
            continue;
          }
          const total = typeof resp.hits?.total === 'number'
            ? resp.hits.total
            : resp.hits?.total?.value ?? 0;
          if (total > 0) {
            const alertHits = (resp.hits?.hits ?? []) as any[];
            const alertIds = alertHits.map((h) => h._id).filter((id): id is string => typeof id === 'string');
            updates.push({ hit: queries[i].hit, bundleUuid: queries[i].bundleUuid, alertIds });
          }
        }

        // 5. Bulk update matched docs.
        //    - Test-doc update: flip f0rtika.defender_detected to true.
        //    - Alert-doc update(s): write f0rtika.achilles_correlated + test_uuid + matched_at.
        //      Alert updates are deduplicated per batch — if two test docs
        //      in the same batch match the same alert, we emit only one
        //      alert-side update (the first). The second is implicitly a
        //      no-op; subsequent passes self-heal if the first failed.
        if (updates.length > 0) {
          const operations: unknown[] = [];
          const testOpMeta: Array<{ kind: 'test' | 'alert'; alertId?: string }> = [];
          const alertIdsEmitted = new Set<string>();
          const matchedAt = new Date().toISOString();

          for (const u of updates) {
            // Test-doc update
            operations.push({ update: { _index: u.hit._index, _id: u.hit._id } });
            operations.push({ doc: { f0rtika: { defender_detected: true } } });
            testOpMeta.push({ kind: 'test' });

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
              testOpMeta.push({ kind: 'alert', alertId });
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
                result.detected += 1;
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
    return {
      bool: {
        filter: [
          { range: { 'routing.event_time': { gte: `now-${lookbackDays}d` } } },
          { terms: { 'event.ERROR': CONCLUSIVE_ERROR_CODES } },
          { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } },
          { bool: { must_not: [{ term: { 'f0rtika.defender_detected': true } }] } },
        ],
      },
    };
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
