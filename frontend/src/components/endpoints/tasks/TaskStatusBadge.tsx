import { Badge } from '@/components/shared/ui/Badge';
import { resolveTaskStatusDisplay } from '@/utils/taskStatusDisplay';
import type { AgentTask, NoticeSummary } from '@/types/agent';

interface TaskStatusBadgeProps {
  task: Pick<AgentTask, 'status' | 'result'> & { type?: AgentTask['type'] };
  notice?: NoticeSummary;
  className?: string;
}

/** A task's honest status: a test's outcome, or Failed for a command that exited non-zero. */
export function TaskStatusBadge({ task, notice, className }: TaskStatusBadgeProps) {
  const { label, variant, title } = resolveTaskStatusDisplay(task, notice);
  return (
    <Badge variant={variant} className={className} title={title}>
      {label}
    </Badge>
  );
}

export default TaskStatusBadge;
