/**
 * Task Stream — the Tasks page's list and detail. The list is a run timeline:
 * one entry per run under date markers, each task drawn as a mark (see
 * RunEntry), and a detail panel for the selected task. The props mirror the
 * old TaskList so TasksPage keeps all of its handlers unchanged.
 */

import { Fragment, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AgentTask, TaskGroup } from '@/types/agent';
import { Checkbox } from '../../shared/ui/Checkbox';
import { Loading } from '../../shared/ui/Spinner';
import { cn } from '@/lib/utils';
import { RunEntry } from './RunEntry';
import { runIdOf } from './runMarks';
import TaskDetailPanel from './TaskDetailPanel';
import { dayKey, dayLabel } from './taskFormat';

interface TaskStreamProps {
  groups: TaskGroup[];
  loading: boolean;
  selectedTasks?: string[];
  onToggleSelect?: (taskId: string) => void;
  onToggleSelectAll?: () => void;
  /** Called with the run's id (runIdOf): a batch id where the server sends no run id. */
  onToggleGroupSelect?: (runId: string) => void;
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onOpenNotes?: (task: AgentTask) => void;
  /** Pinned at the bottom of the list pane (pagination). */
  footer?: ReactNode;
  /** Fill the parent's height: the list and the detail scroll independently (large screens). */
  fill?: boolean;
}

/** Arrow keys move focus from one task mark to the next in reading order, across runs. */
function moveBetweenMarks(e: KeyboardEvent<HTMLDivElement>) {
  const step =
    e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (step === 0 || !(e.target instanceof HTMLElement)) return;
  const current = e.target.closest<HTMLElement>('[data-task-mark]');
  if (!current) return;
  e.preventDefault();
  const marks = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-task-mark]'));
  marks[marks.indexOf(current) + step]?.focus();
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

  // Only the first load replaces the list with a spinner. A reload keeps what
  // is on screen, so the selection and any open host list survive it.
  if (loading && groups.length === 0) {
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
  let lastDay: string | null = null;

  return (
    <div
      className={cn(
        'grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]',
        fill ? 'lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]' : 'items-start',
      )}
    >
      {/* Run timeline */}
      <div
        data-testid="task-list-pane"
        aria-busy={loading}
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-surface',
          fill && 'flex min-h-0 flex-col',
        )}
      >
        <div
          data-testid="task-list-scroll"
          onKeyDown={moveBetweenMarks}
          className={cn('py-1', fill && 'min-h-0 flex-1 overflow-auto')}
        >
          {selectable && onToggleSelectAll && (
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-1.5">
              <Checkbox
                aria-label="Select all on page"
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
                <div role="separator" className="flex items-center gap-2.5 px-4 pb-0.5 pt-2.5 font-mono text-[11px] text-faint">
                  {dayLabel(group.created_at)}
                  <span aria-hidden="true" className="h-px flex-1 bg-border" />
                </div>
              ) : null;
            lastDay = day;
            return (
              <Fragment key={runIdOf(group)}>
                {marker}
                <RunEntry
                  group={group}
                  selectedTaskId={selectedTask?.id ?? null}
                  onSelectTask={setSelectedTaskId}
                  checkedTaskIds={selectedTasks}
                  onToggleTask={onToggleSelect}
                  onToggleGroup={selectable ? onToggleGroupSelect : undefined}
                />
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
