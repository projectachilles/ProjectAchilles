import type { AgentTask, NoticeSummary, TaskStatus } from '@/types/agent';
import { testOutcome, type TestOutcomeTone } from './testOutcome';

export type TaskStatusVariant = 'default' | 'primary' | 'warning' | 'success' | 'destructive';

export interface TaskStatusDisplay {
  label: string;
  variant: TaskStatusVariant;
  /** Tooltip text (notice error / full not-run reason). */
  title?: string;
}

const BASE: Record<TaskStatus, TaskStatusDisplay> = {
  pending: { label: 'Pending', variant: 'default' },
  assigned: { label: 'Assigned', variant: 'primary' },
  downloading: { label: 'Downloading', variant: 'primary' },
  executing: { label: 'Executing', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'default' },
};

const TONE_VARIANT: Record<TestOutcomeTone, TaskStatusVariant> = {
  accent: 'success',
  danger: 'destructive',
  warning: 'warning',
  muted: 'default',
};

/**
 * The honest status of a task. A finished security test shows its outcome
 * (Protected, Unprotected, Not run, ...), because its exit code is the result:
 * 126 is good news, not a failure. Any other task the agent reports as
 * "completed" but whose command exited non-zero did NOT succeed: Failed.
 * A task with no result yet is not treated as a failure.
 */
export function resolveTaskStatusDisplay(
  task: Pick<AgentTask, 'status' | 'result'> & { type?: AgentTask['type'] },
  notice?: NoticeSummary,
): TaskStatusDisplay {
  if (task.status === 'pending' && notice) {
    if (notice.state === 'pending') {
      return { label: 'Sending notice…', variant: 'warning', title: notice.last_error ?? undefined };
    }
    if (
      (notice.state === 'sent' || notice.state === 'overridden') &&
      notice.release_at &&
      new Date(notice.release_at).getTime() > Date.now()
    ) {
      return { label: 'Starting soon', variant: 'primary' };
    }
  }
  if (task.status === 'expired' && task.result?.error?.startsWith('Not run:')) {
    return { label: 'Not run', variant: 'default', title: task.result.error };
  }
  const outcome = task.type ? testOutcome({ type: task.type, status: task.status, result: task.result }) : null;
  if (outcome) return { label: outcome.label, variant: TONE_VARIANT[outcome.tone], title: outcome.title };
  if (task.status === 'completed' && task.result != null && task.result.exit_code !== 0) {
    return { label: 'Failed', variant: 'destructive' };
  }
  return BASE[task.status];
}
