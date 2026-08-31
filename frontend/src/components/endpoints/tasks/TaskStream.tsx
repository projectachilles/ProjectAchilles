/**
 * Task Stream — the approved "Tasks: Live Stream" direction. The stream IS
 * the task list: chronological rows with date markers, batch groups that
 * collapse to summary rows, and a detail panel for the selected task.
 * Props are a superset-compatible mirror of the old TaskList so TasksPage
 * keeps all of its handlers unchanged.
 */

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Trash2, XCircle } from 'lucide-react';
import type { AgentTask, TaskGroup } from '@/types/agent';
import { resolveTaskStatusDisplay, type TaskStatusVariant } from '@/utils/taskStatusDisplay';
import { Checkbox } from '../../shared/ui/Checkbox';
import { Button } from '../../shared/ui/Button';
import { Loading } from '../../shared/ui/Spinner';
import TaskStatusBadge from './TaskStatusBadge';
import { cn } from '@/lib/utils';

interface TaskStreamProps {
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

const ACTIVE_STATUSES = new Set(['pending', 'assigned', 'downloading', 'executing']);

function Glyph({ variant }: { variant: TaskStatusVariant }) {
  switch (variant) {
    case 'success':
      return <span className="text-accent">✓</span>;
    case 'destructive':
      return <span className="text-danger">✕</span>;
    case 'warning':
    case 'primary':
      return <span className="text-info">▶&#xFE0E;</span>;
    default:
      return <span className="text-faint">○</span>;
  }
}

function normalizeUtc(dateStr: string): string {
  return dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
}

function clockTime(dateStr: string): string {
  return new Date(normalizeUtc(dateStr)).toLocaleTimeString('en-GB', { hour12: false });
}

function dayKey(dateStr: string): string {
  return new Date(normalizeUtc(dateStr)).toDateString();
}

function dayLabel(dateStr: string): string {
  const date = new Date(normalizeUtc(dateStr));
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'today';
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function taskName(task: AgentTask): string {
  return task.payload?.test_name || task.type.replace(/_/g, ' ');
}

export default function TaskStream({
  groups,
  loading,
  selectedTasks = [],
  onToggleSelect,
  onToggleSelectAll,
  onToggleGroupSelect,
  onCancel,
  onDelete,
  onOpenNotes,
}: TaskStreamProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  const allTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const selectedTask = useMemo(
    () => allTasks.find((t) => t.id === selectedTaskId) ?? allTasks[0] ?? null,
    [allTasks, selectedTaskId],
  );

  const toggleBatch = (batchId: string) => {
    setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  if (loading) {
    return <Loading message="Loading tasks..." />;
  }

  if (groups.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-surface text-sm text-faint">
        No tasks found
      </div>
    );
  }

  const selectable = Boolean(onToggleSelect);

  const renderTaskRow = (task: AgentTask, indent: boolean) => {
    const display = resolveTaskStatusDisplay(task);
    const isSelected = selectedTask?.id === task.id;
    const failed = display.variant === 'destructive';
    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedTaskId(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setSelectedTaskId(task.id);
        }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 px-4 py-[5px] text-left font-mono text-xs transition-colors',
          indent && 'pl-9',
          isSelected ? 'bg-raised' : 'hover:bg-raised/60',
          checkedClass(task.id),
        )}
      >
        {selectable && (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selectedTasks.includes(task.id)}
              onChange={() => onToggleSelect?.(task.id)}
            />
          </span>
        )}
        <span className="shrink-0 text-faint">{clockTime(task.created_at)}</span>
        <Glyph variant={display.variant} />
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-foreground">
          {taskName(task)}
        </span>
        <span className="shrink-0 text-muted">{task.agent_hostname ?? '—'}</span>
        {failed && task.result ? (
          <span className="shrink-0 text-danger">exit {task.result.exit_code}</span>
        ) : ACTIVE_STATUSES.has(task.status) ? (
          <span className="shrink-0 text-info">{display.label.toLowerCase()}…</span>
        ) : (
          <span className="shrink-0 text-faint">{formatDuration(task.result?.execution_duration_ms)}</span>
        )}
      </div>
    );
  };

  const checkedClass = (taskId: string) =>
    selectedTasks.includes(taskId) ? 'bg-accent-dim/40' : undefined;

  // Assemble stream entries with date markers
  let lastDay: string | null = null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      {/* Stream */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface py-1">
        {selectable && onToggleSelectAll && (
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-1.5">
            <Checkbox
              checked={allTasks.length > 0 && allTasks.every((t) => selectedTasks.includes(t.id))}
              onChange={onToggleSelectAll}
            />
            <span className="text-[11px] uppercase tracking-wider text-faint">select all on page</span>
          </div>
        )}
        {groups.map((group) => {
          const day = dayKey(group.created_at);
          const marker =
            day !== lastDay ? (
              <div key={`marker-${day}`} className="px-4 py-1 font-mono text-[11px] text-faint">
                ── {dayLabel(group.created_at)} {'─'.repeat(24)}
              </div>
            ) : null;
          lastDay = day;

          if (group.tasks.length <= 1 && group.agent_count <= 1) {
            const task = group.tasks[0];
            return (
              <Fragment key={group.batch_id}>
                {marker}
                {task ? renderTaskRow(task, false) : null}
              </Fragment>
            );
          }

          const collapsed = collapsedBatches.has(group.batch_id);
          const completed = group.status_counts.completed ?? 0;
          const failedCount = (group.status_counts.failed ?? 0) + (group.status_counts.expired ?? 0);
          const hasActive = group.tasks.some((t) => ACTIVE_STATUSES.has(t.status));

          return (
            <Fragment key={group.batch_id}>
              {marker}
              <div
                className={cn(
                  'ml-4 border-l-2 pl-0',
                  hasActive ? 'border-info/40' : failedCount > 0 ? 'border-danger/35' : 'border-accent/35',
                )}
              >
                <div className="flex items-center gap-2.5 px-3 py-[5px] font-mono text-xs">
                  {selectable && onToggleGroupSelect && (
                    <Checkbox
                      checked={group.tasks.every((t) => selectedTasks.includes(t.id)) && group.tasks.length > 0}
                      onChange={() => onToggleGroupSelect(group.batch_id)}
                    />
                  )}
                  <button
                    onClick={() => toggleBatch(group.batch_id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
                    )}
                    <span className="shrink-0 text-faint">{clockTime(group.created_at)}</span>
                    <span className="min-w-0 flex-1 truncate font-sans text-[13px]">
                      batch · {group.payload?.test_name || group.type.replace(/_/g, ' ')}{' '}
                      <span className="text-faint">· {group.agent_count} agents</span>
                    </span>
                    {completed > 0 && <span className="shrink-0 text-accent">{completed}✓</span>}
                    {failedCount > 0 && <span className="shrink-0 text-danger">{failedCount}✕</span>}
                    {hasActive && <span className="shrink-0 text-info">▶&#xFE0E;</span>}
                  </button>
                </div>
                {!collapsed && group.tasks.map((task) => renderTaskRow(task, true))}
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* Detail panel */}
      {selectedTask ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold leading-snug">{taskName(selectedTask)}</h3>
              <TaskStatusBadge task={selectedTask} className="shrink-0 font-mono uppercase" />
            </div>
            <div className="mt-1 font-mono text-[11px] text-faint">
              {selectedTask.type} · batch {selectedTask.batch_id.slice(0, 8)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-b border-border p-4 md:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-faint">Agent</div>
              <div className="mt-0.5 font-mono text-xs">{selectedTask.agent_hostname ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-faint">Duration</div>
              <div className="mt-0.5 font-mono text-xs">
                {formatDuration(selectedTask.result?.execution_duration_ms)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-faint">Exit code</div>
              <div
                className={cn(
                  'mt-0.5 font-mono text-xs',
                  selectedTask.result && selectedTask.result.exit_code !== 0 && 'text-danger',
                )}
              >
                {selectedTask.result?.exit_code ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-faint">Created</div>
              <div className="mt-0.5 font-mono text-xs">
                {new Date(normalizeUtc(selectedTask.created_at)).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 p-4">
            {selectedTask.result?.error && (
              <div className="flex items-center gap-2 rounded-md bg-danger-dim p-2 text-sm text-danger">
                <XCircle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{selectedTask.result.error}</span>
              </div>
            )}
            {selectedTask.result ? (
              <>
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">stdout</div>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
                    {selectedTask.result.stdout || '(empty)'}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">stderr</div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
                    {selectedTask.result.stderr || '(empty)'}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex h-20 items-center justify-center text-sm text-faint">
                No result yet — task is {resolveTaskStatusDisplay(selectedTask).label.toLowerCase()}.
              </div>
            )}
            <div className="flex gap-2">
              {onCancel && ACTIVE_STATUSES.has(selectedTask.status) && (
                <Button variant="secondary" size="sm" onClick={() => onCancel(selectedTask.id)}>
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              {onOpenNotes && (
                <Button variant="outline" size="sm" onClick={() => onOpenNotes(selectedTask)}>
                  <FileText className="mr-1 h-3.5 w-3.5" />
                  Notes{selectedTask.notes ? ' •' : ''}
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => onDelete(selectedTask.id)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-surface text-sm text-faint">
          Select a task to see its detail.
        </div>
      )}
    </div>
  );
}
