import type { AgentTask, NoticeSummary } from '@/types/agent';
import { resolveTaskStatusDisplay } from '@/utils/taskStatusDisplay';
import { stageMarks, taskBucket } from '@/utils/testOutcome';
import { cn } from '@/lib/utils';
import { StageSquares } from '../../shared/marks/StageSquares';
import { MARK_BG, MARK_TEXT } from '../../shared/marks/markTone';
import { taskMarkTone } from './runMarks';

/** "<hostname>: <outcome or status>", the accessible name of a task's mark. */
export function taskMarkLabel(task: AgentTask, notice?: NoticeSummary): string {
  const display = resolveTaskStatusDisplay(task, notice);
  const finishedOther = task.type !== 'execute_test' && task.result && taskBucket(task) !== 'in-progress';
  return `${task.agent_hostname || '—'}: ${display.label}${finishedOther ? `, exit ${task.result?.exit_code}` : ''}`;
}

/**
 * What a task shows next to its hostname: its stages, one square for a test
 * without stages, the status while it runs, or the exit of a command.
 */
export function TaskMarkBody({ task, notice }: { task: AgentTask; notice?: NoticeSummary }) {
  const stages = stageMarks(task);
  if (stages) return <StageSquares marks={stages} />;

  const tone = taskMarkTone(task);
  const bucket = taskBucket(task);
  const display = resolveTaskStatusDisplay(task, notice);
  if (bucket === 'in-progress') {
    return <span className={cn('text-[11px]', MARK_TEXT[tone])}>{display.label.toLowerCase().replace(/…$/, '')}…</span>;
  }
  if (task.type === 'execute_test') {
    return <span aria-hidden="true" className={cn('h-[9px] w-[9px] shrink-0 rounded-[2px]', MARK_BG[tone])} />;
  }
  return (
    <span className={cn('text-[11px]', MARK_TEXT[tone])}>
      {bucket === 'completed' ? '✓' : '✕'} {task.result ? `exit ${task.result.exit_code}` : display.label.toLowerCase()}
    </span>
  );
}

interface TaskMarkProps {
  task: AgentTask;
  notice?: NoticeSummary;
  /** 'named': a pill with the hostname. 'squares': one small square. */
  form: 'named' | 'squares';
  /** This task's detail is the one shown. */
  selected: boolean;
  /** This task is ticked for a bulk action. */
  checked: boolean;
  onSelect: (taskId: string) => void;
}

/** One task of a run, as a button that opens its detail. */
export function TaskMark({ task, notice, form, selected, checked, onSelect }: TaskMarkProps) {
  const label = taskMarkLabel(task, notice);
  const shared = {
    type: 'button' as const,
    'data-task-mark': '',
    'aria-label': label,
    'aria-current': selected || undefined,
    title: label,
    onClick: () => onSelect(task.id),
  };

  if (form === 'squares') {
    return (
      <button
        {...shared}
        className={cn(
          'h-3.5 w-3.5 rounded-[3px] outline-offset-1 hover:outline hover:outline-1 hover:outline-foreground',
          MARK_BG[taskMarkTone(task)],
          checked && 'ring-1 ring-accent/60 ring-offset-1 ring-offset-surface',
          selected && 'outline outline-2 outline-accent',
        )}
      />
    );
  }

  return (
    <button
      {...shared}
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-raised px-2 py-[3px] outline-offset-1 transition-colors hover:border-border-strong',
        checked && 'ring-1 ring-accent/60',
        selected && 'border-accent bg-accent-dim outline outline-2 outline-accent',
      )}
    >
      <span className={cn('truncate font-mono text-[11px]', selected ? 'text-foreground' : 'text-muted')}>
        {task.agent_hostname || '—'}
      </span>
      <TaskMarkBody task={task} notice={notice} />
    </button>
  );
}
