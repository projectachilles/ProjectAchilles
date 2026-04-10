import type { Client } from '@elastic/elasticsearch';
import { buildDefenderEvidenceQuery } from './evidence-correlation.js';
import { DEFENDER_INDEX } from './index-management.js';
import type { EnrichmentPassOptions, EnrichmentPassResult } from '../../types/defender.js';

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_DURATION_MS = 60_000;
const CONCLUSIVE_ERROR_CODES = [101, 105, 126, 127];

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
          sort: [{ 'routing.event_time': 'desc' }, { _id: 'asc' }],
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

      // 2. Build msearch body, skipping docs where helper returns null
      const queries: Array<{ hit: any; body: Record<string, unknown> }> = [];
      for (const hit of hits) {
        const src = hit._source?.f0rtika ?? {};
        const routing = hit._source?.routing ?? {};
        const query = buildDefenderEvidenceQuery({
          test_uuid: src.test_uuid ?? '',
          routing_event_time: routing.event_time ?? '',
          routing_hostname: routing.hostname ?? '',
        });
        if (!query) {
          result.skipped += 1;
          continue;
        }
        queries.push({ hit, body: query });
      }

      // 3. Execute msearch
      if (queries.length > 0) {
        const searches: unknown[] = [];
        for (const q of queries) {
          searches.push({ index: DEFENDER_INDEX });
          searches.push({ size: 0, query: q.body });
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

        // 4. Collect matched docs for bulk update
        const updates: Array<{ hit: any }> = [];
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
          if (total > 0) updates.push({ hit: queries[i].hit });
        }

        // 5. Bulk update matched docs
        if (updates.length > 0) {
          const operations: unknown[] = [];
          for (const u of updates) {
            operations.push({ update: { _index: u.hit._index, _id: u.hit._id } });
            operations.push({ doc: { f0rtika: { defender_detected: true } } });
          }
          try {
            const bulkResponse = await this.client.bulk({ operations } as any);
            const items = (bulkResponse as any).items ?? [];
            for (let i = 0; i < items.length; i++) {
              const item = items[i]?.update;
              if (item?.error) {
                result.errors.push(`bulk[${i}]: ${item.error.reason ?? 'unknown'}`);
              } else {
                result.detected += 1;
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
