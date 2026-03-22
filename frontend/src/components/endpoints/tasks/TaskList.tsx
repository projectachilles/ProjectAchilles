import { useState, Fragment } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Maximize, StickyNote, X, Trash2, AlertTriangle } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/shared/ui/Table';
import { Badge } from '@/components/shared/ui/Badge';
import { Button } from '@/components/shared/ui/Button';
import { Checkbox } from '@/components/shared/ui/Checkbox';
import { Dialog, DialogHeader, DialogTitle, DialogContent } from '@/components/shared/ui/Dialog';
import type { AgentTask, TaskGroup, TaskStatus } from '@/types/agent';

interface TaskListProps {
  groups: TaskGroup[];
  loading: boolean;
  selectedTasks?: string[];
  onToggleSelect?: (taskId: string) => void;
  onToggleSelectAll?: () => void;
  onToggleGroupSelect?: (batchId: string) => void;
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

function isDeletable(_status: TaskStatus): boolean {
  return true;
}

function isGroupCancellable(group: TaskGroup): boolean {
  return group.tasks.some((t) => isCancellable(t.status));
}

function isGroupDeletable(group: TaskGroup): boolean {
  return group.tasks.every((t) => isDeletable(t.status));
}

function TaskName({ task }: { task: Pick<AgentTask, 'type' | 'payload'> }): React.ReactElement {
  if (task.type === 'execute_command') {
    const cmd = task.payload.command ?? '';
    return (
      <span className="font-mono text-xs" title={cmd}>
        {cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd}
      </span>
    );
  }
  if (task.type === 'update_agent') {
    return <span className="text-muted-foreground italic">Agent Update</span>;
  }
  if (task.type === 'uninstall') {
    return <span className="text-muted-foreground italic">Agent Uninstall</span>;
  }
  return <>{task.payload.test_name}</>;
}

function StatusBadges({ statusCounts }: { statusCounts: Partial<Record<TaskStatus, number>> }): React.ReactElement {
  const entries = Object.entries(statusCounts) as [TaskStatus, number][];
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([status, count]) => (
        <Badge key={status} variant={statusVariants[status]} className="text-[10px] px-1.5 py-0">
          {status} {count > 1 ? `\u00d7${count}` : ''}
        </Badge>
      ))}
    </div>
  );
}

