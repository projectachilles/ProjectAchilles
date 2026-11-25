/**
 * Detail of the selected task: verdict, facts, output, and its actions.
 * Moved as is out of TaskStream so the list beside it can change shape
 * without touching what a task's detail shows.
 */

import { useState } from 'react';
import { FileText, Maximize2, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AgentTask, NoticeSummary } from '@/types/agent';
import { resolveTaskStatusDisplay } from '@/utils/taskStatusDisplay';
import { EXIT_MEANING, TONE_TEXT, testOutcome } from '@/utils/testOutcome';
import { Button } from '../../shared/ui/Button';
import { CopyButton } from '../../shared/ui/CopyButton';
import TaskStatusBadge from './TaskStatusBadge';
import { formatDuration, normalizeUtc, taskName } from './taskFormat';
import { cn } from '@/lib/utils';

export interface TaskDetailPanelProps {
  task: AgentTask;
  /** The pre-execution notice holding this task, if any. */
  notice?: NoticeSummary;
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onOpenNotes?: (task: AgentTask) => void;
  /** Scroll inside the panel instead of growing the page (large screens). */
  fill?: boolean;
}

const ACTIVE_STATUSES = new Set(['pending', 'assigned', 'downloading', 'executing']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired']);

/** Mirror of the backend gate: only terminal execute_test tasks can be retried. */
function isRetryable(task: AgentTask): boolean {
  return task.type === 'execute_test' && TERMINAL_STATUSES.has(task.status);
}

/** stdout/stderr box — click (or the corner icon) opens the expanded viewer. */
function OutputBlock({
  label,
  text,
  maxHeightClass,
  onExpand,
}: {
  label: string;
  text: string | undefined;
  maxHeightClass: string;
  onExpand: () => void;
}) {
  return (
    <div className="group">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-faint">{label}</span>
        <span className="flex items-center gap-1">
          <CopyButton text={text ?? ''} ariaLabel={`Copy ${label}`} disabled={!text} />
          <Maximize2 className="h-3 w-3 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        </span>
      </div>
      <pre
        role="button"
        tabIndex={0}
        title="Click to expand"
        onClick={onExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onExpand();
        }}
        className={`${maxHeightClass} cursor-zoom-in overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed transition-colors group-hover:border-border-strong`}
      >
        {text || '(empty)'}
      </pre>
    </div>
  );
}

