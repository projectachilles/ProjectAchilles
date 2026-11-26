import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type {
  CoverageMatrixHostsResponse,
  ExtendedFilterParams,
  MatrixHost,
  MatrixHostRow,
  MatrixTest,
} from '@/services/api/analytics';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MatrixCellMark, type MarkForm } from './MatrixCellMark';
import { ROW_GRID, stripColumns, type PairRef } from './MatrixRow';
import { ColumnHeader, MarkHint, MatrixSummary, useMarkGrid } from './matrixGrid';
import { hostCaughtLine, matrixScope, settleForm, SQUARE_MIN_PX, type SettledForm } from './matrixModel';
import { useElementWidth } from './useElementWidth';

/** Hosts asked for at a time. */
export const HOST_ROWS_PAGE = 25;

interface HostRowsProps {
  /** The page's filters. Only the scope is sent; an equal scope in a new object is not asked again. */
  params: ExtendedFilterParams;
  /** A new value reads again every page loaded so far and keeps the rows on screen meanwhile. */
  reloadToken: number;
  openPair: PairRef | null;
  /** `at`: the time of the result the mark shows, so the run opened is that one. */
  onOpenPair: (pair: PairRef | null, at?: string) => void;
  /** Shown under the row of the open pair's host. */
  renderPair: (pair: PairRef, test: MatrixTest, host: MatrixHost) => ReactNode;
  /** The time ages are counted from; the time the answer arrived when not given. */
  now?: number;
}

type Meta = Omit<CoverageMatrixHostsResponse, 'hosts'>;

/**
 * The matrix turned: one row per host, most exposed first (the server's
 * order), one mark per test. A page of hosts at a time. The same marks and
 * forms as rows of tests, except that a host's tests are never one bar: where
 * they do not fit as squares the strip scrolls inside the card.
 */
