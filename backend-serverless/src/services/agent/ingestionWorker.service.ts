// Background retry worker for ES result ingestion (serverless variant).
//
// The result-submission route attempts ES ingestion synchronously as the
// fast path. If that attempt fails (ES unreachable, mapping conflict,
// transient bulk error), the task is left at es_ingested=0 and the
// /api/cron/retry-ingestion Vercel Cron drains the backlog.
//
// retryPendingIngestions() is shared between the cron handler and the
// one-shot backfill script — keeping the recovery code path identical.

import {
  getPendingIngestionTasks,
  markTaskIngested,
  markIngestionFailed,
  countPermanentlyFailedIngestions,
} from './tasks.service.js';
import { ingestResult } from './results.service.js';

export interface RetryReport {
  attempted: number;
  succeeded: number;
  failed: number;
  permanentlyFailed: number;
}

/**
 * Drain one batch of pending ingestions. Idempotent and safe to invoke from
 * a cron handler — each task increments ingest_attempts whether it succeeds
 * or fails, so transient errors decay toward the permanent-failure cap.
 */
export async function retryPendingIngestions(batchSize = 50): Promise<RetryReport> {
  const pending = await getPendingIngestionTasks(batchSize);
  let succeeded = 0;
  let failed = 0;

  for (const task of pending) {
    if (!task.result) continue;
    try {
      await ingestResult(task, task.result);
      await markTaskIngested(task.id);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        '[Ingestion-Retry] task %s attempt %d failed: %s',
        task.id,
        (task.ingest_attempts ?? 0) + 1,
        msg,
      );
      await markIngestionFailed(task.id);
      failed++;
    }
  }

  return {
    attempted: pending.length,
    succeeded,
    failed,
    permanentlyFailed: await countPermanentlyFailedIngestions(),
  };
}
