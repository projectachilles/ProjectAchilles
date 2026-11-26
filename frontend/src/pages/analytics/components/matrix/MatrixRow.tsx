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

/** What is listed under a bar: the hosts of one state, or every host of a bundle. */
export type OpenSegment = MatrixVerdict | 'all';

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
  /** The row's position, for the arrow keys. */
  index: number;
  hosts: MatrixHost[];
  form: MatrixForm;
  /** The open pair's host key when it belongs to this row. */
  openHostKey: string | null;
  /** `at`: the time of the result the mark shows. */
  onToggleHost: (hostKey: string, at: string) => void;
  /** Bar form: what is listed under this row. */
  openSegment: OpenSegment | null;
  onToggleSegment: (segment: OpenSegment) => void;
  /** What is open under this row: a segment's hosts, a pair's runs, or both. */
  children?: ReactNode;
  now: number;
}

/** One test: its name once, what was caught, and its hosts as marks or as one bar. */
export function MatrixRow({ test, index, hosts, form, openHostKey, onToggleHost, openSegment, onToggleSegment, children, now }: MatrixRowProps) {
  const cells = useMemo(() => new Map((test.cells ?? []).map((cell) => [cell.i, cell])), [test.cells]);
  const badge = KIND_BADGE[test.kind];
  const segments = rowSegments(test).filter((s) => s.key !== 'never_run');
  const neverRun = test.counts.neverRun;
  const isBundle = test.kind === 'controls';

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
              activeKey={openSegment === 'all' ? null : openSegment}
              // A bundle's bar counts controls: no list of hosts stands behind one of its counts.
              onSelect={isBundle ? undefined : (key) => { if (isVerdict(key)) onToggleSegment(key); }}
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-faint">
              {isBundle && (
                <button
                  type="button"
                  aria-expanded={openSegment === 'all'}
                  onClick={() => onToggleSegment('all')}
                  className="rounded-sm text-muted underline underline-offset-2 hover:text-foreground"
                >
                  {openSegment === 'all' ? 'Hide hosts' : 'Show hosts'}
                </button>
              )}
              {neverRun > 0 && <span>{neverRun} never run</span>}
            </div>
          </div>
        ) : (
          // Named by the test: a mark's own name is its host and state.
          <div role="group" aria-label={test.name} style={stripColumns(hosts.length, form)} className="min-w-0 items-center justify-items-center">
            {hosts.map((host, i) => {
              const cell = cells.get(i);
              return (
                <MatrixCellMark
                  key={host.key}
                  form={form}
                  subject={host.hostname}
                  cell={cell}
                  open={openHostKey === host.key}
                  onToggle={() => cell && onToggleHost(host.key, cell.at)}
                  row={index}
                  col={i}
                  now={now}
                />
              );
            })}
          </div>
        )}
      </div>
      {children && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  );
}
