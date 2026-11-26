import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type {
  CoverageMatrixHostsResponse,
  ExtendedFilterParams,
  MatrixCell,
  MatrixHostRow,
  MatrixTest,
} from '@/services/api/analytics';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MatrixCellMark, type MarkForm } from './MatrixCellMark';
import { ROW_GRID, stripColumns, type PairRef } from './MatrixRow';
import { ColumnHeader, MarkHint, MatrixSummary, useMarkGrid } from './matrixGrid';
import { hostCaughtLine, matrixScope, parseHostKey, settleForm, SQUARE_MIN_PX, type SettledForm } from './matrixModel';
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
  /** Shown under the row of the open pair's host, or above the rows when that host is not on a loaded page. */
  renderPair: (pair: PairRef, test: MatrixTest, host: { hostname: string; org: string | null }) => ReactNode;
  /** The time ages are counted from; the time the answer arrived when not given. */
  now?: number;
}

type Meta = Omit<CoverageMatrixHostsResponse, 'hosts'>;

/**
 * A host with its cells by test, not by position. A cell's `i` is an index
 * into the tests of the response it came in, and the server's test order can
 * change between two pages (it orders by how many hosts are unprotected), so
 * a position kept across pages would put a result under another test.
 */
type LoadedHost = MatrixHostRow & { byTest: Map<string, MatrixCell> };

function resolveHosts(response: CoverageMatrixHostsResponse): LoadedHost[] {
  return response.hosts.map((host) => ({
    ...host,
    byTest: new Map(host.cells.flatMap((cell) => (response.tests[cell.i] ? [[response.tests[cell.i].key, cell] as const] : []))),
  }));
}

/** The tests of a response, whatever their order: two pages with the same set can share rows, since cells are by test. */
const testSetOf = (tests: MatrixTest[]) => tests.map((t) => t.key).sort().join('|');

/**
 * The matrix turned: one row per host, most exposed first (the server's
 * order), one mark per test. A page of hosts at a time. The same marks and
 * forms as rows of tests, except that a host's tests are never one bar: where
 * they do not fit as squares the strip scrolls inside the card.
 */
