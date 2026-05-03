// Background retry worker for ES result ingestion.
//
// The result-submission route attempts ES ingestion synchronously as the
// fast path. If that attempt fails (ES unreachable, mapping conflict,
// transient bulk error), the task is left at es_ingested=0 and this worker
// drains the backlog on a fixed interval.
//
// The same retryPendingIngestions() function powers the one-shot backfill
// script — kept identical so any code path that recovers data behaves the
// same way the worker does.

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
 * Drain one batch of pending ingestions. Called periodically by the worker
 * and once-per-invocation by scripts/backfill-results.ts.
 *
 * Each task is attempted independently — a failure on one does not abort
 * the batch. ingest_attempts is incremented on every attempt (success or
 * failure) so transient errors decay toward the permanent-failure cap.
 */
export async function retryPendingIngestions(batchSize = 50): Promise<RetryReport> {
  const pending = getPendingIngestionTasks(batchSize);
  let succeeded = 0;
  let failed = 0;

  for (const task of pending) {
    if (!task.result) continue;
    try {
      await ingestResult(task, task.result);
      markTaskIngested(task.id);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        '[Ingestion-Retry] task %s attempt %d failed: %s',
        task.id,
        (task.ingest_attempts ?? 0) + 1,
        msg,
      );
      markIngestionFailed(task.id);
      failed++;
    }
  }

  return {
    attempted: pending.length,
    succeeded,
    failed,
    permanentlyFailed: countPermanentlyFailedIngestions(),
  };
}

let retryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic retry worker. Returns a disposer that clears the
 * interval. Idempotent — calling twice is a no-op.
 *
 * Default cadence is 5 minutes — slow enough to avoid hammering ES during
 * an outage, fast enough that a recovered cluster catches up quickly.
 */
export function startIngestionRetryWorker(intervalMs = 5 * 60 * 1000): () => void {
  if (retryTimer) {
    return stopIngestionRetryWorker;
  }

  retryTimer = setInterval(() => {
    void retryPendingIngestions().then((report) => {
      if (report.attempted > 0 || report.permanentlyFailed > 0) {
        console.log(
          '[Ingestion-Retry] attempted=%d succeeded=%d failed=%d permanent=%d',
          report.attempted,
          report.succeeded,
          report.failed,
          report.permanentlyFailed,
        );
      }
    }).catch((err) => {
      console.error(
        '[Ingestion-Retry] worker tick crashed:',
        err instanceof Error ? err.message : err,
      );
    });
  }, intervalMs);
  retryTimer.unref();

  return stopIngestionRetryWorker;
}

export function stopIngestionRetryWorker(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}
