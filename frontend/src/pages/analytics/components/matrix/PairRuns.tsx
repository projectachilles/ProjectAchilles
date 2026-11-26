import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type { ExtendedFilterParams } from '@/services/api/analytics';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { joinFilterList } from '@/lib/filterList';
import { StageSquares } from '@/components/shared/marks/StageSquares';
import { BundleResultLabel, ExecResultLabel, formatTimestamp, mapGroupsToDisplayRows, type DisplayRow } from '../executions/shared';
import { stageSquareMarks } from '../executions/stageDisplay';
import { ResultVersion } from '../executions/ResultVersion';
import type { PairRef } from './MatrixRow';

/** Runs asked for at a time. */
export const PAIR_RUNS_PAGE = 25;

interface PairRunsProps {
  /** The page's filters; only the window and the organization are used. */
  scope: ExtendedFilterParams;
  pair: PairRef;
  testName: string;
  hostname: string;
  /** The host's organization, for a page with none selected. */
  org: string | null;
  selectedRunKey: string | null;
  onSelectRun: (row: DisplayRow) => void;
  /** Every run loaded so far, latest first (the drawer moves through them). */
  onRunsLoaded: (rows: DisplayRow[]) => void;
  /** Close this pair: the only way to in the bar form, where no mark stands for it. */
  onClose: () => void;
  /** A new value loads the runs again. */
  reloadToken: number;
  showVersions?: boolean;
}

/**
 * The runs of one test on one host in the window, latest first. Each run has
 * the verdict the List view gives it (the same label components), and a
 * chain's stages as squares. Selecting one opens its detail.
 */
export function PairRuns({ scope, pair, testName, hostname, org, selectedRunKey, onSelectRun, onRunsLoaded, onClose, reloadToken, showVersions = false }: PairRunsProps) {
  // Only the window and the organization: the other filters chose the matrix's
  // rows, and a technique or outcome filter would hide stages of a run.
  const organization = scope.org ?? org ?? undefined;
  const query = JSON.stringify({
    from: scope.from,
    to: scope.to,
    ...(organization ? { org: organization } : {}),
    testUuid: pair.testUuid,
    // One hostname of a comma-separated list parameter.
    hostnames: joinFilterList([hostname]),
  });

  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const loaded = useRef<{ query: string; reloadToken: number } | null>(null);
  /** The rows on screen, for appending a page outside a state updater. */
  const shown = useRef<DisplayRow[]>([]);
  const reported = useRef(onRunsLoaded);
  reported.current = onRunsLoaded;

  useEffect(() => {
    const id = ++request.current;
    // Another pair or a reload starts over from the first page; "show more" appends.
    const fresh = loaded.current?.query !== query || loaded.current.reloadToken !== reloadToken;
    const wanted = fresh ? 1 : page;
    if (loaded.current?.query !== query) {
      shown.current = [];
      setRows([]);
    }
    if (fresh && page !== 1) setPage(1);
    loaded.current = { query, reloadToken };
    setLoading(true);
    setFailed(false);
    analyticsApi
      .getGroupedPaginatedExecutions({
        ...(JSON.parse(query) as ExtendedFilterParams & { testUuid: string }),
        page: wanted,
        pageSize: PAIR_RUNS_PAGE,
        sortField: 'routing.event_time',
        sortOrder: 'desc',
      })
      .then((response) => {
        if (id !== request.current) return;
        const next = mapGroupsToDisplayRows(response.groups);
        setTotal(response.pagination?.totalGroups ?? next.length);
        const prev = wanted === 1 ? [] : shown.current;
        const all = [...prev, ...next.filter((r) => !prev.some((p) => p.key === r.key))];
        shown.current = all;
        setRows(all);
        reported.current(all);
      })
      .catch(() => {
        if (id === request.current) setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // An answer that arrives after this pair was closed, or replaced, is nobody's:
    // reporting it would open a run of a pair that is no longer the open one.
    return () => {
      if (request.current === id) request.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, reloadToken, page, attempt]);

  const remaining = Math.min(PAIR_RUNS_PAGE, total - rows.length);

  return (
    <div role="group" aria-label={`Runs of ${testName} on ${hostname}`} className="rounded-md border border-border bg-raised/40 p-2">
      <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-muted">
        <span className="font-mono text-foreground">{hostname}</span>
        {!failed && !(loading && rows.length === 0) && rows.length > 0 && (
          <span>{total} run{total === 1 ? '' : 's'} in this window</span>
        )}
        {loading && <Loader2 role="status" aria-label="Loading runs" className="h-3 w-3 animate-spin" />}
        <button
          type="button"
          aria-label={`Close the runs of ${hostname}`}
          title="Close"
          onClick={onClose}
          className="ml-auto rounded-sm p-0.5 text-muted outline-offset-1 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {failed && (
        <div role="alert" className="flex items-center gap-3 px-1 py-1 text-xs text-warning">
          <span>The runs could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </div>
      )}
      {!failed && !loading && rows.length === 0 && <p className="px-1 py-1 text-xs text-faint">No runs in this window</p>}

      <ul className="flex flex-col">
        {rows.map((row) => {
          const selected = row.key === selectedRunKey;
          const timestamp = row.type === 'bundle' ? row.timestamp : row.execution.timestamp;
          const stages = row.type === 'bundle' && row.category !== 'cyber-hygiene' ? stageSquareMarks(row.controls) : null;
          const versionExec = row.type === 'bundle' ? (row.versionExec ?? row.controls[0]) : row.execution;
          return (
            <li key={row.key}>
              <button
                type="button"
                data-pair-run
                aria-current={selected || undefined}
                onClick={() => onSelectRun(row)}
                className={cn(
                  'flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1.5 text-left outline-offset-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                  selected ? 'bg-accent-dim shadow-[inset_3px_0_0_var(--color-accent)]' : 'hover:bg-raised',
                )}
              >
                <span className="font-mono text-[11px] text-muted">{formatTimestamp(timestamp, false)}</span>
                <span className="text-[11px] text-faint">{formatTimestamp(timestamp)}</span>
                {stages && stages.length > 0 && <StageSquares marks={stages} />}
                {row.type === 'bundle' ? <BundleResultLabel group={row} compact /> : <ExecResultLabel exec={row.execution} compact />}
                {showVersions && versionExec && <ResultVersion exec={versionExec} />}
              </button>
            </li>
          );
        })}
      </ul>

      {!failed && !loading && remaining > 0 && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setPage((n) => n + 1)}>
          Show {remaining} more
        </Button>
      )}
    </div>
  );
}
