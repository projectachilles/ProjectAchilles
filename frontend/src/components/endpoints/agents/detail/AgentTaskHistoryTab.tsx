/**
 * Agent Task History Tab - Paginated table of all tasks for this agent.
 */

import { useEffect, useState } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/shared/ui/Table';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Loading } from '@/components/shared/ui/Spinner';
import { agentApi } from '@/services/api/agent';
import type { AgentTask, TaskStatus } from '@/types/agent';

interface AgentTaskHistoryTabProps {
  agentId: string;
}

const PAGE_SIZE = 20;

function taskStatusVariant(status: TaskStatus): 'success' | 'warning' | 'destructive' | 'default' | 'primary' {
  switch (status) {
    case 'completed': return 'success';
    case 'pending': case 'assigned': case 'downloading': return 'warning';
    case 'failed': case 'expired': return 'destructive';
    case 'executing': return 'primary';
    default: return 'default';
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(normalized).toLocaleString();
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export default function AgentTaskHistoryTab({ agentId }: AgentTaskHistoryTabProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await agentApi.listTasks({
          agent_id: agentId,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        });
        if (!cancelled) {
          setTasks(result.tasks);
          setTotal(result.total);
        }
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [agentId, page]);

  if (loading && tasks.length === 0) {
    return <div className="py-8"><Loading message="Loading tasks..." /></div>;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mt-4">
      <div className="border-theme border-border rounded-base shadow-theme overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Test / Command</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Exit Code</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <p className="text-muted-foreground">No tasks found for this agent</p>
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={taskStatusVariant(task.status)} className="text-xs">
                        {task.status}
                      </Badge>
                      {(task.retry_count ?? 0) > 0 && (
                        <Badge variant="warning" className="text-xs">
                          Retry {task.retry_count}/{task.max_retries}
                        </Badge>
                      )}
                      {task.original_task_id && (
                        <span className="text-[10px] text-muted-foreground font-mono" title={`Retry of ${task.original_task_id}`}>
                          retried
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{task.type}</TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {task.type === 'execute_command'
                      ? (task.payload.command ?? 'Command')
                      : (task.payload.test_name || '-')}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(task.created_at)}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {task.result?.execution_duration_ms != null
                      ? formatDurationMs(task.result.execution_duration_ms)
                      : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {task.result?.exit_code != null ? (
                      <span className={task.result.exit_code === 0 ? 'text-green-500' : 'text-red-500'}>
                        {task.result.exit_code}
                      </span>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {total} task{total !== 1 ? 's' : ''} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