export default function TaskDetailPanel({ task, notice, onCancel, onRetry, onDelete, onOpenNotes, fill = false }: TaskDetailPanelProps) {
  const [outputView, setOutputView] = useState<{ label: string; task: string; text: string } | null>(null);
  const outcome = testOutcome(task);
  // What a command task ran. The list names the run by it; here it is shown whole.
  const command = task.type === 'execute_command' ? task.payload?.command?.trim() : undefined;

  return (
    <>
      <div className={cn('rounded-lg border border-border bg-surface', fill ? 'lg:min-h-0 lg:overflow-auto' : 'overflow-hidden')}>
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[15px] font-semibold leading-snug">{taskName(task)}</h3>
            <TaskStatusBadge task={task} notice={notice} className="shrink-0 font-mono uppercase" />
          </div>
          <div className="mt-1 font-mono text-[11px] text-faint">
            {task.type} · batch {task.batch_id.slice(0, 8)}
            {(task.retry_count ?? 0) > 0 && (
              <span className="text-warning"> · retry {task.retry_count}/{task.max_retries ?? 2}</span>
            )}
          </div>
          {outcome && outcome.basis !== 'exit' && (
            <p className={cn('mt-2 text-xs', TONE_TEXT[outcome.tone])}>{outcome.title}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-border p-4 md:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-faint">Agent</div>
            <div className="mt-0.5 font-mono text-xs">{task.agent_hostname ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-faint">Duration</div>
            <div className="mt-0.5 font-mono text-xs">
              {formatDuration(task.result?.execution_duration_ms)}
            </div>
          </div>
          <div>
            {/* A bundle's exit is its last stage's, not the verdict: label it so, and don't colour it as the outcome. */}
            <div className="text-[10px] uppercase tracking-wider text-faint">
              {outcome?.basis === 'stages' ? 'Final exit' : 'Exit code'}
            </div>
            <div
              className={cn(
                'mt-0.5 font-mono text-xs',
                outcome
                  ? outcome.basis === 'exit' && TONE_TEXT[outcome.tone]
                  : task.result && task.result.exit_code !== 0 && 'text-danger',
              )}
            >
              {task.result?.exit_code ?? '—'}
              {outcome && task.result && EXIT_MEANING[task.result.exit_code] && (
                <span className="text-muted"> · {EXIT_MEANING[task.result.exit_code]}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-faint">Created</div>
            <div className="mt-0.5 font-mono text-xs">
              {new Date(normalizeUtc(task.created_at)).toLocaleString()}
            </div>
          </div>
          {task.created_by_label && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-[10px] uppercase tracking-wider text-faint">Requested by</div>
              <div className="mt-0.5 truncate text-xs" title={task.created_by_label}>
                {task.created_by_label}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 p-4">
          {command && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-faint">Command</span>
                <CopyButton text={command} ariaLabel="Copy command" />
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
                {command}
              </pre>
            </div>
          )}
          {task.result?.error && (
            <div className="flex items-center gap-2 rounded-md bg-danger-dim p-2 text-sm text-danger">
              <XCircle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{task.result.error}</span>
            </div>
          )}
          {task.result ? (
            <>
              {task.result.compacted_at && (
                <div className="rounded-md bg-info-dim p-2 text-xs text-muted" data-testid="output-compacted-notice">
                  Full output removed by the retention policy on{' '}
                  {new Date(normalizeUtc(task.result.compacted_at)).toLocaleString()}. Exit code and stage
                  results are kept.
                </div>
              )}
              <OutputBlock
                label="stdout"
                text={task.result.stdout}
                maxHeightClass="max-h-44"
                onExpand={() =>
                  setOutputView({ label: 'stdout', task: taskName(task), text: task.result?.stdout ?? '' })
                }
              />
              <OutputBlock
                label="stderr"
                text={task.result.stderr}
                maxHeightClass="max-h-32"
                onExpand={() =>
                  setOutputView({ label: 'stderr', task: taskName(task), text: task.result?.stderr ?? '' })
                }
              />
            </>
          ) : (
            <div className="flex h-20 items-center justify-center text-sm text-faint">
              No result yet — task is {resolveTaskStatusDisplay(task).label.toLowerCase()}.
            </div>
          )}
          <div className="flex gap-2">
            {onRetry && isRetryable(task) && (
              <Button variant="secondary" size="sm" onClick={() => onRetry(task.id)}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            {onCancel && ACTIVE_STATUSES.has(task.status) && (
              <Button variant="secondary" size="sm" onClick={() => onCancel(task.id)}>
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
            {onOpenNotes && (
              <Button variant="outline" size="sm" onClick={() => onOpenNotes(task)}>
                <FileText className="mr-1 h-3.5 w-3.5" />
                Notes{task.notes ? ' •' : ''}
              </Button>
            )}
            {/* Only a finished task can be deleted (the backend archives it); cancel an active one. */}
            {onDelete && TERMINAL_STATUSES.has(task.status) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                onClick={() => onDelete(task.id)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded output viewer */}
    <Dialog open={outputView !== null} onOpenChange={(open) => !open && setOutputView(null)}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 pr-8">
          <DialogTitle className="min-w-0 truncate font-mono text-sm">
            <span className="uppercase text-faint">{outputView?.label}</span>
            <span className="ml-2 font-sans text-foreground">{outputView?.task}</span>
          </DialogTitle>
          <CopyButton
            text={outputView?.text ?? ''}
            label="Copy all"
            variant="accent"
            ariaLabel={`Copy all ${outputView?.label ?? 'output'}`}
            disabled={!outputView?.text}
          />
        </DialogHeader>
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-4 font-mono text-xs leading-relaxed">
          {outputView?.text || '(empty)'}
        </pre>
      </DialogContent>
    </Dialog>
    </>
  );
}
