import { useMemo, useState } from 'react';
import type { AgentTask, TaskGroup } from '@/types/agent';
import { resolveTaskStatusDisplay } from '@/utils/taskStatusDisplay';
import { taskBucket, type TaskBucket } from '@/utils/testOutcome';
import { cn } from '@/lib/utils';
import { Checkbox } from '../../shared/ui/Checkbox';
import { MARK_BG, MARK_TEXT } from '../../shared/marks/markTone';
import { HOST_LIST_PAGE, HOST_LIST_STEP, bucketSegments, compareWorstFirst, taskMarkTone } from './runMarks';
import { TaskMarkBody, taskMarkLabel } from './TaskMark';
import { formatDuration } from './taskFormat';

export type HostListFilter = TaskBucket | 'all';

interface RunHostListProps {
  tasks: AgentTask[];
  notices?: TaskGroup['notices'];
  filter: HostListFilter;
  onFilter: (filter: HostListFilter) => void;
  /** Filter chips above the rows. Off when a bar above the list already does the filtering. */
  showChips: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  checkedTaskIds: string[];
  /** Gives each row a checkbox. */
  onToggleTask?: (taskId: string) => void;
}

/** A run's tasks as rows, worst first: the readable form of its marks, with a checkbox each. */
export function RunHostList({
  tasks,
  notices,
  filter,
  onFilter,
  showChips,
  selectedTaskId,
  onSelectTask,
  checkedTaskIds,
  onToggleTask,
}: RunHostListProps) {
  // How many rows "Show n more" has revealed, remembered per filter so a change of filter starts short again.
  const [extra, setExtra] = useState<{ filter: HostListFilter; rows: number }>({ filter, rows: 0 });
  const shown = HOST_LIST_PAGE + (extra.filter === filter ? extra.rows : 0);

  const rows = useMemo(
    () => tasks.filter((t) => filter === 'all' || taskBucket(t) === filter).sort(compareWorstFirst),
    [tasks, filter],
  );
  const hidden = rows.length - shown;

  return (
    <div className="mt-2 rounded-lg border border-border-strong bg-raised px-2.5 py-2">
      {showChips && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          <Chip active={filter === 'all'} onClick={() => onFilter('all')}>{`All ${tasks.length}`}</Chip>
          {bucketSegments(tasks).map((s) => (
            <Chip key={s.key} active={filter === s.key} onClick={() => onFilter(s.key as TaskBucket)}>
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-[2px]', MARK_BG[s.tone])} />
              {`${s.count} ${s.label}`}
            </Chip>
          ))}
        </div>
      )}
      <ul role="list" className="m-0 list-none p-0">
        {rows.slice(0, shown).map((task) => {
          const notice = task.notice_id ? notices?.[task.notice_id] : undefined;
          const host = task.agent_hostname || '—';
          const selected = task.id === selectedTaskId;
          return (
            <li
              key={task.id}
              onClick={() => onSelectTask(task.id)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-1.5 py-1',
                selected ? 'bg-accent-dim' : 'hover:bg-overlay',
                checkedTaskIds.includes(task.id) && !selected && 'bg-accent-dim/40',
              )}
            >
              {onToggleTask && (
                <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                  <Checkbox
                    aria-label={`Select ${host}`}
                    checked={checkedTaskIds.includes(task.id)}
                    onChange={() => onToggleTask(task.id)}
                  />
                </span>
              )}
              {/* The row's click selects; the button gives it focus and a name. */}
              <button
                type="button"
                data-task-mark=""
                aria-label={taskMarkLabel(task, notice)}
                aria-current={selected || undefined}
                className="flex min-w-0 flex-1 items-center gap-3 text-left outline-offset-2"
              >
                <span className="w-32 shrink-0 truncate font-mono text-xs" title={host}>{host}</span>
                <span className="inline-flex w-24 shrink-0 items-center"><TaskMarkBody task={task} notice={notice} /></span>
                <span className={cn('min-w-0 flex-1 truncate text-xs', MARK_TEXT[taskMarkTone(task)])}>
                  {resolveTaskStatusDisplay(task, notice).label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {formatDuration(task.result?.execution_duration_ms)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExtra({ filter, rows: shown - HOST_LIST_PAGE + HOST_LIST_STEP })}
          className="px-1.5 py-1 text-xs text-info hover:underline"
        >
          {`Show ${Math.min(hidden, HOST_LIST_STEP)} more`}
        </button>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-px text-[11px] transition-colors',
        active ? 'border-foreground text-foreground' : 'border-border text-muted hover:border-border-strong',
      )}
    >
      {children}
    </button>
  );
}
