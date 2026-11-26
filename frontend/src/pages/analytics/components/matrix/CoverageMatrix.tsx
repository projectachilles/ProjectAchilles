import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
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
import { MARK_BG, MARK_TEXT } from '@/components/shared/marks/markTone';
import { MatrixRow, ROW_GRID, stripColumns, type OpenSegment, type PairRef } from './MatrixRow';
import { matrixScope, settleForm, verdictCount, VERDICT_META, type MatrixForm, type SettledForm } from './matrixModel';
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

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const LEGEND: MatrixVerdict[] = ['protected', 'detected', 'unprotected', 'no_verdict', 'risk_accepted'];
const MARK = '[data-matrix-mark]';

/**
 * Arrow keys inside the matrix: left and right along the row, up and down to
 * the nearest row that has a mark in the same host's column. At an edge, and
 * where no row has that column, focus stays.
 */
function moveBetweenMarks(e: KeyboardEvent<HTMLDivElement>) {
  const horizontal = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const vertical = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if ((horizontal === 0 && vertical === 0) || !(e.target instanceof HTMLElement)) return;
  const current = e.target.closest<HTMLElement>(MARK);
  if (!current) return;
  e.preventDefault();
  const axis = horizontal !== 0 ? 'row' : 'col';
  const line = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(MARK)).filter((m) => m.dataset[axis] === current.dataset[axis]);
  line[line.indexOf(current) + horizontal + vertical]?.focus();
}

function HostHeader({ hosts, form }: { hosts: MatrixHost[]; form: MatrixForm }) {
  if (form !== 'tile' && form !== 'small') return null;
  return (
    <div style={stripColumns(hosts.length, form)} className={cn('min-w-0', form === 'small' && 'h-[76px]')}>
      {hosts.map((host) =>
        form === 'tile' ? (
          <span key={host.key} data-testid="matrix-host" title={host.hostname} className="truncate text-center font-mono text-[11px] text-muted">
            {host.hostname}
          </span>
        ) : (
          <span key={host.key} className="relative">
            {/* Angled, ending at its own column: it leans back over the label column, never past the last host. Cut at a fixed length. */}
            <span
              data-testid="matrix-host"
              title={host.hostname}
              className="absolute bottom-0.5 right-1/2 max-w-[5.5rem] origin-bottom-right rotate-[48deg] truncate whitespace-nowrap font-mono text-[10px] text-muted"
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

  // One stop for the Tab key: the mark last focused, or the first. Set on the
  // elements themselves, so moving through thousands of marks renders nothing.
  const grid = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<string | null>(null);
  const markId = (el: HTMLElement) => `${el.dataset.row}|${el.dataset.col}`;
  useEffect(() => {
    const marks = Array.from(grid.current?.querySelectorAll<HTMLElement>(MARK) ?? []);
    const stop = marks.find((m) => markId(m) === lastFocused.current) ?? marks[0];
    for (const mark of marks) mark.tabIndex = mark === stop ? 0 : -1;
  });

  // The mark under the focus or the pointer, written out: squares and small tiles carry no text.
  const hint = useRef<HTMLParagraphElement | null>(null);
  const showHint = (target: EventTarget) => {
    if (!hint.current || !(target instanceof HTMLElement)) return;
    const mark = target.closest<HTMLElement>('[data-testid="matrix-mark"]');
    if (!mark) return;
    const test = mark.closest('[role="group"]')?.getAttribute('aria-label');
    hint.current.textContent = `${test ? `${test} · ` : ''}${mark.getAttribute('aria-label') ?? ''}`;
  };
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    showHint(e.target);
    const mark = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(MARK) : null;
    if (!mark) return;
    lastFocused.current = markId(mark);
    for (const other of grid.current?.querySelectorAll<HTMLElement>(MARK) ?? []) other.tabIndex = other === mark ? 0 : -1;
  };
  const onPointer = (e: MouseEvent<HTMLDivElement>) => showHint(e.target);

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
          <li className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-[2px]', MARK_BG.hollow)} />
            never run
          </li>
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
        <div ref={grid} data-testid="matrix" data-form={form} onKeyDown={moveBetweenMarks} onFocus={onFocus} onMouseOver={onPointer}>
          {(form === 'squares' || form === 'small') && (
            <p ref={hint} data-testid="matrix-hint" aria-hidden="true" className="mb-1 min-h-4 truncate font-mono text-[11px] text-muted" />
          )}
          <div className={cn(ROW_GRID, 'items-end pb-1')}>
            <span />
            <div ref={ruler} className="min-w-0">
              <HostHeader hosts={hosts} form={form} />
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
