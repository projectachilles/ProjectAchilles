import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CadenceView } from '../dashboardViews';
import { AnalyticsSetupPrompt } from './AnalyticsSetupPrompt';

const TONE_CLASS = {
  accent: 'text-accent',
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  muted: 'text-muted',
} as const;

interface TestingCadenceCardProps {
  view: CadenceView | null;
  /** Analytics (Elasticsearch) is configured; false shows a setup prompt. */
  configured: boolean;
  loading?: boolean;
}

const CHIP = 'w-fit shrink-0 self-start rounded-md px-2 py-1 font-mono text-[11px]';
const TILE = 'flex flex-col gap-1 rounded-lg border border-border bg-raised px-3 py-2.5';
const TILE_LABEL = 'font-mono text-[10.5px] uppercase tracking-wider text-muted';

function shortDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

function lastRunChip(view: CadenceView): { text: string; className: string } {
  const ago = view.lastRunDaysAgo;
  if (ago == null) return { text: 'no runs yet', className: 'bg-danger-dim text-danger' };
  const text = ago === 0 ? 'last run today' : `last run ${ago}d ago`;
  if (ago > 7) return { text, className: 'bg-danger-dim text-danger' };
  if (ago >= 2) return { text, className: 'bg-warning-dim text-warning' };
  return { text, className: 'bg-raised text-muted' };
}

export function TestingCadenceCard({ view, configured, loading }: TestingCadenceCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }
  if (!configured || !view) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Testing cadence</CardTitle>
          <CardDescription>Is the programme actually running?</CardDescription>
        </CardHeader>
        {!configured ? (
          <CardContent>
            <AnalyticsSetupPrompt subject="testing cadence" />
          </CardContent>
        ) : (
          <CardContent className="flex h-40 items-center justify-center text-sm text-faint">
            Couldn't load testing cadence — try again later
          </CardContent>
        )}
      </Card>
    );
  }

  const chip = lastRunChip(view);
  const max = Math.max(1, ...view.bars.map((d) => d.protected + d.unprotected + d.inconclusive));
  const totals = view.bars.reduce(
    (a, d) => ({
      p: a.p + d.protected,
      u: a.u + d.unprotected,
      i: a.i + d.inconclusive,
    }),
    { p: 0, u: 0, i: 0 },
  );
  const ariaLabel = `Daily executions for ${view.bars.length} days, stacked by outcome: ${totals.p} protected, ${totals.u} got through, ${totals.i} inconclusive`;
  const first = view.bars[0]?.date;
  const mid = view.bars[Math.floor(view.bars.length / 2)]?.date;
  const last = view.bars[view.bars.length - 1]?.date;

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 grid-rows-1">
        <div className="flex flex-col gap-1">
          <CardTitle>Testing cadence</CardTitle>
          <CardDescription>Is the programme actually running?</CardDescription>
        </div>
        <span className={cn(CHIP, chip.className)}>{chip.text}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between font-mono text-[11px] text-muted">
            <span>executions / day · {view.bars.length}d</span>
            <span>{view.executions7d} in 7d</span>
          </div>
          <div
            role="img"
            aria-label={ariaLabel}
            className="flex h-28 items-end gap-1 border-b border-border"
          >
            {view.bars.map((d) => {
              const total = d.protected + d.unprotected + d.inconclusive;
              return (
                <div
                  key={d.date}
                  title={`${shortDay(d.date)}: ${total} executions`}
                  className="flex h-full min-w-0 flex-1 flex-col-reverse gap-px"
                >
                  <div className="rounded-b-sm bg-accent" style={{ height: `${(d.protected / max) * 100}%` }} />
                  <div className="bg-danger" style={{ height: `${(d.unprotected / max) * 100}%` }} />
                  <div className="rounded-t-sm bg-overlay" style={{ height: `${(d.inconclusive / max) * 100}%` }} />
                </div>
              );
            })}
          </div>
          {/* The backend zero-fills every day, so the bars are never empty. */}
          <div className="flex justify-between font-mono text-[10.5px] text-muted">
            <span>{first ? shortDay(first) : ''}</span>
            <span>{mid ? shortDay(mid) : ''}</span>
            <span>{last ? shortDay(last) : ''}</span>
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-sm bg-accent" />protected</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-sm bg-danger" />got through</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-sm bg-overlay ring-1 ring-border-strong" />inconclusive</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className={TILE}>
            <span className={TILE_LABEL}>Endpoints tested · 7d</span>
            <span className="text-lg font-semibold">
              {view.endpointsTested7d}
              {view.agentsTotal > 0 && (
                <span className="text-[13px] font-normal text-muted"> / {view.agentsTotal}</span>
              )}
            </span>
          </div>
          <div className={TILE}>
            <span className={TILE_LABEL}>{view.taskActivity?.label ?? 'Runs · 7d'}</span>
            {view.taskActivity ? (
              <span className="text-[13px]">
                {view.taskActivity.parts.map((p, i) => (
                  <Fragment key={p.text}>
                    {i > 0 && ' · '}
                    <span className={TONE_CLASS[p.tone]}>{p.text}</span>
                  </Fragment>
                ))}
              </span>
            ) : (
              <span className="text-[13px] text-faint">—</span>
            )}
          </div>
          {/* Hidden when schedules can't be read (no permission), so it never says "Nothing scheduled" wrongly. */}
          {view.schedulesAvailable && (
            <div className={cn(TILE, 'col-span-2 flex-row items-center justify-between gap-2.5')}>
              <div className="flex min-w-0 flex-col gap-1">
                <span className={TILE_LABEL}>Next scheduled</span>
                <span className="truncate text-[13px]">
                  {view.nextScheduled
                    ? `${formatWhen(view.nextScheduled.when)} · ${view.nextScheduled.label} on ${view.nextScheduled.endpoints} endpoints`
                    : 'Nothing scheduled'}
                </span>
              </div>
              <Link to="/tasks" className="shrink-0 text-[12.5px] text-accent hover:underline">
                Tasks →
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
