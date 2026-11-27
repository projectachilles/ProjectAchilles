import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MARK_BG } from '@/components/shared/marks/markTone';
import {
  QUIET_BUCKETS,
  STRIP_HEIGHT_PX,
  barHeights,
  bucketCount,
  bucketLabel,
  bucketName,
  bucketTotal,
  sameBucket,
  type BucketRef,
  type StripBucket,
  type StripInterval,
} from './activityModel';

interface ActivityStripProps {
  /** Oldest first, one per stretch of time, empty ones included. */
  buckets: StripBucket[];
  interval: StripInterval;
  /** What a bar counts, in the singular: "run", "task". */
  unit?: string;
  /** The bucket the page is narrowed to. It need not be one of `buckets`. */
  selected: BucketRef | null;
  onSelect: (bucket: BucketRef | null) => void;
  /** The zone the buckets were cut in, for their names. */
  timeZone?: string;
  /** Lines the page adds under the strip. */
  note?: ReactNode;
}

const QUIET_WORDS: Record<StripInterval, (n: number) => string> = {
  hour: (n) => `in ${n} hour${n === 1 ? '' : 's'} of this window:`,
  day: (n) => `on ${n} day${n === 1 ? '' : 's'} in this window:`,
  week: (n) => `in ${n} week${n === 1 ? '' : 's'} of this window:`,
};

/**
 * Runs over time: one bar per bucket, as tall as its runs are many, coloured by
 * their outcomes. A click narrows the page to the bucket; the strip itself keeps
 * showing the whole window.
 *
 * It must not look empty on a quiet install: every bucket has a faint slot, a
 * bucket with one run still has a visible bar, and with fewer than three
 * buckets holding runs the bars give way to a line of text that names them.
 * With no run at all it draws nothing (the page has its own empty state).
 */
