import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type { ExtendedFilterParams, RiskAcceptance } from '@/services/api/analytics';
import { useCapabilities } from '@/hooks/useCapabilities';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ExecutionsDataTable, { type ExecutionsDataTableProps } from './ExecutionsDataTable';
import { RunDetailPanel } from './executions/RunDetailPanel';
import { useRunDetail } from './executions/useRunDetail';
import { useRunDetailDialogs } from './executions/RunDetailDialogs';
import type { DisplayRow } from './executions/shared';
import { CoverageMatrix, type PairRef } from './matrix/CoverageMatrix';
import { PairRuns } from './matrix/PairRuns';
import { SegmentHosts } from './matrix/SegmentHosts';
import { RunDrawer } from './matrix/RunDrawer';
import { parseHostKey } from './matrix/matrixModel';
import { useMatrixUrlState, type ExecutionsViewName } from './matrix/useMatrixUrlState';

/** Where the last chosen view is kept, per browser. */
const VIEW_STORAGE_KEY = 'achilles.executions.view';

function storedView(): ExecutionsViewName | null {
  try {
    const value = localStorage.getItem(VIEW_STORAGE_KEY);
    return value === 'matrix' || value === 'list' ? value : null;
  } catch {
    return null; // storage refused: the default view
  }
}

function rememberView(view: ExecutionsViewName): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // storage refused: the choice lasts for this visit, in the address
  }
}

export interface ExecutionsViewProps extends ExecutionsDataTableProps {
  /** The page's filters, for the matrix (it sends their scope only). */
  filterParams: ExtendedFilterParams;
  /** A new value reads the matrix again (the page's Refresh). */
  reloadToken: number;
  /** The list is shown whatever was chosen: an `expanded=` link, or the Outcome card's filter, which only narrows the list. */
  forceList: boolean;
  /** The user chose Matrix while the list was required: drop what required it. */
  onReleaseList: () => void;
}

/**
 * All Executions: the coverage matrix (the latest result per test and host)
 * or today's list. The matrix is the default where the server has it
 * (capability `coverageMatrix`); elsewhere there is no switch and only the list.
 */
export default function ExecutionsView({ filterParams, reloadToken, forceList, onReleaseList, ...table }: ExecutionsViewProps) {
  const capabilities = useCapabilities();
  const { view: viewInUrl, setView } = useMatrixUrlState();
  const [remembered, setRemembered] = useState(storedView);

  // Until the server has answered, neither: the list must not flash before the matrix.
  if (capabilities.loaded === false) {
    return (
      <Card className="flex min-h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </Card>
    );
  }
  if (!capabilities.coverageMatrix) return <ExecutionsDataTable {...table} />;

  const view: ExecutionsViewName = forceList ? 'list' : viewInUrl ?? remembered ?? 'matrix';
  const choose = (next: ExecutionsViewName) => {
    rememberView(next);
    setRemembered(next);
    if (next === 'matrix' && forceList) onReleaseList();
    setView(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="View" className="flex items-center gap-2 self-start">
        <span className="text-[12px] text-muted">View</span>
        <span className="inline-flex overflow-hidden rounded-md border border-border">
          {(['matrix', 'list'] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={view === name}
              onClick={() => choose(name)}
              className={cn(
                'px-3 py-1 text-xs font-medium transition-colors first:border-r first:border-border',
                view === name ? 'bg-accent-dim text-accent' : 'text-muted hover:bg-raised hover:text-foreground',
              )}
            >
              {name === 'matrix' ? 'Matrix' : 'List'}
            </button>
          ))}
        </span>
      </div>
      {view === 'list' ? (
        <ExecutionsDataTable {...table} />
      ) : (
        <MatrixView
          filterParams={filterParams}
          reloadToken={reloadToken}
          onAcceptRisk={table.onAcceptRisk}
          onRevokeRisk={table.onRevokeRisk}
          onArchive={table.onArchive}
          acceptingRisk={table.acceptingRisk}
          archiving={table.archiving}
        />
      )}
    </div>
  );
}

type MatrixViewProps = Pick<ExecutionsViewProps, 'filterParams' | 'reloadToken' | 'onAcceptRisk' | 'onRevokeRisk' | 'onArchive' | 'acceptingRisk' | 'archiving'>;

const runTitle = (row: DisplayRow) =>
  row.type === 'bundle' ? `${row.bundle_name} on ${row.hostname}` : `${row.execution.test_name} on ${row.execution.hostname}`;