export function HostRows({ params, reloadToken, openPair, onOpenPair, renderPair, now: nowProp }: HostRowsProps) {
  const scopeKey = useMemo(() => JSON.stringify(matrixScope(params)), [params]);

  const [hosts, setHosts] = useState<MatrixHostRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const shownScope = useRef<string | null>(null);
  /** Pages on screen: a reload reads them all again. */
  const pages = useRef(1);

  const fetchPage = (page: number) =>
    analyticsApi.getCoverageMatrixHosts(JSON.parse(scopeKey) as ExtendedFilterParams, { page, pageSize: HOST_ROWS_PAGE });

  useEffect(() => {
    const id = ++request.current;
    // Rows of another scope are never shown as this one's; a reload of the same scope keeps them.
    if (shownScope.current !== scopeKey) {
      setHosts([]);
      setMeta(null);
      pages.current = 1;
    }
    shownScope.current = scopeKey;
    setLoading(true);
    setFailed(false);
    (async () => {
      const all: MatrixHostRow[] = [];
      let last: Meta | null = null;
      for (let page = 1; page <= pages.current; page++) {
        const { hosts: pageHosts, ...rest } = await fetchPage(page);
        if (id !== request.current) return;
        all.push(...pageHosts);
        last = rest;
        if (pageHosts.length === 0) break;
      }
      setHosts(all);
      setMeta(last);
      setReceivedAt(Date.now());
    })()
      .catch(() => {
        if (id === request.current) setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // An answer that arrives after the view is gone, or the scope changed, is nobody's.
    return () => {
      if (request.current === id) request.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, reloadToken, attempt]);

  const showMore = () => {
    const id = ++request.current;
    const page = pages.current + 1;
    setLoading(true);
    setFailed(false);
    fetchPage(page)
      .then(({ hosts: pageHosts, ...rest }) => {
        if (id !== request.current) return;
        pages.current = page;
        setHosts((prev) => [...prev, ...pageHosts.filter((h) => !prev.some((p) => p.key === h.key))]);
        setMeta(rest);
      })
      .catch(() => {
        if (id === request.current) setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  };

  const [ruler, stripWidth] = useElementWidth<HTMLDivElement>();
  const { gridProps, hintRef } = useMarkGrid();
  const now = nowProp ?? receivedAt;
  const tests = meta?.tests ?? [];

  // Held steady across small changes of width, as for rows of tests. Never a bar:
  // a row is one host, and its tests are few enough to be marks (the server lists at most 500).
  const settled = useRef<SettledForm | null>(null);
  settled.current = meta ? settleForm(settled.current, stripWidth, tests.length, true) : null;
  const fits = settled.current?.form ?? 'squares';
  const form: MarkForm = fits === 'bar' ? 'squares' : fits;
  const scrolls = fits === 'bar';

  const failure = failed && (
    <div role="alert" className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-xs text-warning">
      <span>The matrix could not be loaded.</span>
      <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
    </div>
  );

  if (!meta) {
    return (
      <Card className="flex min-h-40 items-center justify-center p-4">
        {failure || (
          <div role="status" className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the matrix…
          </div>
        )}
      </Card>
    );
  }

  const remaining = Math.min(HOST_ROWS_PAGE, meta.hostCount - hosts.length);
  // Squares that do not fit keep their smallest size and the strip scrolls sideways, inside the card.
  const strip = { ...stripColumns(tests.length, form), ...(scrolls ? { minWidth: tests.length * (SQUARE_MIN_PX + 1) } : {}) };

  return (
    <Card className="p-4" aria-busy={loading}>
      <MatrixSummary hostCount={meta.hostCount} testCount={meta.testCount} windowLabel={meta.windowLabel} />

      {failure && <div className="mb-3">{failure}</div>}
      {meta.truncated && (
        <p className="mb-3 text-[12px] text-warning">
          Showing {tests.length.toLocaleString()} of {meta.testCount.toLocaleString()} tests
        </p>
      )}

      {hosts.length === 0 || tests.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">No results in this window</p>
      ) : (
        <div {...gridProps} data-testid="matrix" data-form={form}>
          <MarkHint form={form} hintRef={hintRef} />
          <div className={scrolls ? 'overflow-x-auto' : undefined}>
            <div className={`${ROW_GRID} items-end pb-1`}>
              <span />
              <div ref={ruler} className="min-w-0">
                <ColumnHeader columns={tests.map((t) => ({ key: t.key, label: t.name }))} form={form} testId="matrix-column" long />
              </div>
            </div>
            {hosts.map((host, index) => {
              const cells = new Map(host.cells.map((cell) => [cell.i, cell]));
              const pair = openPair && openPair.hostKey === host.key ? openPair : null;
              const pairTest = pair ? tests.find((t) => t.testUuid === pair.testUuid) : undefined;
              return (
                <div key={host.key} data-matrix-row className="border-t border-border py-2">
                  <div className={ROW_GRID}>
                    <div className="min-w-0">
                      <h3 title={host.hostname} className="truncate font-mono text-[13px] font-medium text-foreground">{host.hostname}</h3>
                      <p className="truncate text-[11px] text-faint">{hostCaughtLine(host)}</p>
                    </div>
                    {/* Named by the host: a mark's own name is its test and state. */}
                    <div role="group" aria-label={host.hostname} style={strip} className="min-w-0 items-center justify-items-center">
                      {tests.map((test, t) => {
                        const cell = cells.get(t);
                        const open = pair?.testUuid === test.testUuid;
                        return (
                          <MatrixCellMark
                            key={test.key}
                            form={form}
                            subject={test.name}
                            cell={cell}
                            open={open}
                            onToggle={() => cell && (open ? onOpenPair(null) : onOpenPair({ testUuid: test.testUuid, hostKey: host.key }, cell.at))}
                            row={index}
                            col={t}
                            now={now}
                          />
                        );
                      })}
                    </div>
                  </div>
                  {pair && pairTest && <div className="mt-2">{renderPair(pair, pairTest, host)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && remaining > 0 && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={showMore}>
          Show {remaining} more
        </Button>
      )}
    </Card>
  );
}
