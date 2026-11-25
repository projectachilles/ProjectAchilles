/**
 * One-time start-up pass that fills `routing.run_started_at` on results stored
 * before ingestion wrote it. The run's start comes from the agent task rows in
 * SQLite (`tasks.result.started_at`). A result whose task or start cannot be
 * found is counted `unfillable` and left alone: a run's start is never guessed.
 */
import type { Client } from '@elastic/elasticsearch';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { getDatabase } from './database.js';

export interface RunStartBackfillResult { scanned: number; filled: number; unfillable: number; errors: string[] }
export interface RunStartBackfillOptions { days?: number; pageSize?: number; maxDurationMs?: number }

const DEFAULT_DAYS = 90;
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_DURATION_MS = 120_000;

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The task id of a result document id: the part before the first `::`. */
const taskIdOf = (docId: string): string => {
  const i = docId.indexOf('::');
  return i === -1 ? docId : docId.slice(0, i);
};

const isValidStart = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));

type Hit = { _id?: string; _index?: string; sort?: unknown[] };

/** Never throws. */
export async function backfillRunStart(
  client: Client,
  resultsIndexPattern: string,
  startedAtOf: (taskIds: string[]) => Map<string, string>,
  options: RunStartBackfillOptions = {},
): Promise<RunStartBackfillResult> {
  const days = options.days ?? DEFAULT_DAYS;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const deadline = Date.now() + (options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS);
  const query = {
    bool: {
      filter: [
        { exists: { field: 'f0rtika.test_uuid' } },
        { range: { 'routing.event_time': { gte: `now-${days}d` } } },
      ],
      must_not: [{ exists: { field: 'routing.run_started_at' } }],
    },
  };
  // Documents already handled in this pass: never send the same one twice.
  const seen = new Set<string>();
  const result: RunStartBackfillResult = { scanned: 0, filled: 0, unfillable: 0, errors: [] };
  let searchAfter: unknown[] | undefined;

  try {
    while (Date.now() < deadline) {
      let hits: Hit[];
      try {
        const res = await client.search({
          index: resultsIndexPattern,
          size: pageSize,
          query,
          sort: [{ 'routing.event_time': { order: 'asc', unmapped_type: 'date' } }],
          ...(searchAfter ? { search_after: searchAfter } : {}),
          _source: false,
          ignore_unavailable: true,
          allow_no_indices: true,
        } as never);
        hits = (res.hits?.hits ?? []) as Hit[];
      } catch (err) {
        result.errors.push(`search: ${errMsg(err)}`);
        break;
      }
      if (hits.length === 0) break;
      result.scanned += hits.length;

      const fresh = hits.filter((h) => {
        const key = `${h._index}\u0000${h._id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let starts: Map<string, string>;
      try {
        const ids = [...new Set(fresh.map((h) => taskIdOf(h._id ?? '')))];
        starts = ids.length > 0 ? startedAtOf(ids) : new Map();
      } catch (err) {
        result.errors.push(`lookup: ${errMsg(err)}`);
        break;
      }

      const operations: unknown[] = [];
      for (const h of fresh) {
        const start: unknown = starts.get(taskIdOf(h._id ?? ''));
        if (!isValidStart(start)) {
          result.unfillable++;
          continue;
        }
        operations.push({ update: { _index: h._index, _id: h._id, retry_on_conflict: 3 } });
        operations.push({ doc: { routing: { run_started_at: start } } });
      }

      if (operations.length > 0) {
        try {
          const res = await client.bulk({ refresh: true, operations } as never);
          const items = (res.items ?? []) as Array<Record<string, { result?: string; error?: { reason?: string } | string }>>;
          items.forEach((item, i) => {
            const op = Object.values(item)[0];
            if (op?.error) {
              const reason = typeof op.error === 'string' ? op.error : (op.error.reason ?? 'unknown error');
              result.errors.push(`bulk[${i}]: ${reason}`);
            } else if (op?.result === 'updated') {
              result.filled++;
            }
          });
        } catch (err) {
          result.errors.push(`bulk: ${errMsg(err)}`);
          break;
        }
      }

      const last = hits[hits.length - 1].sort;
      if (!last) break;
      searchAfter = last;
    }
  } catch (err) {
    result.errors.push(errMsg(err));
  }
  return result;
}

/** Reads each task's `started_at` from `tasks.result` with one bound-parameter query. */
function lookupStartedAt(taskIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (taskIds.length === 0) return out;
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = getDatabase()
    .prepare(`SELECT id, result FROM tasks WHERE id IN (${placeholders})`)
    .all(...taskIds) as Array<{ id: string; result: string | null }>;
  for (const row of rows) {
    if (!row.result) continue;
    try {
      const started = (JSON.parse(row.result) as { started_at?: unknown } | null)?.started_at;
      if (typeof started === 'string') out.set(row.id, started);
    } catch {
      // Unparseable result: the task has no usable start.
    }
  }
  return out;
}

/** Resolves settings, client and the task lookup itself. Never throws. */
export async function runRunStartBackfill(): Promise<RunStartBackfillResult> {
  try {
    const settings = new SettingsService().getSettings();
    if (!settings.configured) return { scanned: 0, filled: 0, unfillable: 0, errors: [] };
    const result = await backfillRunStart(createEsClient(settings), settings.indexPattern, lookupStartedAt);
    if (result.scanned > 0) {
      console.log(`[Run-Start-Backfill] scanned=${result.scanned} filled=${result.filled} unfillable=${result.unfillable}`);
    }
    for (const e of result.errors.slice(0, 5)) console.warn(`[Run-Start-Backfill-ERROR] ${e}`);
    return result;
  } catch (err) {
    const msg = errMsg(err);
    console.warn(`[Run-Start-Backfill-ERROR] ${msg}`);
    return { scanned: 0, filled: 0, unfillable: 0, errors: [msg] };
  }
}
