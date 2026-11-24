/**
 * Clears stored prevention flags on results whose stage exited 101.
 *
 * Exit 101 means the stage's process ran to completion, so it was not
 * prevented. Results written before that rule still carry
 * `<vendor>_prevented`, `<vendor>_stage_prevented` and
 * `<vendor>_prevention_action`, and the enrichment pass does not re-check most
 * of them. This vendor-independent pass clears those flags. It never touches
 * `<vendor>_detected` or `<vendor>_stage_detected`.
 *
 * The query uses `term` / `exists` filters only: no date range, sort or
 * aggregation, because the results index pattern can be as wide as
 * `achilles-*`, where `event.ERROR` has mixed mappings.
 */
import type { Client } from '@elastic/elasticsearch';
import { getSourceField } from '../reports/stageOutcome.js';

export interface CompletedStageCleanupResult { cleared: number; errors: string[] }
export interface CompletedStageCleanupOptions { batchSize?: number; maxDurationMs?: number }

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_DURATION_MS = 60_000;

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function buildCompletedStageCleanupQuery(vendors: readonly string[]): Record<string, unknown> {
  const should = vendors.flatMap((v) => [
    { term: { [`f0rtika.${v}_prevented`]: true } },
    { term: { [`f0rtika.${v}_stage_prevented`]: true } },
    { exists: { field: `f0rtika.${v}_prevention_action` } },
  ]);
  return {
    bool: {
      filter: [
        { term: { 'event.ERROR': 101 } },
        { bool: { minimum_should_match: 1, should } },
      ],
    },
  };
}

function hasFlags(source: Record<string, unknown>, vendor: string): boolean {
  const field = (kind: string) => getSourceField(source, `f0rtika.${vendor}_${kind}`);
  const action = field('prevention_action');
  return field('prevented') === true || field('stage_prevented') === true
    || (action !== null && action !== undefined);
}

/** Never throws. */
export async function clearPreventionOnCompletedResults(
  client: Client,
  resultsIndexPattern: string,
  vendors: readonly string[] = ['defender', 'crowdstrike'],
  options: CompletedStageCleanupOptions = {},
): Promise<CompletedStageCleanupResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const deadline = Date.now() + maxDurationMs;
  const query = buildCompletedStageCleanupQuery(vendors);
  const sourceFields = ['event.ERROR', ...vendors.flatMap((v) => [
    `f0rtika.${v}_prevented`, `f0rtika.${v}_stage_prevented`, `f0rtika.${v}_prevention_action`,
  ])];
  // Documents already sent in this run: never send the same one twice.
  const sent = new Set<string>();
  const result: CompletedStageCleanupResult = { cleared: 0, errors: [] };

  try {
    while (Date.now() < deadline) {
      let hits: Array<{ _id?: string; _index?: string; _source?: Record<string, unknown> }>;
      try {
        const res = await client.search({
          index: resultsIndexPattern,
          size: batchSize,
          query,
          _source: sourceFields,
        } as never);
        hits = (res.hits?.hits ?? []) as typeof hits;
      } catch (err) {
        result.errors.push(`search: ${errMsg(err)}`);
        break;
      }
      if (hits.length === 0) break;

      const operations: unknown[] = [];
      for (const hit of hits) {
        const key = `${hit._index}\u0000${hit._id}`;
        if (sent.has(key)) continue;
        const source = hit._source ?? {};
        // The search filter alone is not trusted: re-check the stored exit code.
        if (Number(getSourceField(source, 'event.ERROR')) !== 101) continue;
        const nested: Record<string, unknown> = {};
        const doc: Record<string, unknown> = {};
        for (const v of vendors) {
          if (!hasFlags(source, v)) continue;
          const values: Array<[string, unknown]> = [
            ['prevented', false], ['stage_prevented', false], ['prevention_action', null],
          ];
          for (const [kind, value] of values) {
            // Write each field in the shape the hit stores it.
            const dotKey = `f0rtika.${v}_${kind}`;
            if (source[dotKey] !== undefined) doc[dotKey] = value;
            else nested[`${v}_${kind}`] = value;
          }
        }
        if (Object.keys(doc).length === 0 && Object.keys(nested).length === 0) continue;
        if (Object.keys(nested).length > 0) doc.f0rtika = nested;
        sent.add(key);
        operations.push({ update: { _index: hit._index, _id: hit._id, retry_on_conflict: 3 } });
        operations.push({ doc });
      }
      if (operations.length === 0) break;

      let batchCleared = 0;
      try {
        const res = await client.bulk({ refresh: true, operations } as never);
        const items = (res.items ?? []) as Array<Record<string, { result?: string; error?: { reason?: string } | string }>>;
        items.forEach((item, i) => {
          const op = Object.values(item)[0];
          if (op?.error) {
            const reason = typeof op.error === 'string' ? op.error : (op.error.reason ?? 'unknown error');
            result.errors.push(`bulk[${i}]: ${reason}`);
          } else if (op?.result === 'updated') {
            batchCleared++;
          }
        });
      } catch (err) {
        result.errors.push(`bulk: ${errMsg(err)}`);
        break;
      }
      result.cleared += batchCleared;
      if (batchCleared === 0) break;
    }
  } catch (err) {
    result.errors.push(errMsg(err));
  }
  return result;
}
