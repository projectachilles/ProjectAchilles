import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/shared/ui/Dialog';
import { cn } from '@/lib/utils';
import type { MovementListKey, MovementOrigin, MovementRow, ScoreMovementResponse } from '@/services/api/analytics';
import type { MovementPanel, MovementSegment, ScoreMovementView, SegmentTone } from '../scoreMovementView';

export interface ScoreMovementCardProps {
  view: ScoreMovementView | null;
  lists: ScoreMovementResponse['lists'] | null;
  loading: boolean;
  error: boolean;
  /** Start of the period (ISO), for "before <date>" on failures that were open already. */
  periodStart?: string;
}

const TONE_BG: Record<Exclude<SegmentTone, 'faint'>, string> = {
  accent: 'bg-accent',
  danger: 'bg-danger',
  warning: 'bg-warning',
};

const HATCH = 'repeating-linear-gradient(135deg, var(--faint) 0 3px, var(--border) 3px 6px)';

const ORIGIN_LABEL: Record<MovementOrigin, string> = {
  open_at_start: 'Open at the start',
  older_retested: 'Older failure re-tested',
  regression: 'Regression',
  new_test: 'New test',
  first_on_endpoint: 'First time on an endpoint',
};

const DASH = '–';

function formatDay(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function toneStyle(tone: SegmentTone) {
  return tone === 'faint' ? { background: HATCH } : undefined;
}

function Swatch({ tone }: { tone: SegmentTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-[9px] shrink-0 rounded-[2px]', tone !== 'faint' && TONE_BG[tone])}
      style={toneStyle(tone)}
    />
  );
}

function Bar({ segments }: { segments: MovementSegment[] }) {
  const shown = segments.filter((s) => s.count > 0);
  const label = segments.map((s) => `${s.label} ${s.count}`).join(', ');
  return (
    <div role="img" aria-label={label} className="my-3 flex h-2.5 gap-0.5 overflow-hidden rounded bg-border">
      {shown.map((s) => (
        <div
          key={s.list}
          className={cn(s.tone !== 'faint' && TONE_BG[s.tone])}
          style={{ flex: `${s.count} 1 0`, ...toneStyle(s.tone) }}
        />
      ))}
    </div>
  );
}

function SegmentRow({ segment, onView }: { segment: MovementSegment; onView: (list: MovementListKey) => void }) {
  return (
    <div className="grid grid-cols-[12px_minmax(0,1fr)_2.5rem_3.5rem] items-center gap-2 py-1">
      <Swatch tone={segment.tone} />
      <span className="min-w-0 text-[13px]">
        {segment.label}
        {segment.hint && <span className="ml-1.5 text-[11.5px] text-faint">{segment.hint}</span>}
      </span>
      <span className="text-right font-mono text-xs">{segment.count}</span>
      {segment.count > 0 ? (
        <button
          type="button"
          aria-label={`View ${segment.label} (${segment.count})`}
          onClick={() => onView(segment.list)}
          className="text-right text-xs text-accent hover:underline"
        >
          view →
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function Panel({
  label,
  panel,
  onView,
}: {
  label: string;
  panel: MovementPanel;
  onView: (list: MovementListKey) => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-raised px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{label}</div>
      {panel.empty ? (
        <div className="flex h-32 items-center justify-center text-sm text-faint">{panel.empty}</div>
      ) : (
        <>
          <div className="mt-1.5 text-[26px] font-semibold">
            {panel.headline}
            {panel.rate && <span className="ml-2 font-mono text-[13px] font-normal text-muted">{panel.rate}</span>}
          </div>
          <Bar segments={panel.segments} />
          {panel.segments.map((s) => (
            <SegmentRow key={s.list} segment={s} onView={onView} />
          ))}
          {panel.note && <div className="mt-2 text-[11.5px] text-faint">{panel.note}</div>}
        </>
      )}
    </div>
  );
}

function ListDialog({
  segment,
  list,
  periodStart,
  onClose,
}: {
  segment: MovementSegment;
  list: { total: number; rows: MovementRow[] } | undefined;
  periodStart?: string;
  onClose: () => void;
}) {
  const rows = list?.rows ?? [];
  const total = list?.total ?? 0;
  const showFixed = segment.list === 'fixed';
  const firstRuns = segment.list === 'newStopped' || segment.list === 'newGotThrough';
  const failingSince = (row: MovementRow): string => {
    if (firstRuns) return DASH;
    if (row.openBeforePeriod) return periodStart ? `before ${formatDay(periodStart)}` : 'before the period';
    return row.failingSince ? formatDay(row.failingSince) : DASH;
  };

  return (
    <Dialog open onClose={onClose} className="max-w-4xl">
      <div role="dialog" aria-modal="true" aria-labelledby="score-movement-list-title">
        <DialogHeader onClose={onClose}>
          <span id="score-movement-list-title">
            <DialogTitle>{segment.label}</DialogTitle>
          </span>
          {segment.hint && <p className="mt-1 text-xs text-muted">{segment.hint}</p>}
        </DialogHeader>
        <DialogContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-1.5 pr-3 font-medium">Test</th>
                  <th className="py-1.5 pr-3 font-medium">Endpoint</th>
                  <th className="py-1.5 pr-3 font-medium">Origin</th>
                  <th className="py-1.5 pr-3 font-medium">Failing since</th>
                  {showFixed && <th className="py-1.5 pr-3 font-medium">Fixed</th>}
                  <th className="py-1.5 font-medium">Last result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.testUuid}:${row.controlId ?? ''}:${row.hostname}:${i}`} className="border-b border-border/50">
                    <td className="max-w-[18rem] py-1.5 pr-3">
                      <Link to={`/tests/${row.testUuid}`} className="text-accent hover:underline">
                        {row.testName}
                      </Link>
                      {row.controlId && <span className="ml-1.5 font-mono text-faint">{row.controlId}</span>}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{row.hostname}</td>
                    <td className="py-1.5 pr-3">{row.origin ? ORIGIN_LABEL[row.origin] : ''}</td>
                    <td data-col="failing-since" className="py-1.5 pr-3 font-mono">
                      {failingSince(row)}
                    </td>
                    {showFixed && (
                      <td className="py-1.5 pr-3 font-mono">{row.fixedAt ? formatDay(row.fixedAt) : DASH}</td>
                    )}
                    <td className="py-1.5 font-mono">{formatDay(row.lastResultAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length < total && (
            <p className="mt-3 text-xs text-muted">
              Showing {rows.length} of {total}
            </p>
          )}
        </DialogContent>
      </div>
    </Dialog>
  );
}

export function ScoreMovementCard({ view, lists, loading, error, periodStart }: ScoreMovementCardProps) {
  const [open, setOpen] = useState<MovementListKey | null>(null);

  // While a new range loads the hook still holds the previous range's figures:
  // never show them under the new range's label.
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }
  if (error || !view) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What moved the score</CardTitle>
        </CardHeader>
        <CardContent className="flex h-24 items-center justify-center text-sm text-faint">
          Couldn't load score movement, try again later
        </CardContent>
      </Card>
    );
  }

  const openSegment =
    open === null ? undefined : [...view.failures.segments, ...view.newTests.segments].find((s) => s.list === open);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{view.title}</CardTitle>
          <div className="text-[13px] text-muted">{view.description}</div>
        </div>
        {view.pill && (
          <span className="shrink-0 rounded-md bg-warning-dim px-2 py-1 font-mono text-[11px] text-warning">
            {view.pill}
          </span>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel label="Failures dealt with" panel={view.failures} onView={setOpen} />
          <Panel label="New tests · first run" panel={view.newTests} onView={setOpen} />
        </div>
        {view.footer.length > 0 && (
          <ul className="mt-3.5 flex flex-col gap-1 border-t border-border pt-2.5 text-xs text-muted">
            {view.footer.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </CardContent>
      {openSegment && (
        <ListDialog
          segment={openSegment}
          list={lists?.[openSegment.list]}
          periodStart={periodStart}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  );
}
