import type { AgentTask, TaskStatus } from '@/types/agent';

export type TaskStatusVariant = 'default' | 'primary' | 'warning' | 'success' | 'destructive';

export interface TaskStatusDisplay {
  label: string;
  variant: TaskStatusVariant;
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

/**
 * The honest status of a task. A task the agent reports as "completed" but
 * whose command exited non-zero did NOT succeed — surface it as Failed.
 * A task with no result yet is not treated as a failure.
 */
export function resolveTaskStatusDisplay(
  task: Pick<AgentTask, 'status' | 'result'>,
): TaskStatusDisplay {
  if (task.status === 'completed' && task.result != null && task.result.exit_code !== 0) {
    return { label: 'Failed', variant: 'destructive' };
  }
  return BASE[task.status];
}
