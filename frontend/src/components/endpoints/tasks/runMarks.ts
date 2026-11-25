/**
 * The model behind one entry of the Tasks run timeline: which form a run
 * takes, how its tasks count, and which results come first. Pure functions;
 * the outcome rule itself stays in utils/testOutcome.ts.
 */

import type { AgentTask } from '@/types/agent';
import { taskBucket, type TaskBucket } from '@/utils/testOutcome';
import type { BarSegment } from '../../shared/marks/VerdictBar';
import type { MarkTone } from '../../shared/marks/markTone';

/** Up to this many tasks, a run shows a named pill per task. */
export const NAMED_MAX = 8;
/** Up to this many tasks, a run shows one square per task; beyond it, a bar. */
export const SQUARES_MAX = 80;
/** Rows the host list shows before "Show n more". */
export const HOST_LIST_PAGE = 8;
/** Rows each "Show n more" adds. */
export const HOST_LIST_STEP = 100;

export type RunForm = 'named' | 'squares' | 'bar';

export function runForm(taskCount: number): RunForm {
  if (taskCount <= NAMED_MAX) return 'named';
  return taskCount <= SQUARES_MAX ? 'squares' : 'bar';
}

export const BUCKET_META: Record<TaskBucket, { label: string; tone: MarkTone }> = {
  unprotected: { label: 'unprotected', tone: 'danger' },
  'no-verdict': { label: 'no verdict', tone: 'warning' },
  'in-progress': { label: 'in progress', tone: 'info' },
  protected: { label: 'protected', tone: 'accent' },
  completed: { label: 'completed', tone: 'accent' },
  failed: { label: 'failed', tone: 'danger' },
};

/**
 * Worst first. This one list decides three things an operator sees:
 *   - the order of the segments in a large run's bar (left to right),
 *   - the order of the rows in a run's host list (top to bottom),
 *   - the colour of the run's dot on the timeline rail (the first bucket
 *     here that has a task; a run with anything in progress is always blue).
 *
 * 'unprotected' must stay first, and every bucket appears exactly once. Red
 * comes before amber, amber before blue, green last: what needs a decision,
 * then what needs a retry, then what is still running, then what is fine.
 */
export const BUCKET_ORDER: readonly TaskBucket[] = [
  'unprotected',
  'failed',
  'no-verdict',
  'in-progress',
  'protected',
  'completed',
];

const RANK = new Map(BUCKET_ORDER.map((bucket, index) => [bucket, index]));
const rankOf = (task: AgentTask) => RANK.get(taskBucket(task)) ?? BUCKET_ORDER.length;

/** A run's tasks counted per bucket, in BUCKET_ORDER; empty buckets are left out. */
export function bucketSegments(tasks: AgentTask[]): BarSegment[] {
  const counts = new Map<TaskBucket, number>();
  for (const task of tasks) {
    const bucket = taskBucket(task);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return BUCKET_ORDER.filter((bucket) => counts.has(bucket)).map((bucket) => ({
    key: bucket,
    label: BUCKET_META[bucket].label,
    tone: BUCKET_META[bucket].tone,
    count: counts.get(bucket) ?? 0,
  }));
}

/**
 * Sort order for a run's host list: by bucket (BUCKET_ORDER), then by
 * hostname with a missing hostname last, then by task id so two tasks of one
 * host (a retry) keep a stable order.
 */
export function compareWorstFirst(a: AgentTask, b: AgentTask): number {
  const byBucket = rankOf(a) - rankOf(b);
  if (byBucket !== 0) return byBucket;
  if (a.agent_hostname !== b.agent_hostname) {
    if (!a.agent_hostname) return 1;
    if (!b.agent_hostname) return -1;
    return a.agent_hostname.localeCompare(b.agent_hostname);
  }
  return a.id.localeCompare(b.id);
}

/** The colour of a run's dot on the timeline rail. */
export function railTone(tasks: AgentTask[]): MarkTone {
  const buckets = new Set(tasks.map(taskBucket));
  if (buckets.has('in-progress')) return 'info';
  const worst = BUCKET_ORDER.find((bucket) => buckets.has(bucket));
  return worst ? BUCKET_META[worst].tone : 'muted';
}

export function taskMarkTone(task: AgentTask): MarkTone {
  return BUCKET_META[taskBucket(task)].tone;
}
