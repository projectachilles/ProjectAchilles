/**
 * Task Stream — the approved "Tasks: Live Stream" direction. The stream IS
 * the task list: chronological rows with date markers, batch groups that
 * collapse to summary rows, and a detail panel for the selected task.
 * Props are a superset-compatible mirror of the old TaskList so TasksPage
 * keeps all of its handlers unchanged.
 */

import { Fragment, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentTask, TaskGroup } from '@/types/agent';
import { resolveTaskStatusDisplay, type TaskStatusVariant } from '@/utils/taskStatusDisplay';
import { TONE_DOT, TONE_TEXT, testOutcome, type TestOutcomeTone } from '@/utils/testOutcome';
import { Checkbox } from '../../shared/ui/Checkbox';
import { Loading } from '../../shared/ui/Spinner';
import TaskDetailPanel from './TaskDetailPanel';
import { clockTime, dayKey, dayLabel, formatDuration, taskName } from './taskFormat';
import { cn } from '@/lib/utils';
import { StreamRow } from '../../shared/ui/StreamRow';

interface TaskStreamProps {
  groups: TaskGroup[];
  loading: boolean;
  selectedTasks?: string[];
  onToggleSelect?: (taskId: string) => void;
  onToggleSelectAll?: () => void;
  onToggleGroupSelect?: (batchId: string) => void;
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onOpenNotes?: (task: AgentTask) => void;
  /** Pinned at the bottom of the list pane (pagination). */
  footer?: ReactNode;
  /** Fill the parent's height: the list and the detail scroll independently (large screens). */
  fill?: boolean;
}

const ACTIVE_STATUSES = new Set(['pending', 'assigned', 'downloading', 'executing']);

/**
 * "5 agents", or "1 of 5 agents" when a filter (the Tasks page breakdown)
 * lists only part of the batch; agent_count always describes the whole batch.
 */