function TaskDetailRow({ task, colSpan }: { task: AgentTask; colSpan: number }): React.ReactElement | null {
  const [outputExpanded, setOutputExpanded] = useState(false);

  if (!task.result) return null;
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
          {task.result?.error && (
            <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{task.result.error}</span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1">
              <span className="font-medium">Stdout:</span>
              {task.result.stdout && <CopyButton text={task.result.stdout} />}
              <Button variant="ghost" size="sm" className="h-6 px-1.5"
                onClick={() => setOutputExpanded(true)} title="Expand output">
                <Maximize className="w-3.5 h-3.5" />
              </Button>
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
        <Dialog open={outputExpanded} onClose={() => setOutputExpanded(false)} className="!max-w-5xl">
          <DialogHeader onClose={() => setOutputExpanded(false)}>
            <DialogTitle>Task Output</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span className="font-medium">Stdout:</span>
                  {task.result.stdout && <CopyButton text={task.result.stdout} />}
                </div>
                <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-[50vh] whitespace-pre-wrap break-words">
                  {task.result.stdout || '(empty)'}
                </pre>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span className="font-medium">Stderr:</span>
                  {task.result.stderr && <CopyButton text={task.result.stderr} />}
                </div>
                <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-[50vh] whitespace-pre-wrap break-words">
                  {task.result.stderr || '(empty)'}
                </pre>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

export default function TaskList({
  groups,
  loading,
  selectedTasks = [],
  onToggleSelect,
  onToggleSelectAll,
  onToggleGroupSelect,
  onCancel,
  onDelete,
  onOpenNotes,
}: TaskListProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const allTaskIds = groups.flatMap((g) => g.tasks.map((t) => t.id));
  const allSelected = allTaskIds.length > 0 && allTaskIds.every((id) => selectedTasks.includes(id));
  const hasSelect = !!onToggleSelectAll;
  const colSpan = hasSelect ? 10 : 9;

  if (loading) return null;

  function toggleGroup(batchId: string): void {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  }

  function toggleTaskDetail(taskId: string): void {
    setExpandedTaskId(expandedTaskId === taskId ? null : taskId);
  }

  function renderSingleTaskRow(task: AgentTask): React.ReactElement {
    const isExpanded = expandedTaskId === task.id;
    const isSelected = selectedTasks.includes(task.id);

    return (
      <Fragment key={task.id}>
        <TableRow className={isSelected ? 'bg-primary/5' : ''}>
          {onToggleSelect && (
            <TableCell>
              <Checkbox
                checked={isSelected}
                onChange={() => onToggleSelect(task.id)}
              />
            </TableCell>
          )}
          <TableCell>
            <button onClick={() => toggleTaskDetail(task.id)}>
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
            <TaskName task={task} />
            {task.status === 'failed' && task.result?.error && (
              <span className="text-xs text-muted-foreground truncate block mt-0.5">
                {task.result.error}
              </span>
            )}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground" title={task.agent_id}>
            {task.agent_hostname ?? <span className="font-mono text-xs">{task.agent_id.slice(0, 8)}...</span>}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {timeAgo(task.created_at)}
          </TableCell>
          <TableCell className="text-sm">
            {task.result?.execution_duration_ms != null && task.result.execution_duration_ms > 0
              ? `${task.result.execution_duration_ms}ms`
              : '—'}
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
        {isExpanded && <TaskDetailRow task={task} colSpan={colSpan} />}
      </Fragment>
    );
  }

  function renderMultiAgentGroup(group: TaskGroup): React.ReactElement {
    const isExpanded = expandedGroups.has(group.batch_id);
    const groupTaskIds = group.tasks.map((t) => t.id);
    const allGroupSelected = groupTaskIds.length > 0 && groupTaskIds.every((id) => selectedTasks.includes(id));

    return (
      <Fragment key={group.batch_id}>
        <TableRow className={allGroupSelected ? 'bg-primary/5' : 'bg-muted/20'}>
          {onToggleGroupSelect && (
            <TableCell>
              <Checkbox
                checked={allGroupSelected}
                onChange={() => onToggleGroupSelect(group.batch_id)}
              />
            </TableCell>
          )}
          <TableCell>
            <button onClick={() => toggleGroup(group.batch_id)}>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </TableCell>
          <TableCell>
            <StatusBadges statusCounts={group.status_counts} />
          </TableCell>
          <TableCell className="font-medium">
            <TaskName task={group} />
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {group.agent_count} agents
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {timeAgo(group.created_at)}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">&mdash;</TableCell>
          <TableCell className="text-sm text-muted-foreground">&mdash;</TableCell>
          <TableCell className="text-sm text-muted-foreground">&mdash;</TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              {isGroupCancellable(group) && onCancel && (
                <Button variant="ghost" size="icon" onClick={() => {
                  for (const t of group.tasks) {
                    if (isCancellable(t.status)) onCancel(t.id);
                  }
                }}>
                  <X className="w-4 h-4" />
                </Button>
              )}
              {isGroupDeletable(group) && onDelete && (
                <Button variant="ghost" size="icon" onClick={() => {
                  for (const t of group.tasks) {
                    if (isDeletable(t.status)) onDelete(t.id);
                  }
                }}>
                  <Trash2 className="w-4 h-4 text-red-400" />
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && (
          <TableRow>
            <TableCell colSpan={colSpan} className="p-0">
              <div className="border-l-2 border-primary/20 ml-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {onToggleSelect && <TableHead className="w-10" />}
                      <TableHead className="w-8" />
                      <TableHead>Agent</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Exit Code</TableHead>
                      <TableHead className="w-12">Notes</TableHead>
                      <TableHead className="w-16">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.tasks.map((task) => {
                      const isTaskExpanded = expandedTaskId === task.id;
                      const isSelected = selectedTasks.includes(task.id);
                      const childColSpan = onToggleSelect ? 8 : 7;

                      return (
                        <Fragment key={task.id}>
                          <TableRow className={isSelected ? 'bg-primary/5' : ''}>
                            {onToggleSelect && (
                              <TableCell>
                                <Checkbox
                                  checked={isSelected}
                                  onChange={() => onToggleSelect(task.id)}
                                />
                              </TableCell>
                            )}
                            <TableCell>
                              <button onClick={() => toggleTaskDetail(task.id)}>
                                {isTaskExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground" title={task.agent_id}>
                              {task.agent_hostname ?? <span className="font-mono text-xs">{task.agent_id.slice(0, 8)}...</span>}
                              {task.status === 'failed' && task.result?.error && (
                                <span className="text-xs text-muted-foreground truncate block mt-0.5">
                                  {task.result.error}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariants[task.status]}>
                                {task.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {task.result?.execution_duration_ms != null && task.result.execution_duration_ms > 0
                                ? `${task.result.execution_duration_ms}ms`
                                : '—'}
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
                          {isTaskExpanded && <TaskDetailRow task={task} colSpan={childColSpan} />}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {hasSelect && (
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
        {groups.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
              No tasks found
            </TableCell>
          </TableRow>
        ) : (
          groups.map((group) =>
            group.agent_count === 1
              ? renderSingleTaskRow(group.tasks[0])
              : renderMultiAgentGroup(group)
          )
        )}
      </TableBody>
    </Table>
  );
}
