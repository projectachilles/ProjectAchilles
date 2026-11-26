import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { analyticsApi } from '@/services/api/analytics';
import type { ExtendedFilterParams, MatrixHostRow, MatrixTest, MatrixVerdict } from '@/services/api/analytics';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MARK_BG, MARK_TEXT } from '@/components/shared/marks/markTone';
import type { PairRef } from './MatrixRow';
import { VERDICT_META, agoText, cellLabel, matrixScope } from './matrixModel';

/** Hosts asked for at a time. */
export const SEGMENT_HOSTS_PAGE = 25;

interface SegmentHostsProps {
  /** The page's filters; the scope is sent, as for the matrix. */
  params: ExtendedFilterParams;
  test: MatrixTest;
  state: MatrixVerdict;
  onOpenPair: (pair: PairRef) => void;
  /** The time ages are counted from; the time the answer arrived when not given. */
  now?: number;
}

/**
 * The hosts of one state of one test, in the matrix's host order: how a host
 * is reached where the fleet is too large for a mark each.
 */
export function SegmentHosts({ params, test, state, onOpenPair, now: nowProp }: SegmentHostsProps) {
  const scopeKey = JSON.stringify(matrixScope(params));
  const query = `${scopeKey}|${test.testUuid}|${state}`;

  const [hosts, setHosts] = useState<MatrixHostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const request = useRef(0);
  const loadedQuery = useRef<string | null>(null);

  useEffect(() => {
    const id = ++request.current;
    const fresh = loadedQuery.current !== query;
    const wanted = fresh ? 1 : page;
    if (fresh) setHosts([]);
    if (fresh && page !== 1) setPage(1);
    loadedQuery.current = query;
    setLoading(true);
    setFailed(false);
    analyticsApi
      .getCoverageMatrixHosts(JSON.parse(scopeKey) as ExtendedFilterParams, { page: wanted, pageSize: SEGMENT_HOSTS_PAGE, test: test.testUuid, state })
      .then((response) => {
        if (id !== request.current) return;
        setTotal(response.hostCount);
        setReceivedAt(Date.now());
        setHosts((prev) => (wanted === 1 ? response.hosts : [...prev, ...response.hosts.filter((h) => !prev.some((p) => p.key === h.key))]));
      })
      .catch(() => {
        if (id === request.current) setFailed(true);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page, attempt]);

  const now = nowProp ?? receivedAt;
  const meta = VERDICT_META[state];
  const remaining = Math.min(SEGMENT_HOSTS_PAGE, total - hosts.length);

  return (
    <div
      role="group"
      aria-label={`${total} host${total === 1 ? '' : 's'} ${meta.label} on ${test.name}`}
      className="rounded-md border border-border bg-raised/40 p-2"
    >
      {loading && hosts.length === 0 && (
        <div role="status" className="flex items-center gap-2 px-1 py-1 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading hosts…
        </div>
      )}
      {failed && (
        <div role="alert" className="flex items-center gap-3 px-1 py-1 text-xs text-warning">
          <span>The hosts could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </div>
      )}
      {!failed && !loading && hosts.length === 0 && <p className="px-1 py-1 text-xs text-faint">No host in this state now</p>}

      <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
        {hosts.map((host) => {
          const cell = host.cells[0];
          return (
            <li key={host.key}>
              <button
                type="button"
                aria-label={cellLabel(host, cell, now)}
                onClick={() => onOpenPair({ testUuid: test.testUuid, hostKey: host.key })}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left outline-offset-1 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span aria-hidden="true" className={cn('font-bold', MARK_TEXT[meta.tone])}>{meta.glyph}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={host.hostname}>{host.hostname}</span>
                <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
                  {cell?.earlier?.map((verdict, i) => (
                    <span key={i} className={cn('h-1.5 w-1.5 rounded-full', MARK_BG[VERDICT_META[verdict].tone])} />
                  ))}
                </span>
                <span className={cn('text-[11px]', MARK_TEXT[meta.tone])}>{meta.label}</span>
                <span className="shrink-0 text-[11px] text-faint">{cell ? agoText(cell.at, now) : ''}</span>
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
