import { useEffect, useMemo, useRef, useState } from 'react';
import { agentApi } from '@/services/api/agent';
import { usePolling } from '@/hooks/usePolling';
import { ActivityStrip } from '@/components/shared/activity/ActivityStrip';
import { STRIP_HEIGHT_PX, type BucketRef, type StripBucket } from '@/components/shared/activity/activityModel';
import type { TaskActivityResponse, TaskType } from '@/types/agent';
import type { TaskBucket } from '@/utils/testOutcome';
import { BUCKET_META, BUCKET_ORDER } from './runMarks';

/** Read again this often: the list's own refresh (every 10 s) never asks for the strip. */
export const TASK_ACTIVITY_REFRESH_MS = 60_000;

const FIELD: Record<TaskBucket, Exclude<keyof TaskActivityResponse['buckets'][number], 'from' | 'to'>> = {
  unprotected: 'unprotected',
  failed: 'failed',
  'no-verdict': 'noVerdict',
  'in-progress': 'inProgress',
  protected: 'protected',
  completed: 'completed',
};

interface TaskActivityProps {
  /** The type pill's task types; none = every type. */
  types: TaskType[];
  search: string;
  /** A new value reads the strip again (Refresh, the page's own actions). */
  reloadToken: number;
  /** The day the list is narrowed to. */
  selected: BucketRef | null;
  onSelect: (bucket: BucketRef | null) => void;
  /** A filter narrows the list and not the bars (the status filter, an outcome tile): the line that says so. */
  listOnlyNote?: string | null;
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * The activity strip of the Tasks page: tasks per day over the last 30 days,
 * coloured as the run timeline colours them (BUCKET_META, worst at the bottom
 * in BUCKET_ORDER), so a colour here means what it means on the marks below.
 * The counting is the server's (taskBucket, held to the same golden table as
 * the frontend's).
 */
export function TaskActivity({ types, search, reloadToken, selected, onSelect, listOnlyNote }: TaskActivityProps) {
  // The answer with the question it answers: a failed refresh of the same question keeps it.
  const [answer, setAnswer] = useState<{ scope: string; data: TaskActivityResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const request = useRef(0);
  // The question as text: the same pills and search in a new array ask nothing.
  const scopeKey = JSON.stringify([types, search]);

  usePolling(() => setTick((n) => n + 1), TASK_ACTIVITY_REFRESH_MS);

  useEffect(() => {
    const id = ++request.current;
    const [scopeTypes, scopeSearch] = JSON.parse(scopeKey) as [TaskType[], string];
    setLoading(true);
    agentApi
      .getTaskActivity({ types: scopeTypes, search: scopeSearch }, browserTimeZone())
      .then((response) => {
        if (id === request.current) setAnswer({ scope: scopeKey, data: response });
      })
      .catch((error) => {
        if (id !== request.current) return;
        // The strip is an extra: the list reports its own failures.
        console.error('Failed to load the task activity:', error);
        // A missed minute keeps the bars it has; bars of other pills or another search would be read as these.
        setAnswer((kept) => (kept?.scope === scopeKey ? kept : null));
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    // An answer that arrives after the question changed, or the strip is gone, is nobody's.
    return () => {
      request.current++;
    };
  }, [scopeKey, reloadToken, tick]);

  const data = answer?.scope === scopeKey ? answer.data : null;

  const buckets = useMemo<StripBucket[]>(
    () =>
      (data?.buckets ?? []).map((b) => ({
        from: b.from,
        to: b.to,
        segments: BUCKET_ORDER.map((bucket) => ({ key: bucket, tone: BUCKET_META[bucket].tone, label: BUCKET_META[bucket].label, count: b[FIELD[bucket]] })),
      })),
    [data],
  );

  if (!data) {
    // Holds the bars' place until the first answer, so the list under it does not jump.
    if (loading) return <div data-testid="activity-loading" aria-hidden="true" style={{ height: STRIP_HEIGHT_PX }} />;
    // No bars (the request failed). A list narrowed to a day still needs to say so, and the way out.
    return selected ? <ActivityStrip buckets={[]} interval="day" unit="task" selected={selected} onSelect={onSelect} /> : null;
  }

  return (
    <ActivityStrip
      buckets={buckets}
      interval={data.interval}
      unit="task"
      timeZone={data.timeZone}
      selected={selected}
      onSelect={onSelect}
      note={listOnlyNote ? <p className="text-[12px] text-faint">{listOnlyNote}</p> : undefined}
    />
  );
}