/** The matrix, the open pair's runs under its row, and the selected run's detail in a drawer. */
function MatrixView({ filterParams, reloadToken, onAcceptRisk, onRevokeRisk, onArchive, acceptingRisk, archiving }: MatrixViewProps) {
  const { pair, setPair, runKey, setRunKey } = useMatrixUrlState();
  const detail = useRunDetail();
  const { prime, collapseControls } = detail;

  // After an archive or a risk change made here, the matrix and the runs are read again.
  const [changes, setChanges] = useState(0);
  const token = reloadToken + changes;

  const [pairRows, setPairRows] = useState<DisplayRow[]>([]);
  /** The pair was opened by a click: its latest run opens with it. A pair from an address opens the run the address names. */
  const openLatest = useRef(false);

  const index = runKey ? pairRows.findIndex((row) => row.key === runKey) : -1;
  const selectedRow = index >= 0 ? pairRows[index] : null;
  const selectedKey = selectedRow?.key ?? null;

  useEffect(() => {
    if (selectedRow) prime(selectedRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, prime]);

  // The acceptances that cover the runs on screen (the list page looks up its own page's).
  const [acceptances, setAcceptances] = useState<Map<string, RiskAcceptance[]>>(new Map());
  const testNames = [...new Set(pairRows.flatMap((row) => (row.type === 'bundle' ? row.controls.map((c) => c.test_name) : [row.execution.test_name])))].sort();
  const namesKey = JSON.stringify(testNames);
  useEffect(() => {
    const names = JSON.parse(namesKey) as string[];
    if (names.length === 0) {
      setAcceptances(new Map());
      return;
    }
    let current = true;
    analyticsApi
      .lookupAcceptances(names)
      .then((found) => {
        if (current) setAcceptances(new Map(Object.entries(found)));
      })
      .catch(() => {
        // The detail then shows no acceptance; accepting or revoking still reports its own error.
      });
    return () => {
      current = false;
    };
  }, [namesKey, token]);

  const openPair = (next: PairRef | null) => {
    openLatest.current = next !== null;
    setPairRows([]);
    setPair(next);
  };
  const selectRun = (row: DisplayRow) => {
    collapseControls();
    setRunKey(row.key);
  };
  const runsLoaded = (rows: DisplayRow[]) => {
    setPairRows(rows);
    if (openLatest.current && rows.length > 0) {
      openLatest.current = false;
      setRunKey(rows[0].key);
    }
  };

  const afterChange = () => setChanges((n) => n + 1);
  const dialogs = useRunDetailDialogs({
    riskAcceptances: acceptances,
    onAcceptRisk: onAcceptRisk && (async (items, justification) => {
      await onAcceptRisk(items, justification);
      afterChange();
    }),
    onRevokeRisk: onRevokeRisk && (async (id, reason) => {
      await onRevokeRisk(id, reason);
      afterChange();
    }),
    onArchive,
    acceptingRisk,
    archiving,
    onArchived: () => {
      setRunKey(null);
      afterChange();
    },
  });

  return (
    <>
      <CoverageMatrix
        params={filterParams}
        reloadToken={token}
        openPair={pair}
        onOpenPair={openPair}
        renderPair={(open, test, host) => {
          const fromKey = parseHostKey(open.hostKey);
          return (
            <PairRuns
              scope={filterParams}
              pair={open}
              testName={test.name}
              hostname={host?.hostname ?? fromKey.hostname}
              org={host ? host.org : fromKey.org}
              selectedRunKey={selectedKey}
              onSelectRun={selectRun}
              onRunsLoaded={runsLoaded}
              reloadToken={token}
              showVersions={detail.panelProps.showVersions}
            />
          );
        }}
        renderSegment={(test, state) => <SegmentHosts params={filterParams} test={test} state={state} onOpenPair={openPair} />}
      />
      <RunDrawer
        open={selectedRow !== null}
        title={selectedRow ? runTitle(selectedRow) : ''}
        onClose={() => setRunKey(null)}
        onPrevious={index > 0 ? () => selectRun(pairRows[index - 1]) : undefined}
        onNext={index >= 0 && index < pairRows.length - 1 ? () => selectRun(pairRows[index + 1]) : undefined}
        suspended={dialogs.anyOpen}
      >
        {selectedRow && <RunDetailPanel row={selectedRow} {...detail.panelProps} {...dialogs.panelProps} />}
      </RunDrawer>
      {dialogs.dialogs}
    </>
  );
}
