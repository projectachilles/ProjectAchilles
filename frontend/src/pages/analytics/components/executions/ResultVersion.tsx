import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { EnrichedTestExecution, ResultVersionState } from '@/services/api/analytics';
import { formatTimestamp } from './shared';
import { VERSION_STATE_LABEL, shortCommit } from './versionLabels';

// `current` is the normal case: muted, so it never competes with the result colours.
const TONE: Record<ResultVersionState, string> = {
  current: 'text-muted',
  older: 'text-warning',
  unknown: 'text-muted',
  not_recorded: 'text-faint',
};

const CHIP_TONE: Record<ResultVersionState, string> = {
  current: 'border-border bg-raised text-muted',
  older: 'border-warning/30 bg-warning-dim text-warning',
  unknown: 'border-border bg-raised text-muted',
  not_recorded: 'border-border bg-raised text-faint',
};

const EXPLANATION: Partial<Record<ResultVersionState, string>> = {
  unknown: "This result's version could not be compared.",
  not_recorded: 'Recorded before versions were tracked.',
};

/** The test a result belongs to: the bundle for a stage / control, else its own uuid. */
function libraryUuid(exec: EnrichedTestExecution): string {
  return exec.bundle_id || exec.test_uuid.split('::')[0];
}

interface ResultVersionProps {
  exec: EnrichedTestExecution;
  /** The full block for the detail panel; the default is the one-line row form. */
  detail?: boolean;
}

/**
 * Which version of the test produced a result. Renders nothing when the
 * backend sent no `version_state` (it could not evaluate versions): that is
 * not the same as "not recorded".
 */
export function ResultVersion({ exec, detail = false }: ResultVersionProps) {
  const state = exec.version_state;
  if (!state) return null;
  const label = VERSION_STATE_LABEL[state];
  const commit = shortCommit(exec);

  if (!detail) {
    return (
      <span
        title={exec.test_version?.commit}
        className={cn('min-w-0 truncate whitespace-nowrap text-[11px]', TONE[state])}
      >
        {commit ? `${commit} ${label}` : label}
      </span>
    );
  }

  const version = exec.test_version;
  return (
    <div role="group" aria-label="Test version" className="border-b border-border p-4">
      <div className="text-[10px] uppercase tracking-wider text-faint">Test version</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {commit && (
          <span className="select-text font-mono text-foreground" title={version?.commit}>
            {commit}
          </span>
        )}
        <span
          className={cn(
            'inline-flex h-5 items-center whitespace-nowrap rounded border px-1.5 text-[11px] font-medium',
            CHIP_TONE[state],
          )}
        >
          {label}
        </span>
        {version?.commit_date && <span className="text-muted">source of {formatTimestamp(version.commit_date, false)}</span>}
        {version?.built_at && <span className="text-muted">built {formatTimestamp(version.built_at, false)}</span>}
        {version?.build_source === 'uploaded' && <span className="text-muted">uploaded binary</span>}
      </div>
      {state === 'older' && (
        <p className="mt-2 text-xs text-warning">
          A newer version of this test is synced.{' '}
          <Link to={`/tests/${libraryUuid(exec)}`} className="underline underline-offset-2 hover:text-foreground">
            Open test
          </Link>
        </p>
      )}
      {EXPLANATION[state] && <p className="mt-2 text-xs text-muted">{EXPLANATION[state]}</p>}
    </div>
  );
}
