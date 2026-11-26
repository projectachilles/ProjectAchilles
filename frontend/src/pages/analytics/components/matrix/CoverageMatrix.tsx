import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { MARK_TEXT } from '@/components/shared/marks/markTone';
import { MatrixRow, ROW_GRID, stripColumns, type PairRef } from './MatrixRow';
import { matrixForm, matrixScope, VERDICT_META, type MatrixForm } from './matrixModel';
import { useElementWidth } from './useElementWidth';

export type { PairRef } from './MatrixRow';

interface CoverageMatrixProps {
  /** The page's filters. Only the scope is sent; an equal scope in a new object is not asked again. */
  params: ExtendedFilterParams;
  /** A new value asks again for the same scope and keeps the rows on screen meanwhile. */
  reloadToken: number;
  openPair: PairRef | null;
  onOpenPair: (pair: PairRef | null) => void;
  /** Shown under the row of the open pair. `host` is null when the fleet is drawn as bars. */
  renderPair: (pair: PairRef, test: MatrixTest, host: MatrixHost | null) => ReactNode;
  /** Shown under a bar whose segment is open. */
  renderSegment: (test: MatrixTest, state: MatrixVerdict) => ReactNode;
  /** The time ages are counted from; the time the answer arrived when not given. */
  now?: number;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const LEGEND: MatrixVerdict[] = ['protected', 'detected', 'unprotected', 'no_verdict', 'risk_accepted'];

/** Arrow keys move focus from one mark to the next in reading order, across rows. */
function moveBetweenMarks(e: KeyboardEvent<HTMLDivElement>) {
  const step =
    e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (step === 0 || !(e.target instanceof HTMLElement)) return;
  const current = e.target.closest<HTMLElement>('[data-matrix-mark]');
  if (!current) return;
  e.preventDefault();
  const marks = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-matrix-mark]'));
  marks[marks.indexOf(current) + step]?.focus();
}

function HostHeader({ hosts, form }: { hosts: MatrixHost[]; form: MatrixForm }) {
  if (form !== 'tile' && form !== 'small') return null;
  return (
    <div style={stripColumns(hosts.length, form)} className={cn('min-w-0', form === 'small' && 'h-[68px]')}>
      {hosts.map((host) =>
        form === 'tile' ? (
          <span key={host.key} data-testid="matrix-host" title={host.hostname} className="truncate text-center font-mono text-[11px] text-muted">
            {host.hostname}
          </span>
        ) : (
          <span key={host.key} className="relative">
            <span
              data-testid="matrix-host"
              title={host.hostname}
              className="absolute bottom-0.5 left-1/2 origin-bottom-left -rotate-[48deg] whitespace-nowrap font-mono text-[10px] text-muted"
            >
              {host.hostname}
            </span>
          </span>
        ),
      )}
    </div>
  );
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
  }, [scopeKey, reloadToken, attempt]);

  const [openSegment, setOpenSegment] = useState<{ testKey: string; state: MatrixVerdict } | null>(null);
  const [ruler, stripWidth] = useElementWidth<HTMLDivElement>();
  const now = nowProp ?? receivedAt;

  const hosts = data?.hosts ?? [];
  const form = data ? matrixForm(stripWidth, data.hostCount, data.cellsIncluded) : 'squares';
  const hostByKey = useMemo(() => new Map(hosts.map((h) => [h.key, h])), [hosts]);

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
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[13px] text-muted">
          {plural(data.hostCount, 'host')} · {plural(data.testCount, 'test')} · latest result in {data.windowLabel}
        </p>
        <ul aria-label="States" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          {LEGEND.map((verdict) => (
            <li key={verdict} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={cn('font-bold', MARK_TEXT[VERDICT_META[verdict].tone])}>{VERDICT_META[verdict].glyph}</span>
              {VERDICT_META[verdict].label}
            </li>
          ))}
        </ul>
      </div>

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
        <div data-testid="matrix" data-form={form} onKeyDown={moveBetweenMarks}>
          <div className={cn(ROW_GRID, 'items-end pb-1')}>
            <span />
            <div ref={ruler} className="min-w-0">
              <HostHeader hosts={hosts} form={form} />
            </div>
          </div>
          {data.tests.map((test) => {
            const pair = openPair && openPair.testUuid === test.testUuid ? openPair : null;
            const segment = openSegment && openSegment.testKey === test.key ? openSegment.state : null;
            return (
              <MatrixRow
                key={test.key}
                test={test}
                hosts={hosts}
                form={form}
                openHostKey={pair?.hostKey ?? null}
                onToggleHost={(hostKey) => onOpenPair(pair?.hostKey === hostKey ? null : { testUuid: test.testUuid, hostKey })}
                openState={segment}
                onToggleState={(state) => setOpenSegment(segment === state ? null : { testKey: test.key, state })}
                now={now}
              >
                {pair
                  ? renderPair(pair, test, hostByKey.get(pair.hostKey) ?? null)
                  : form === 'bar' && segment
                    ? renderSegment(test, segment)
                    : null}
              </MatrixRow>
            );
          })}
        </div>
      )}
    </Card>
  );
}