export function ActivityStrip({ buckets, interval, unit = 'run', selected, onSelect, timeZone, note }: ActivityStripProps) {
  const bars = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState('');
  const [focused, setFocused] = useState<number | null>(null);
  const heights = useMemo(() => barHeights(buckets), [buckets]);
  const active = useMemo(() => buckets.flatMap((b, i) => (bucketTotal(b) > 0 ? [i] : [])), [buckets]);

  const selectedIndex = selected ? buckets.findIndex((b) => sameBucket(b, selected)) : -1;
  const name = (i: number) => bucketName(buckets[i], interval, unit, timeZone);
  const toggle = (i: number) => onSelect(i === selectedIndex ? null : { from: buckets[i].from, to: buckets[i].to });
  const units = `${unit.charAt(0).toUpperCase()}${unit.slice(1)}s`;

  const chip = selected && (
    <button
      type="button"
      onClick={() => onSelect(null)}
      aria-label={`Clear the selected ${bucketLabel(selected, interval, timeZone)}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/25 bg-accent-dim px-2 py-0.5 text-[12px] font-medium text-accent outline-offset-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {bucketLabel(selected, interval, timeZone)}
      <X aria-hidden="true" className="h-3 w-3" />
    </button>
  );

  if (active.length === 0) {
    // Nothing to draw. A page still narrowed to a bucket needs its way out.
    return chip ? <div className="flex justify-end">{chip}</div> : null;
  }

  if (active.length < QUIET_BUCKETS) {
    return (
      <div role="group" aria-label={`${units} over time`} data-testid="activity-strip" className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <span>{units} {QUIET_WORDS[interval](active.length)}</span>
          {active.map((i) => (
            <button
              key={buckets[i].from}
              type="button"
              aria-label={name(i)}
              aria-pressed={i === selectedIndex}
              onClick={() => toggle(i)}
              className={cn(
                'rounded-md border px-2 py-0.5 font-medium outline-offset-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                i === selectedIndex ? 'border-accent/40 bg-accent-dim text-accent' : 'border-border bg-raised text-foreground hover:border-border-strong',
              )}
            >
              {bucketLabel(buckets[i], interval, timeZone)} · {bucketCount(buckets[i], unit)}
            </button>
          ))}
          {/* A selection that is none of the buttons above (an empty bucket, or one of another window) needs its own way out. */}
          {!active.includes(selectedIndex) && chip}
        </div>
        {note}
      </div>
    );
  }

  // One stop for the Tab key: where the user last was, else the selected bucket, else the newest with runs.
  const stop = focused !== null && active.includes(focused)
    ? focused
    : active.includes(selectedIndex) ? selectedIndex : active[active.length - 1];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = Number((event.target as HTMLElement).dataset?.bucket);
    const at = active.indexOf(from);
    if (at === -1) return;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: active.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = active[Math.min(Math.max(to, 0), active.length - 1)];
    bars.current?.querySelector<HTMLElement>(`[data-bucket="${next}"]`)?.focus();
  };

  return (
    <div role="group" aria-label={`${units} over time`} data-testid="activity-strip">
      <div
        ref={bars}
        data-testid="activity-bars"
        className="grid items-end gap-px"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`, height: STRIP_HEIGHT_PX }}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHint('')}
      >
        {buckets.map((bucket, i) => (
          // The slot is drawn for every bucket: a quiet day reads as "nothing ran", not as a hole.
          <div
            key={bucket.from}
            data-testid="activity-slot"
            className="flex h-full min-w-0 items-end rounded-t-[2px] border-b border-border-strong bg-raised/40"
            onMouseEnter={() => setHint(name(i))}
          >
            {heights[i].bar > 0 && (
              <button
                type="button"
                data-testid="activity-bar"
                data-bucket={i}
                tabIndex={i === stop ? 0 : -1}
                aria-label={name(i)}
                aria-pressed={i === selectedIndex}
                title={name(i)}
                onClick={() => toggle(i)}
                onFocus={() => { setFocused(i); setHint(name(i)); }}
                onBlur={() => setHint('')}
                // The button is the whole slot, the coloured column only its lower part:
                // a day with one run is a 4 px bar, and must not be a 4 px target.
                className="group flex h-full w-full min-w-0 items-end rounded-t-[2px] outline-offset-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span
                  data-testid="activity-column"
                  style={{ height: heights[i].bar }}
                  className={cn(
                    'flex w-full min-w-0 flex-col-reverse overflow-hidden rounded-t-[2px] outline-offset-1 group-hover:outline group-hover:outline-1 group-hover:outline-foreground',
                    selected && i !== selectedIndex && 'opacity-40',
                    i === selectedIndex && 'outline outline-2 outline-accent',
                  )}
                >
                  {bucket.segments.map((segment, s) => heights[i].segments[s] > 0 && (
                    <span
                      key={segment.key}
                      data-testid="activity-segment"
                      data-segment={segment.key}
                      className={cn('block w-full shrink-0', MARK_BG[segment.tone])}
                      style={{ height: heights[i].segments[s] }}
                    />
                  ))}
                </span>
              </button>
            )}
          </div>
        ))}
      </div>
      <div data-testid="activity-ends" className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{bucketLabel(buckets[0], interval, timeZone)}</span>
        <span>{bucketLabel(buckets[buckets.length - 1], interval, timeZone)}</span>
      </div>
      <div className="flex min-h-6 items-center justify-between gap-3">
        {/* The colours in words, for the bucket under the focus or the pointer. */}
        <p data-testid="activity-hint" className="min-w-0 truncate text-[12px] text-muted empty:hidden">{hint}</p>
        {/* Otherwise the line says what a bar counts and what each colour is. */}
        {!hint && (
          <p data-testid="activity-legend" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
            <span>{units} per {interval}</span>
            {buckets[0].segments.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1">
                <span data-testid="activity-swatch" aria-hidden="true" className={cn('h-2 w-2 rounded-[2px]', MARK_BG[segment.tone])} />
                {segment.label}
              </span>
            ))}
          </p>
        )}
        {chip}
      </div>
      {note}
    </div>
  );
}
