/**
 * The run start a result document records (`routing.run_started_at`), from
 * what the agent reported. It opens the result's run window: the Defender
 * alert queries look for alerts whose activity span overlaps the run, and
 * edr/runEvidence.ts credits only evidence inside it. The agent reports both
 * times, so a start long before the end would make an old alert of the same
 * test on that host look like evidence of this run.
 *
 * The bound is the task's own: the agent takes `started_at` just before it
 * starts the test process and stops the process at `execution_timeout`, so a
 * real run lasts at most that long. RUN_START_GRACE_MS covers the time from
 * the stop to `completed_at`; it is the server's overdue buffer
 * (OVERDUE_BUFFER_SECONDS in tasks.service.ts), after which the task is failed
 * anyway. A start outside the bound is not recorded: the result then has no
 * run window and is matched by the alert-time window around its end, as
 * results were before run starts were stored. A start is never moved.
 */

/** Slack after `execution_timeout` (the overdue buffer). */
export const RUN_START_GRACE_MS = 120_000;

/** `execution_timeout` when the payload has none (the tasks table's default). */
export const DEFAULT_EXECUTION_TIMEOUT_S = 300;

const parse = (v: unknown): number => (typeof v === 'string' && v !== '' ? Date.parse(v) : Number.NaN);

/**
 * The start in UTC ISO form, or undefined: when either time is missing or not
 * a date, the start is after the end, or the run would be longer than the
 * task's `execution_timeout` (seconds) plus RUN_START_GRACE_MS.
 */
export function boundedRunStart(startedAt: unknown, completedAt: unknown, executionTimeoutS: unknown): string | undefined {
  const start = parse(startedAt);
  const end = parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return undefined;
  const timeoutS = typeof executionTimeoutS === 'number' && Number.isFinite(executionTimeoutS) && executionTimeoutS > 0
    ? executionTimeoutS
    : DEFAULT_EXECUTION_TIMEOUT_S;
  if (end - start > timeoutS * 1000 + RUN_START_GRACE_MS) return undefined;
  return new Date(start).toISOString();
}
