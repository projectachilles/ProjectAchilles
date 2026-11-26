import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type {
  CoverageMatrixTestsResponse,
  ExtendedFilterParams,
  MatrixHost,
  MatrixTest,
  MatrixVerdict,
} from '@/services/api/analytics';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MatrixRow, ROW_GRID, type OpenSegment, type PairRef } from './MatrixRow';
import { ColumnHeader, MarkHint, MatrixSummary, useMarkGrid } from './matrixGrid';
import { matrixScope, settleForm, verdictCount, type MatrixForm, type SettledForm } from './matrixModel';
import { useElementWidth } from './useElementWidth';

export type { PairRef } from './MatrixRow';

interface CoverageMatrixProps {
  /** The page's filters. Only the scope is sent; an equal scope in a new object is not asked again. */
  params: ExtendedFilterParams;
  /** A new value asks again for the same scope and keeps the rows on screen meanwhile. */
  reloadToken: number;
  openPair: PairRef | null;
  /** `at`: the time of the result the mark shows, so the run opened is that one. */
  onOpenPair: (pair: PairRef | null, at?: string) => void;
  /** Shown under the row of the open pair. `host` is null when the fleet is drawn as bars. */
  renderPair: (pair: PairRef, test: MatrixTest, host: MatrixHost | null) => ReactNode;
  /** Shown under a bar: the hosts of one state, or every host of a bundle (`state` null). */
  renderSegment: (test: MatrixTest, state: MatrixVerdict | null) => ReactNode;
  /** The time ages are counted from; the time the answer arrived when not given. */
  now?: number;
}

/**
 * The latest result of every test on every host. One request; the server
 * decides every state, count and order, and the width each host gets decides
 * the form: tiles, small tiles, squares, or one bar per test.
 */
export function CoverageMatrix({ params, reloadToken, openPair, onOpenPair, renderPair, renderSegment, now: nowProp }: CoverageMatrixProps) {
  const scopeKey = useMemo(() => JSON.stringify(matrixScope(params)), [params]);
  const outcomeFiltered = Boolean(params.result || params.errorCodes || params.errorNames);

  const [data, setData] = useState<CoverageMatrixTestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const shownScope = useRef<string | null>(null);

  useEffect(() => {
    const id = ++request.current;
    // Rows of another scope are never shown as this one's; a reload of the same scope keeps them.
    if (shownScope.current !== scopeKey) setData(null);
    shownScope.current = scopeKey;
    setLoading(true);
    setFailed(false);
    analyticsApi
      .getCoverageMatrix(JSON.parse(scopeKey) as ExtendedFilterParams)
      .then((response) => {
        if (id !== request.current) return;
        setData(response);
        setReceivedAt(Date.now());
      })
      .catch(() => {
        if (id === request.current) setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // An answer that arrives after the view is gone is nobody's.
    return () => {
      if (request.current === id) request.current++;
    };
  }, [scopeKey, reloadToken, attempt]);

  const [openSegment, setOpenSegment] = useState<{ testKey: string; segment: OpenSegment } | null>(null);
  const [ruler, stripWidth] = useElementWidth<HTMLDivElement>();
  const now = nowProp ?? receivedAt;

  const hosts = data?.hosts ?? [];
  // Held steady across small changes of width (settleForm): a scrollbar appearing must not flip it.
  const settled = useRef<SettledForm | null>(null);
  settled.current = data ? settleForm(settled.current, stripWidth, data.hostCount, data.cellsIncluded) : null;
  const form: MatrixForm = settled.current?.form ?? 'squares';
  const hostByKey = useMemo(() => new Map(hosts.map((h) => [h.key, h])), [hosts]);

  const { gridProps, hintRef } = useMarkGrid();

  const failure = failed && (
    <div role="alert" className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-xs text-warning">
      <span>The matrix could not be loaded.</span>
      <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
    </div>
  );

  if (!data) {
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

  return (
    <Card className="p-4" aria-busy={loading}>
      <MatrixSummary hostCount={data.hostCount} testCount={data.testCount} windowLabel={data.windowLabel} />

      {failure && <div className="mb-3">{failure}</div>}
      {outcomeFiltered && <p className="mb-3 text-[12px] text-faint">Outcome filters apply to the List view only.</p>}
      {data.truncated && (
        <p className="mb-3 text-[12px] text-warning">
          Showing {data.tests.length.toLocaleString()} of {data.testCount.toLocaleString()} tests
        </p>
      )}

      {data.tests.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">No results in this window</p>
      ) : (
        <div {...gridProps} data-testid="matrix" data-form={form}>
          <MarkHint form={form} hintRef={hintRef} />
          <div className={cn(ROW_GRID, 'items-end pb-1')}>
            <span />
            <div ref={ruler} className="min-w-0">
              <ColumnHeader columns={hosts.map((h) => ({ key: h.key, label: h.hostname }))} form={form} testId="matrix-host" mono />
            </div>
          </div>
          {data.tests.map((test, index) => {
            const pair = openPair && openPair.testUuid === test.testUuid ? openPair : null;
            const wanted = form === 'bar' && openSegment && openSegment.testKey === test.key ? openSegment.segment : null;
            // A state no host is in any more (after a reload) has no count left to close it with.
            const segment = wanted && wanted !== 'all' && verdictCount(test, wanted) === 0 ? null : wanted;
            return (
              <MatrixRow
                key={test.key}
                test={test}
                index={index}
                hosts={hosts}
                form={form}
                openHostKey={pair?.hostKey ?? null}
                onToggleHost={(hostKey, at) => (pair?.hostKey === hostKey ? onOpenPair(null) : onOpenPair({ testUuid: test.testUuid, hostKey }, at))}
                openSegment={segment}
                onToggleSegment={(next) => setOpenSegment(segment === next ? null : { testKey: test.key, segment: next })}
                now={now}
              >
                {(segment || pair) && (
                  <>
                    {/* The hosts stay above the runs of a host opened from them: the way back to the list. */}
                    {segment && renderSegment(test, segment === 'all' ? null : segment)}
                    {pair && renderPair(pair, test, hostByKey.get(pair.hostKey) ?? null)}
                  </>
                )}
              </MatrixRow>
            );
          })}
        </div>
      )}
    </Card>
  );
}
