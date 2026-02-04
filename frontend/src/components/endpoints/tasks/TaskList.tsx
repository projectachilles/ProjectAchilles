import { useState } from 'react';
import { ChevronDown, ChevronRight, StickyNote, X } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/shared/ui/Table';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import type { AgentTask, TaskStatus } from '@/types/agent';

interface TaskListProps {
  tasks: AgentTask[];
  loading: boolean;
  onCancel?: (taskId: string) => void;
  onOpenNotes?: (task: AgentTask) => void;
}

const statusVariants: Record<TaskStatus, 'default' | 'primary' | 'warning' | 'success' | 'destructive'> = {
  pending: 'default',
  assigned: 'primary',
  downloading: 'primary',
  executing: 'warning',
  completed: 'success',
  failed: 'destructive',
  expired: 'default',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';

  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function isCancellable(status: TaskStatus): boolean {
  return status === 'pending' || status === 'assigned';
}

export default function TaskList({ tasks, loading, onCancel, onOpenNotes }: TaskListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) return null;

  function toggleExpanded(taskId: string): void {
    setExpandedId(expandedId === taskId ? null : taskId);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Status</TableHead>
          <TableHead>Test Name</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Exit Code</TableHead>
          <TableHead className="w-12">Notes</TableHead>
          <TableHead className="w-16">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
              No tasks found
            </TableCell>
          </TableRow>
        ) : (
          tasks.map((task) => {
            const isExpanded = expandedId === task.id;

            return (
              <>
                <TableRow key={task.id}>
                  <TableCell>
                    <button onClick={() => toggleExpanded(task.id)}>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariants[task.status]}>
                      {task.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{task.payload.test_name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {task.agent_id.slice(0, 8)}...
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {timeAgo(task.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {task.result ? `${task.result.execution_duration_ms}ms` : '-'}
                  </TableCell>
                  <TableCell>
                    {task.result ? (
                      <Badge variant={task.result.exit_code === 0 ? 'success' : 'destructive'}>
                        {task.result.exit_code}
                      </Badge>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    {onOpenNotes && (
                      <Button variant="ghost" size="icon" onClick={() => onOpenNotes(task)}>
                        <StickyNote className={`w-4 h-4 ${task.notes ? 'text-primary' : 'text-muted-foreground/40'}`} />
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {isCancellable(task.status) && onCancel && (
                      <Button variant="ghost" size="icon" onClick={() => onCancel(task.id)}>
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {isExpanded && task.result && (
                  <TableRow key={`${task.id}-detail`}>
                    <TableCell colSpan={9}>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                        <div>
                          <span className="font-medium">Stdout:</span>
                          <pre className="mt-1 p-2 bg-background rounded text-xs overflow-x-auto max-h-40">
                            {task.result.stdout || '(empty)'}
                          </pre>
                        </div>
                        <div>
                          <span className="font-medium">Stderr:</span>
                          <pre className="mt-1 p-2 bg-background rounded text-xs overflow-x-auto max-h-40">
                            {task.result.stderr || '(empty)'}
                          </pre>
                        </div>
                        <div className="flex gap-4 text-muted-foreground">
                          <span>Started: {task.result.started_at ? new Date(task.result.started_at).toLocaleString() : '-'}</span>
                          <span>Completed: {task.result.completed_at ? new Date(task.result.completed_at).toLocaleString() : '-'}</span>
                          <span>Host: {task.result.hostname}</span>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
