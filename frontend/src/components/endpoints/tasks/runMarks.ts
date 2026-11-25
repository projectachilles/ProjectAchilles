/**
 * The model behind one entry of the Tasks run timeline: which form a run
 * takes, how its tasks count, and which results come first. Pure functions;
 * the outcome rule itself stays in utils/testOutcome.ts.
 */

import type { AgentTask, TaskGroup } from '@/types/agent';
import { taskBucket, testOutcome, type TaskBucket } from '@/utils/testOutcome';
import type { BarSegment } from '../../shared/marks/VerdictBar';
import type { MarkTone } from '../../shared/marks/markTone';
import { clockTime, normalizeUtc } from './taskFormat';

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

/**
 * "5 agents", or "1 of 5 agents" when a filter (the Tasks page breakdown)
 * lists only part of the run; agent_count always describes the whole run.
 */
export function agentCountLabel(group: Pick<TaskGroup, 'tasks' | 'agent_count'>): string {
  const listed = new Set(group.tasks.map((t) => t.agent_id)).size;
  return listed < group.agent_count ? `${listed} of ${group.agent_count} agents` : `${group.agent_count} agents`;
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

/** Worst first, for the dot of a run: red, amber, grey, green. */
const RAIL_ORDER: readonly MarkTone[] = ['danger', 'warning', 'muted', 'accent'];

/**
 * The colour of a run's dot on the timeline rail: blue while anything is in
 * progress, otherwise the worst colour among its tasks' marks, so the dot of
 * a one-task run is always the colour of that task's mark.
 */
export function railTone(tasks: AgentTask[]): MarkTone {
  const tones = new Set(tasks.map(taskMarkTone));
  if (tones.has('info')) return 'info';
  return RAIL_ORDER.find((tone) => tones.has(tone)) ?? 'muted';
}

/** What identifies a run on the page. The server sends run_id; where it does not, a run is its batch. */
export function runIdOf(group: Pick<TaskGroup, 'run_id' | 'batch_id'>): string {
  return group.run_id ?? group.batch_id;
}

export function findRun(groups: TaskGroup[], runId: string): TaskGroup | undefined {
  return groups.find((g) => runIdOf(g) === runId);
}

/**
 * The time a run shows. A run of several batches (one announced run that
 * reached its agents over hours) shows when its first and last task were
 * created; any other run shows one time.
 */
export function runTimeLabel(group: Pick<TaskGroup, 'created_at' | 'batch_ids' | 'tasks'>): string {
  if ((group.batch_ids?.length ?? 1) > 1 && group.tasks.length > 0) {
    let first = group.tasks[0].created_at;
    let last = first;
    let firstMs = Date.parse(normalizeUtc(first));
    let lastMs = firstMs;
    for (const task of group.tasks) {
      const ms = Date.parse(normalizeUtc(task.created_at));
      if (ms < firstMs) [first, firstMs] = [task.created_at, ms];
      if (ms > lastMs) [last, lastMs] = [task.created_at, ms];
    }
    if (lastMs - firstMs > 60_000) return `${clockTime(first)} – ${clockTime(last)}`;
  }
  return clockTime(group.created_at);
}

/**
 * The colour of one task's mark. For a test it is the tone of its outcome,
 * the same colour as the badge in its detail (so an inconclusive run is grey
 * while a test error is amber, though both count under "no verdict").
 */
export function taskMarkTone(task: AgentTask): MarkTone {
  const bucket = taskBucket(task);
  if (bucket === 'in-progress') return 'info';
  if (task.type === 'execute_test') return testOutcome(task)?.tone ?? 'muted';
  return BUCKET_META[bucket].tone;
}
