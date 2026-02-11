import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, StickyNote, X, Trash2 } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/shared/ui/Table';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Checkbox } from '@/components/shared/ui/Checkbox';
import type { AgentTask, TaskStatus } from '@/types/agent';

interface TaskListProps {
  tasks: AgentTask[];
  loading: boolean;
  selectedTasks?: string[];
  onToggleSelect?: (taskId: string) => void;
  onToggleSelectAll?: () => void;
  onCancel?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
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

  // SQLite datetime('now') returns UTC without a Z suffix.
  // Append Z so JS parses it as UTC rather than local time.
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const seconds = Math.floor((Date.now() - new Date(normalized).getTime()) / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5 ml-2" onClick={handleCopy}>
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

function isCancellable(status: TaskStatus): boolean {
  return status === 'pending' || status === 'assigned';
}

function isDeletable(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'expired';
}

export default function TaskList({ tasks, loading, selectedTasks = [], onToggleSelect, onToggleSelectAll, onCancel, onDelete, onOpenNotes }: TaskListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedTasks.includes(t.id));

  if (loading) return null;

  function toggleExpanded(taskId: string): void {
    setExpandedId(expandedId === taskId ? null : taskId);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {onToggleSelectAll && (
            <TableHead className="w-10">
              <Checkbox checked={allSelected} onChange={onToggleSelectAll} />
            </TableHead>
          )}
          <TableHead className="w-8" />
          <TableHead>Status</TableHead>
          <TableHead>Task</TableHead>
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
            <TableCell colSpan={onToggleSelectAll ? 10 : 9} className="text-center text-muted-foreground py-8">
              No tasks found
            </TableCell>
          </TableRow>
        ) : (
          tasks.map((task) => {
            const isExpanded = expandedId === task.id;
            const isSelected = selectedTasks.includes(task.id);

            return (
              <>
                <TableRow key={task.id} className={isSelected ? 'bg-primary/5' : ''}>
                  {onToggleSelect && (
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => onToggleSelect(task.id)}
                      />
                    </TableCell>
                  )}
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
                  <TableCell className="font-medium">
                    {task.type === 'execute_command'
                      ? <span className="font-mono text-xs" title={task.payload.command}>
                          {(task.payload.command ?? '').length > 60
                            ? task.payload.command!.slice(0, 60) + '...'
                            : task.payload.command}
                        </span>
                      : task.payload.test_name
                    }
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground" title={task.agent_id}>
                    {task.agent_hostname ?? <span className="font-mono text-xs">{task.agent_id.slice(0, 8)}...</span>}
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
                    <div className="flex items-center gap-1">
                      {isCancellable(task.status) && onCancel && (
                        <Button variant="ghost" size="icon" onClick={() => onCancel(task.id)}>
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                      {isDeletable(task.status) && onDelete && (
                        <Button variant="ghost" size="icon" onClick={() => onDelete(task.id)}>
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && task.result && (
                  <TableRow key={`${task.id}-detail`}>
                    <TableCell colSpan={onToggleSelectAll ? 10 : 9}>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
                        <div>
                          <div className="flex items-center">
                            <span className="font-medium">Stdout:</span>
                            {task.result.stdout && <CopyButton text={task.result.stdout} />}
                          </div>
                          <pre className="mt-1 p-2 bg-background rounded text-xs overflow-x-auto max-h-40">
                            {task.result.stdout || '(empty)'}
                          </pre>
                        </div>
                        <div>
                          <div className="flex items-center">
                            <span className="font-medium">Stderr:</span>
                            {task.result.stderr && <CopyButton text={task.result.stderr} />}
                          </div>
                          <pre className="mt-1 p-2 bg-background rounded text-xs overflow-x-auto max-h-40">
                            {task.result.stderr || '(empty)'}
                          </pre>
                        </div>
                        <div className="flex flex-wrap gap-4 text-muted-foreground">
                          <span>Agent ID: <span className="font-mono text-xs">{task.agent_id}</span></span>
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
