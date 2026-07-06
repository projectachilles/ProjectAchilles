import { Badge } from '@/components/shared/ui/Badge';
import { resolveTaskStatusDisplay } from '@/utils/taskStatusDisplay';
import type { AgentTask } from '@/types/agent';

interface TaskStatusBadgeProps {
  task: Pick<AgentTask, 'status' | 'result'>;
  className?: string;
}

/** Renders a task's HONEST status (completed-but-nonzero-exit shows Failed). */
export function TaskStatusBadge({ task, className }: TaskStatusBadgeProps) {
  const { label, variant } = resolveTaskStatusDisplay(task);
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

export default TaskStatusBadge;
