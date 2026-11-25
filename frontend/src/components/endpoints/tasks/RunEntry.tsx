import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TaskGroup } from '@/types/agent';
import type { TaskBucket } from '@/utils/testOutcome';
import { cn } from '@/lib/utils';
import { Checkbox } from '../../shared/ui/Checkbox';
import { VerdictBar } from '../../shared/marks/VerdictBar';
import { MARK_BG } from '../../shared/marks/markTone';
import { RunHostList, type HostListFilter } from './RunHostList';
import { TaskMark } from './TaskMark';
import { agentCountLabel, bucketSegments, railTone, runForm, runIdOf, runTimeLabel } from './runMarks';
import { runName } from './taskFormat';

export interface RunEntryProps {
  group: TaskGroup;
  /** The task whose detail is shown, wherever it is on the page. */
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  /** Tasks ticked for a bulk action. */
  checkedTaskIds: string[];
  onToggleTask?: (taskId: string) => void;
  /** Called with the run's id (runIdOf). */
  onToggleGroup?: (runId: string) => void;
}

/**
 * One run on the Tasks timeline: its name once, then a mark per task. Up to
 * 8 tasks are named pills, up to 80 are squares, more are one bar. The host
 * list (open from "Show hosts" or a bar segment) is the same tasks as rows.
 */
export function RunEntry({ group, selectedTaskId, onSelectTask, checkedTaskIds, onToggleTask, onToggleGroup }: RunEntryProps) {
  // Which host list is open. Kept here: the parent keys entries by run id, so a refresh does not close it.
  const [opened, setOpen] = useState<HostListFilter | null>(null);

  const { tasks, notices } = group;
  const form = runForm(tasks.length);
  const { text: name, command: isCommand } = runName(group);
  // A command can be hundreds of characters; labels read aloud stay short.
  const shortName = name.length > 80 ? `${name.slice(0, 80)}…` : name;
  const time = runTimeLabel(group);
  const segments = bucketSegments(tasks);
  // A refresh can empty the open segment (the last task in progress finishes):
  // show every task then, not an empty box.
  const open = opened !== null && opened !== 'all' && !segments.some((s) => s.key === opened) ? 'all' : opened;
  const partial = new Set(tasks.map((t) => t.agent_id)).size < group.agent_count;
  const runTags = Array.from(new Set(Object.values(notices ?? {}).map((n) => n.run_tag))).join(', ');
  const noticeOf = (noticeId?: string | null) => (noticeId ? notices?.[noticeId] : undefined);

  return (
    <section role="group" aria-label={`${shortName}, ${time}`} className="flex gap-2.5 px-4">
      <div aria-hidden="true" className="relative w-3.5 shrink-0">
        <span className="absolute bottom-0 left-1.5 top-0 w-px bg-border-strong" />
        <span className={cn('absolute left-0.5 top-3 h-[9px] w-[9px] rounded-full ring-[3px] ring-surface', MARK_BG[railTone(tasks)])} />
      </div>

      {/* A container, so the header adapts to the width of the list, not of the window. */}
      <div className="@container min-w-0 flex-1 py-2">
        {/* In a narrow list the name takes a line of its own: a time range, a count and a run tag fill one line of a phone. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {onToggleGroup && (
            <Checkbox
              aria-label={`Select every task of ${shortName}`}
              checked={tasks.length > 0 && tasks.every((t) => checkedTaskIds.includes(t.id))}
              onChange={() => onToggleGroup(runIdOf(group))}
            />
          )}
          <span className="shrink-0 font-mono text-xs text-muted">{time}</span>
          <span aria-hidden="true" className="flex-1 @lg:hidden" />
          <span
            className={cn(
              'order-last min-w-0 basis-full truncate @lg:order-none @lg:flex-1 @lg:basis-0',
              isCommand ? 'font-mono text-xs' : 'text-[13px] font-medium',
            )}
            title={name}
          >
            {name}
          </span>
          {(form !== 'named' || partial) && (
            <span className="shrink-0 font-mono text-[11px] text-faint">{agentCountLabel(group)}</span>
          )}
          {runTags && <span className="shrink-0 font-mono text-[11px] text-muted">{runTags}</span>}
          {tasks.length > 1 && (
            <button
              type="button"
              aria-expanded={open !== null}
              aria-label={open !== null ? 'Hide hosts' : 'Show hosts'}
              title={open !== null ? 'Hide hosts' : 'Show hosts'}
              onClick={() => setOpen(open !== null ? null : 'all')}
              className="shrink-0 rounded p-0.5 text-faint hover:text-foreground"
            >
              {open !== null ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {form === 'bar' ? (
          <VerdictBar
            className="mt-2"
            segments={segments}
            activeKey={open !== null && open !== 'all' ? open : null}
            onSelect={(key) => setOpen(open === key ? null : (key as TaskBucket))}
          />
        ) : (
          <div className={cn('mt-1.5 flex flex-wrap', form === 'named' ? 'gap-1.5' : 'gap-[3px]')}>
            {tasks.map((task) => (
              <TaskMark
                key={task.id}
                task={task}
                notice={noticeOf(task.notice_id)}
                form={form}
                selected={task.id === selectedTaskId}
                checked={checkedTaskIds.includes(task.id)}
                onSelect={onSelectTask}
              />
            ))}
          </div>
        )}
        {form === 'squares' && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
            {segments.map((s) => (
              <span key={s.key}>{`${s.count} ${s.label}`}</span>
            ))}
          </div>
        )}

        {open !== null && (
          <RunHostList
            tasks={tasks}
            notices={notices}
            filter={open}
            onFilter={setOpen}
            showChips={form !== 'bar'}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            checkedTaskIds={checkedTaskIds}
            onToggleTask={onToggleTask}
          />
        )}
      </div>
    </section>
  );
}
