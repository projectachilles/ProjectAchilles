import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/shared/ui/Button';
import { useBuildQueue } from '@/hooks/useBuildQueue';
import type { BuildQueueState } from '@/hooks/useBuildQueue';

interface BuildQueueBarProps {
  /** Called once for each result the run adds (the version rows reload on it). */
  onResult?: () => void;
}

function counts(results: BuildQueueState['results']) {
  let built = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.outcome === 'built') built += 1;
    else if (r.outcome === 'failed') failed += 1;
    else skipped += 1;
  }
  return { built, failed, skipped };
}

function stoppedLine(state: BuildQueueState): string | null {
  const notStarted = state.total - state.results.length;
  if (state.end === 'completed' || state.end == null || notStarted <= 0) return null;
  if (state.end === 'unreachable') return `Stopped: the server could not be reached. ${notStarted} not started`;
  return `Stopped: ${notStarted} not started`;
}

/** Progress of a build run started from the Test Library, then its summary. */
export function BuildQueueBar({ onResult }: BuildQueueBarProps) {
  const { state, stop, dismiss } = useBuildQueue();
  // Details stay open for the results they were opened on; a new run's results fold them.
  const [detailsFor, setDetailsFor] = useState<BuildQueueState['results'] | null>(null);
  const showDetails = detailsFor === state.results;

  const resultCount = state.results.length;
  const seenRef = useRef(resultCount);
  useEffect(() => {
    if (resultCount > seenRef.current) onResult?.();
    seenRef.current = resultCount;
  }, [resultCount, onResult]);

  if (state.status === 'idle') return null;

  const { built, failed, skipped } = counts(state.results);

  if (state.status === 'done') {
    const problems = state.results.filter((r) => r.outcome !== 'built');
    const stopped = stoppedLine(state);
    return (
      <section aria-label="Build run" className="mb-4 rounded-[10px] border border-border bg-surface px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
            <span className={failed > 0 ? 'text-warning' : 'text-foreground'}>
              {`Built ${built} of ${resultCount} · ${failed} failed · ${skipped} skipped`}
            </span>
            {stopped && (
              <span className={state.end === 'unreachable' ? 'text-warning' : 'text-muted'}>{stopped}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {problems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showDetails}
                onClick={() => setDetailsFor(showDetails ? null : state.results)}
              >
                Details
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </div>
        {showDetails && problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            {problems.map((r) => (
              <li key={r.uuid} className="min-w-0 break-words">
                <Link to={`/tests/${r.uuid}`} className="text-accent hover:underline">
                  {r.name}
                </Link>
                <span className={r.outcome === 'failed' ? 'text-warning' : 'text-muted'}>
                  {r.outcome === 'failed' ? ' · Failed' : ' · Skipped'}
                </span>
                {r.reason && <span className="text-muted">{`: ${r.reason}`}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const stopping = state.status === 'stopping';
  const position = Math.min(resultCount + 1, state.total);
  const percent = state.total > 0 ? Math.round((resultCount / state.total) * 100) : 0;
  return (
    <section aria-label="Build run" className="mb-4 rounded-[10px] border border-border bg-surface px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div aria-live="polite" className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <span className="break-words text-foreground">
            {`Building ${position} of ${state.total}${state.current ? ` · ${state.current.name}` : ''}`}
          </span>
          <span className="text-muted">{`${built} built · ${failed} failed · ${skipped} skipped`}</span>
          {stopping && <span className="text-muted">Stopping after this build</span>}
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={stop} disabled={stopping}>
          Stop
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Build progress"
        aria-valuemin={0}
        aria-valuemax={state.total}
        aria-valuenow={resultCount}
        className="mt-2 h-1 overflow-hidden rounded bg-raised"
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