export function HostRows({ params, reloadToken, openPair, onOpenPair, renderPair, now: nowProp }: HostRowsProps) {
  const scopeKey = useMemo(() => JSON.stringify(matrixScope(params)), [params]);

  const [hosts, setHosts] = useState<LoadedHost[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** A further page is on its way, or did not arrive: the rows on screen stay as they are. */
  const [more, setMore] = useState<'idle' | 'loading' | 'failed'>('idle');
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
    setMore('idle');
    (async () => {
      // The pages of one reload can come from two snapshots of the server (it keeps one for 30 s).
      // Another order of the same tests is harmless: cells are by test. When a test was added or
      // dropped between two pages, read once more, so no host shows "never run" for a test it ran.
      for (let round = 0; round < 2; round++) {
        const all: LoadedHost[] = [];
        const sets = new Set<string>();
        let last: Meta | null = null;
        let filled = 0;
        for (let page = 1; page <= pages.current; page++) {
          const response = await fetchPage(page);
          if (id !== request.current) return;
          const { hosts: _hosts, ...rest } = response;
          last = rest;
          if (response.hosts.length === 0) break;
          filled = page;
          sets.add(testSetOf(response.tests));
          // A host that moved between two pages is listed once.
          all.push(...resolveHosts(response).filter((h) => !all.some((p) => p.key === h.key)));
        }
        if (sets.size > 1 && round === 0) continue;
        // Pages that no longer exist (runs archived, a narrower window) are not asked for again.
        pages.current = Math.max(1, filled);
        setHosts(all);
        setMeta(last);
        setReceivedAt(Date.now());
        return;
      }
    })()
      .catch(() => {
        if (id === request.current) setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // An answer that arrives after the view is gone, or the scope changed, is nobody's:
    // also a further page asked for meanwhile, so the cleanup voids whatever is in flight.
    return () => {
      request.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, reloadToken, attempt]);

  const showMore = () => {
    const id = ++request.current;
    const page = pages.current + 1;
    setMore('loading');
    fetchPage(page)
      .then((response) => {
        if (id !== request.current) return;
        pages.current = page;
        setMore('idle');
        // Other tests than the rows on screen have (one added or dropped): read every page again.
        // Another order of the same tests needs nothing: the new page's order becomes the columns'.
        if (meta && testSetOf(response.tests) !== testSetOf(meta.tests)) {
          setAttempt((n) => n + 1);
          return;
        }
        const next = resolveHosts(response);
        setHosts((prev) => [...prev, ...next.filter((h) => !prev.some((p) => p.key === h.key))]);
        const { hosts: _hosts, ...rest } = response;
        setMeta(rest);
      })
      .catch(() => {
        if (id === request.current) setMore('failed');
      });
  };

  const [ruler, stripWidth] = useElementWidth<HTMLDivElement>();
  const [scroller, scrollerWidth] = useElementWidth<HTMLDivElement>();
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
  const strip = stripColumns(tests.length, form);
  // Squares that do not fit keep their smallest size and the rows scroll sideways inside the card.
  // The hostnames and an open pair's runs stay in view (sticky); the rows are as wide as their marks.
  const scrolled = scrolls ? { minWidth: `calc(${tests.length * (SQUARE_MIN_PX + 1)}px + 17rem)` } : undefined;
  const stuck = scrolls ? 'sticky left-0 z-[1] bg-surface' : undefined;
  const outcomeFiltered = Boolean(params.result || params.errorCodes || params.errorNames);
  // The open pair's host can be on a page not loaded (a link, or a reload that moved it down): its runs are still shown.
  const strayPair = openPair && !hosts.some((h) => h.key === openPair.hostKey) ? openPair : null;
  const strayTest = strayPair ? tests.find((t) => t.testUuid === strayPair.testUuid) : undefined;

  return (
    <Card className="p-4" aria-busy={loading}>
      <MatrixSummary hostCount={meta.hostCount} testCount={meta.testCount} windowLabel={meta.windowLabel} />

      {failure && <div className="mb-3">{failure}</div>}
      {outcomeFiltered && <p className="mb-3 text-[12px] text-faint">Outcome filters apply to the List view only.</p>}
      {strayPair && strayTest && <div className="mb-3">{renderPair(strayPair, strayTest, parseHostKey(strayPair.hostKey))}</div>}
      {meta.truncated && (
        <p className="mb-3 text-[12px] text-warning">
          Showing {tests.length.toLocaleString()} of {meta.testCount.toLocaleString()} tests
        </p>
      )}

      {hosts.length === 0 || tests.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">No results in this window</p>
      ) : (
        <div {...gridProps} data-testid="matrix" data-form={form}>
          {/* In every form here: a tile shows about ten letters of a test's name. */}
          <MarkHint form={form} hintRef={hintRef} always />
          <div ref={scroller} className={scrolls ? 'overflow-x-auto' : undefined}>
           <div style={scrolled}>
            <div className={`${ROW_GRID} items-end pb-1`}>
              <span className={stuck} />
              <div ref={ruler} className="min-w-0">
                <ColumnHeader columns={tests.map((t) => ({ key: t.key, label: t.name }))} form={form} testId="matrix-column" long />
              </div>
            </div>
            {hosts.map((host, index) => {
              const pair = openPair && openPair.hostKey === host.key ? openPair : null;
              const pairTest = pair ? tests.find((t) => t.testUuid === pair.testUuid) : undefined;
              return (
                <div key={host.key} data-matrix-row className="border-t border-border py-2">
                  <div className={ROW_GRID}>
                    <div className={`min-w-0 ${stuck ?? ''}`}>
                      <h3 title={host.hostname} className="truncate font-mono text-[13px] font-medium text-foreground">{host.hostname}</h3>
                      <p className="truncate text-[11px] text-faint">{hostCaughtLine(host)}</p>
                    </div>
                    {/* Named by the host: a mark's own name is its test and state. */}
                    <div role="group" aria-label={host.hostname} style={strip} className="min-w-0 items-center justify-items-center">
                      {tests.map((test, t) => {
                        const cell = host.byTest.get(test.key);
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
                  {pair && pairTest && (
                    <div className={`mt-2 ${scrolls ? 'sticky left-0' : ''}`} style={scrolls && scrollerWidth > 0 ? { width: scrollerWidth } : undefined}>
                      {renderPair(pair, pairTest, host)}
                    </div>
                  )}
                </div>
              );
            })}
           </div>
          </div>
        </div>
      )}

      {more === 'failed' && (
        <div role="alert" className="mt-2 flex items-center gap-3 text-xs text-warning">
          <span>More hosts could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={showMore}>Try again</Button>
        </div>
      )}
      {/* Kept in place while its page loads: the focus stays on it, and it says so. */}
      {remaining > 0 && more !== 'failed' && (!loading || more === 'loading') && (
        <Button variant="ghost" size="sm" className="mt-2" aria-disabled={more === 'loading'} onClick={more === 'loading' ? undefined : showMore}>
          {more === 'loading' && <Loader2 className="animate-spin" />}
          Show {remaining} more
        </Button>
      )}
    </Card>
  );
}