function agentCountLabel(group: TaskGroup): string {
  const listed = new Set(group.tasks.map((t) => t.agent_id)).size;
  return listed < group.agent_count ? `${listed} of ${group.agent_count} agents` : `${group.agent_count} agents`;
}
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
export default function TaskStream({
  groups,
  loading,
  selectedTasks = [],
  onToggleSelect,
  onToggleSelectAll,
  onToggleGroupSelect,
  onCancel,
  onRetry,
  onDelete,
  onOpenNotes,
  footer,
  fill = false,
}: TaskStreamProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  const allTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const selectedTask = useMemo(
    () => allTasks.find((t) => t.id === selectedTaskId) ?? allTasks[0] ?? null,
    [allTasks, selectedTaskId],
  );

  const selectedNotice = useMemo(() => {
    if (!selectedTask?.notice_id) return undefined;
    for (const g of groups) {
      const n = g.notices?.[selectedTask.notice_id];
      if (n) return n;
    }
    return undefined;
  }, [groups, selectedTask]);

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
      <div data-testid="task-list-pane" className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex h-32 items-center justify-center text-sm text-faint">No tasks found</div>
        {footer && <div className="border-t border-border px-4 py-2.5">{footer}</div>}
      </div>
    );
  }

  const selectable = Boolean(onToggleSelect);

  const renderTaskRow = (task: AgentTask, indent: boolean, notices?: TaskGroup['notices']) => {
    const display = resolveTaskStatusDisplay(task, noticeFor(task, notices));
    const outcome = testOutcome(task);
    const isSelected = selectedTask?.id === task.id;
    const failed = display.variant === 'destructive';
    return (
      <StreamRow
        key={task.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedTaskId(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setSelectedTaskId(task.id);
        }}
        aria-current={isSelected || undefined}
        className={cn(
          'w-full cursor-pointer px-4 py-[5px] text-left font-mono text-xs transition-colors',
          indent && 'pl-9',
          // Same as the Analytics run list: accent wash + an inset bar (a left
          // border would be clipped by the rounded, scrolling list).
          isSelected ? 'bg-accent-dim shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-raised/60',
          checkedClass(task.id),
        )}
        leading={
          <>
            {selectable && (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedTasks.includes(task.id)}
                  onChange={() => onToggleSelect?.(task.id)}
                />
              </span>
            )}
            <span className="shrink-0 text-faint">{clockTime(task.created_at)}</span>
            {outcome ? (
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[outcome.tone])} aria-hidden="true" />
            ) : (
              <Glyph variant={display.variant} />
            )}
          </>
        }
        name={taskName(task)}
        nameClassName={cn('font-sans text-[13px] text-foreground', isSelected && 'font-semibold')}
        meta={<span className="text-muted">{task.agent_hostname ?? '—'}</span>}
        trailing={
          outcome ? (
            <span className={TONE_TEXT[outcome.tone]} title={outcome.title}>
              {outcome.label.toLowerCase()}
            </span>
          ) : failed && task.result ? (
            <span className="text-danger">exit {task.result.exit_code}</span>
          ) : ACTIVE_STATUSES.has(task.status) ? (
            <span className="text-info">{display.label.toLowerCase()}…</span>
          ) : (
            <span className="text-faint">{formatDuration(task.result?.execution_duration_ms)}</span>
          )
        }
      />
    );
  };

  const noticeFor = (task: AgentTask, notices?: TaskGroup['notices']) =>
    task.notice_id ? notices?.[task.notice_id] : undefined;

  const runTagsFor = (group: TaskGroup) =>
    Array.from(new Set(Object.values(group.notices ?? {}).map((n) => n.run_tag))).join(', ');

  const checkedClass = (taskId: string) =>
    selectedTasks.includes(taskId) ? 'bg-accent-dim/40' : undefined;

  // Assemble stream entries with date markers
  let lastDay: string | null = null;

  return (
    <div
      className={cn(
        'grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]',
        fill ? 'lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]' : 'items-start',
      )}
    >
      {/* Stream */}
      <div
        data-testid="task-list-pane"
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-surface',
          fill && 'flex min-h-0 flex-col',
        )}
      >
        <div data-testid="task-list-scroll" className={cn('py-1', fill && 'min-h-0 flex-1 overflow-auto')}>
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
                  {task ? renderTaskRow(task, false, group.notices) : null}
                </Fragment>
              );
            }

            const collapsed = collapsedBatches.has(group.batch_id);
            const completed = group.status_counts.completed ?? 0;
            const failedCount = (group.status_counts.failed ?? 0) + (group.status_counts.expired ?? 0);
            const hasActive = group.tasks.some((t) => ACTIVE_STATUSES.has(t.status));
            // Test batches count outcomes (126 is a win, not a failure); others count lifecycle.
            const toneCounts = new Map<TestOutcomeTone, number>();
            for (const t of group.tasks) {
              const o = testOutcome(t);
              if (o) toneCounts.set(o.tone, (toneCounts.get(o.tone) ?? 0) + 1);
            }
            const isTestBatch = toneCounts.size > 0;
            const batchBorder = hasActive
              ? 'border-info/40'
              : isTestBatch
                ? toneCounts.has('danger') ? 'border-danger/35' : toneCounts.has('warning') ? 'border-warning/35' : 'border-accent/35'
                : failedCount > 0 ? 'border-danger/35' : 'border-accent/35';

            return (
              <Fragment key={group.batch_id}>
                {marker}
                <div
                  className={cn(
                    'ml-4 border-l-2 pl-0',
                    batchBorder,
                  )}
                >
                  <div className="flex items-center gap-2.5 px-3 py-[5px] font-mono text-xs">
                    {selectable && onToggleGroupSelect && (
                      <Checkbox
                        checked={group.tasks.every((t) => selectedTasks.includes(t.id)) && group.tasks.length > 0}
                        onChange={() => onToggleGroupSelect(group.batch_id)}
                      />
                    )}
                    <StreamRow
                      as="button"
                      type="button"
                      onClick={() => toggleBatch(group.batch_id)}
                      className="min-w-0 flex-1 text-left"
                      leading={
                        <>
                          {collapsed ? (
                            <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                          ) : (
                            <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
                          )}
                          <span className="shrink-0 text-faint">{clockTime(group.created_at)}</span>
                        </>
                      }
                      name={`batch · ${group.payload?.test_name || group.type.replace(/_/g, ' ')}`}
                      nameClassName="font-sans text-[13px]"
                      meta={
                        <span className="text-faint">
                          · {agentCountLabel(group)}
                          {runTagsFor(group) && <span className="ml-1.5 text-muted">· {runTagsFor(group)}</span>}
                        </span>
                      }
                      trailing={
                        <>
                          {isTestBatch ? (
                            (['accent', 'danger', 'warning', 'muted'] as const).map((tone) =>
                              toneCounts.has(tone) ? (
                                <span key={tone} className={cn('inline-flex items-center gap-1', TONE_TEXT[tone])}>
                                  <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} aria-hidden="true" />
                                  {toneCounts.get(tone)}
                                </span>
                              ) : null,
                            )
                          ) : (
                            <>
                              {completed > 0 && <span className="text-accent">{completed}✓</span>}
                              {failedCount > 0 && <span className="text-danger">{failedCount}✕</span>}
                            </>
                          )}
                          {hasActive && <span className="text-info">▶&#xFE0E;</span>}
                        </>
                      }
                    />
                  </div>
                  {!collapsed && group.tasks.map((task) => renderTaskRow(task, true, group.notices))}
                </div>
              </Fragment>
            );
          })}
        </div>
        {footer && <div className="shrink-0 border-t border-border px-4 py-2.5">{footer}</div>}
      </div>

      {/* Detail panel */}
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          notice={selectedNotice}
          onCancel={onCancel}
          onRetry={onRetry}
          onDelete={onDelete}
          onOpenNotes={onOpenNotes}
          fill={fill}
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-surface text-sm text-faint">
          Select a task to see its detail.
        </div>
      )}
    </div>
  );
}
