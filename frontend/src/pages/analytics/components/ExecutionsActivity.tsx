import { useEffect, useMemo, useRef, useState } from 'react';
import { analyticsApi, type ExecutionsActivityResponse, type ExtendedFilterParams } from '@/services/api/analytics';
import { ActivityStrip } from '@/components/shared/activity/ActivityStrip';
import { STRIP_HEIGHT_PX, type BucketRef, type StripBucket } from '@/components/shared/activity/activityModel';
import { matrixScope } from './matrix/matrixModel';

interface ExecutionsActivityProps {
  /** The page's filters, with the filter bar's whole window (never narrowed to the selected bucket). */
  params: ExtendedFilterParams;
  /** A new value reads the activity again (Refresh, an archive). */
  reloadToken: number;
  /** The bucket the page is narrowed to. */
  selected: BucketRef | null;
  onSelect: (bucket: BucketRef | null) => void;
  /** An outcome filter narrows the list under the strip: the bars do not follow it, and say so. */
  outcomeFiltered?: boolean;
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * The activity strip of All Executions: runs per time bucket over the filter
 * bar's window, by outcome. One request per scope. The outcomes and their
 * counts are the server's (the Dashboard cadence card's rules); this only
 * orders and tones them.
 */
export function ExecutionsActivity({ params, reloadToken, selected, onSelect, outcomeFiltered = false }: ExecutionsActivityProps) {
  const [data, setData] = useState<ExecutionsActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  // The scope as text: a new object with the same filters asks nothing.
  const scopeKey = JSON.stringify(matrixScope(params));

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    analyticsApi
      .getExecutionsActivity(JSON.parse(scopeKey) as ExtendedFilterParams, browserTimeZone())
      .then((response) => {
        if (id === request.current) setData(response);
      })
      .catch((error) => {
        if (id !== request.current) return;
        // The strip is an extra: the views under it report their own failures.
        console.error('Failed to load the executions activity:', error);
        // Bars of an earlier scope would be read as this scope's.
        setData(null);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // An answer that arrives after the scope changed, or the strip is gone, is nobody's.
    return () => {
      request.current++;
    };
  }, [scopeKey, reloadToken]);

  const buckets = useMemo<StripBucket[]>(
    () =>
      (data?.buckets ?? []).map((b) => ({
        from: b.from,
        to: b.to,
        // Drawing order, bottom first: the worst outcome sits on the baseline.
        segments: [
          { key: 'unprotected', tone: 'danger', label: 'unprotected', count: b.unprotected },
          { key: 'noVerdict', tone: 'muted', label: 'no verdict', count: b.noVerdict },
          { key: 'protected', tone: 'accent', label: 'protected', count: b.protected },
        ],
      })),
    [data],
  );

  if (!data) {
    // Holds the bars' place until the first answer, so the views under it do not jump on a busy install.
    return loading ? <div data-testid="activity-loading" aria-hidden="true" style={{ height: STRIP_HEIGHT_PX }} /> : null;
  }

  const notes = [
    outcomeFiltered && 'Outcome filters narrow the list, not the bars.',
    data.truncated && 'Too many runs to count them all: the bars are a lower bound.',
    data.capped && 'The bars cover the last 365 days of this window.',
  ].filter((line): line is string => Boolean(line));

  return (
    <ActivityStrip
      buckets={buckets}
      interval={data.interval}
      timeZone={data.timeZone}
      selected={selected}
      onSelect={onSelect}
      note={notes.length > 0 ? <p className="text-[12px] text-faint">{notes.join(' ')}</p> : undefined}
    />
  );
}
