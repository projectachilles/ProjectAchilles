import { useMemo, type ReactNode } from 'react';
import { VerdictBar } from '@/components/shared/marks/VerdictBar';
import type { MatrixHost, MatrixTestRow, MatrixVerdict } from '@/services/api/analytics';
import { MatrixCellMark } from './MatrixCellMark';
import { caughtLine, rowSegments, VERDICT_META, type MatrixForm } from './matrixModel';

/** One test on one host, by the keys the server gives them. */
export interface PairRef {
  testUuid: string;
  hostKey: string;
}

/** Label column and strip: the same two columns on the header and on every row, so hosts line up. */
export const ROW_GRID = 'grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]';

/** Columns of the strip: one per host, all the same width. */
export function stripColumns(hostCount: number, form: MatrixForm): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.max(hostCount, 1)}, minmax(0, 1fr))`,
    gap: form === 'tile' ? 4 : form === 'small' ? 3 : 1,
  };
}

const KIND_BADGE: Record<MatrixTestRow['kind'], string | null> = { test: null, chain: 'chain', controls: 'bundle' };
const isVerdict = (key: string): key is MatrixVerdict => key in VERDICT_META;

interface MatrixRowProps {
  test: MatrixTestRow;
  hosts: MatrixHost[];
  form: MatrixForm;
  /** The open pair's host key when it belongs to this row. */
  openHostKey: string | null;
  onToggleHost: (hostKey: string) => void;
  /** Bar form: the state whose hosts are listed under this row. */
  openState: MatrixVerdict | null;
  onToggleState: (state: MatrixVerdict) => void;
  /** What is open under this row: a pair's runs, or a segment's hosts. */
  children?: ReactNode;
  now: number;
}

/** One test: its name once, what was caught, and its hosts as marks or as one bar. */
export function MatrixRow({ test, hosts, form, openHostKey, onToggleHost, openState, onToggleState, children, now }: MatrixRowProps) {
  const cells = useMemo(() => new Map((test.cells ?? []).map((cell) => [cell.i, cell])), [test.cells]);
  const badge = KIND_BADGE[test.kind];
  const segments = rowSegments(test).filter((s) => s.key !== 'never_run');
  const neverRun = test.counts.neverRun;

  return (
    <div data-matrix-row className="border-t border-border py-2">
      <div className={ROW_GRID}>
        <div className="min-w-0">
          <div className="flex items-start gap-1.5">
            {/* Two lines, then cut: one line left about 30 characters of a name at the usual width. */}
            <h3 title={test.name} className="line-clamp-2 min-w-0 break-words text-[13px] font-medium leading-snug text-foreground">{test.name}</h3>
            {badge && <span className="mt-px shrink-0 rounded-sm border border-border px-1 text-[10px] uppercase tracking-wide text-faint">{badge}</span>}
          </div>
          <p className="truncate text-[11px] text-faint">{caughtLine(test)}</p>
        </div>

        {form === 'bar' ? (
          <div className="min-w-0">
            <VerdictBar
              segments={segments}
              activeKey={openState}
              // A bundle's bar counts controls: there is no host list behind a segment.
              onSelect={test.kind === 'controls' ? undefined : (key) => { if (isVerdict(key)) onToggleState(key); }}
            />
            {neverRun > 0 && <p className="mt-1 text-[11px] text-faint">{neverRun} never run</p>}
          </div>
        ) : (
          <div style={stripColumns(hosts.length, form)} className="min-w-0 items-center justify-items-center">
            {hosts.map((host, i) => (
              <MatrixCellMark
                key={host.key}
                form={form}
                host={host}
                cell={cells.get(i)}
                open={openHostKey === host.key}
                onToggle={() => onToggleHost(host.key)}
                now={now}
              />
            ))}
          </div>
        )}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
