import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Alert } from '@/components/shared/ui/Alert';
import type { InstallReadiness } from '@/types/agent';

interface TaskReadinessChecklistProps {
  /** A completed binary check (step 1). The checklist is only shown once there is one. */
  readiness: InstallReadiness;
  /** Built tests (step 3): a count, or why there is none yet. */
  builtTests: number | 'loading' | 'unknown';
}

type StepState = 'done' | 'todo' | 'blocked' | 'unknown';

const primaryLinkClass =
  'inline-flex h-9 shrink-0 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover';
const outlineLinkClass =
  'inline-flex h-9 shrink-0 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-foreground transition-colors hover:bg-raised';

function Step({ n, state, title, status, action }: {
  n: number;
  state: StepState;
  title: string;
  status: string;
  action?: ReactNode;
}): React.ReactElement {
  const marker =
    state === 'done' ? 'border-accent/40 bg-accent-dim text-accent'
      : state === 'todo' ? 'border-warning text-warning'
        : 'border-border-strong text-muted';
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold ${marker}`}>
        {state === 'done' ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className={`text-xs ${state === 'todo' ? 'text-warning' : 'text-muted'}`}>{status}</div>
      </div>
      {action}
    </li>
  );
}

/**
 * Shown in the task dialog in place of the agent picker when no agent is
 * enrolled: what a test needs before it can run, and where to fix each part.
 */
export function TaskReadinessChecklist({ readiness, builtTests }: TaskReadinessChecklistProps): React.ReactElement {
  const readyCount = readiness.platforms.filter((p) => p.ready).length;
  const total = readiness.platforms.length;
  const binaryMissing = readyCount === 0;

  const binaryStatus = binaryMissing
    ? 'Missing: no platform has one'
    : `Ready for ${readyCount} of ${total} platforms`;

  // A failed test list is not "no test built".
  const testsStatus =
    builtTests === 'loading' ? 'Checking…'
      : builtTests === 'unknown' ? 'Could not check'
        : builtTests === 0 ? 'No test is built yet'
          : `${builtTests} ${builtTests === 1 ? 'test' : 'tests'} built and ready`;

  return (
    <div className="space-y-3">
      <Alert variant="warning" title="This task has nothing to run on yet">
        <span className="text-foreground">
          A test runs on an enrolled endpoint. Finish the steps below, then come back.
        </span>
      </Alert>
      <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
        <Step
          n={1}
          state={binaryMissing ? 'todo' : 'done'}
          title="Agent binary on this server"
          status={binaryStatus}
          action={binaryMissing && (
            <Link to="/settings?tab=agent" className={primaryLinkClass}>Build or upload</Link>
          )}
        />
        <Step
          n={2}
          state={binaryMissing ? 'blocked' : 'todo'}
          title="Enrolled endpoint"
          status={binaryMissing ? '0 active agents. Needs step 1 first.' : '0 active agents.'}
          action={<Link to="/agents" className={binaryMissing ? outlineLinkClass : primaryLinkClass}>Enroll an agent</Link>}
        />
        <Step
          n={3}
          state={typeof builtTests !== 'number' ? 'unknown' : builtTests === 0 ? 'todo' : 'done'}
          title="Built test"
          status={testsStatus}
        />
      </ol>
    </div>
  );
}
