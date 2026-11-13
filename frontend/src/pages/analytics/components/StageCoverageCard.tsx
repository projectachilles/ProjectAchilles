import { memo } from 'react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { StageCoverageGroup, StageCoverageResponse } from '@/services/api/analytics';

interface StageCoverageCardProps {
  /** null after a failed fetch (or a backend that doesn't have the endpoint yet). */
  data: StageCoverageResponse | null;
  loading?: boolean;
  /** Row click: the bundle names of the chains in that row. */
  onRowClick?: (bundleNames: string[]) => void;
}

const TITLE = 'Stage coverage';
const DESCRIPTION = "Stages caught in each attack chain's latest run";

type RowKind = 'single' | 'untested' | 'layered' | 'none';

interface Row {
  kind: RowKind;
  label: string;
  sub: string;
  group: StageCoverageGroup;
}

const chainCount = (n: number) => `${n} ${n === 1 ? 'chain' : 'chains'}`;

function rowsOf(data: StageCoverageResponse): Row[] {
  return [
    { kind: 'single', label: 'Rest on a single stage', sub: 'ran every stage, one caught', group: data.singleStage },
    { kind: 'untested', label: 'Depth not tested', sub: 'later stages did not run', group: data.depthNotTested },
    { kind: 'layered', label: 'Two or more stages caught', sub: 'layered', group: data.layered },
    { kind: 'none', label: 'No stage caught', sub: 'ran end to end', group: data.noneCaught },
  ];
}

const ROW_COLOR: Record<RowKind, string> = {
  single: 'text-warning',
  untested: 'text-info',
  layered: '',
  none: 'text-danger',
};

/** What a row means, for screen readers (the visible sub-label is terse). */
const ROW_MEANING: Record<RowKind, string> = {
  single: 'ran every stage and exactly one was caught',
  untested: 'had one stage caught and later stages that did not run',
  layered: 'had two or more stages caught',
  none: 'ran end to end with no stage caught',
};

function rowName(row: Row): string {
  if (row.group.count === 0) return `${row.label}: no chains`;
  return `${row.label}: ${chainCount(row.group.count)} ${ROW_MEANING[row.kind]}. Show these runs`;
}

const SEGMENTS = [
  { key: 'blocked', label: 'blocked', color: 'var(--chart-protected)' },
  { key: 'detected', label: 'detected', color: 'var(--chart-warn)' },
  { key: 'through', label: 'got through', color: 'var(--chart-bypassed)' },
] as const;

function Frame({ chip, children }: { chip?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle>{TITLE}</CardTitle>
        <CardDescription className="col-start-1">{DESCRIPTION}</CardDescription>
        {chip && (
          <span className="col-start-2 row-span-2 row-start-1 w-fit shrink-0 self-start rounded-md bg-raised px-2 py-1 font-mono text-[11px] text-muted">
            {chip}
          </span>
        )}
      </CardHeader>
      {children}
    </Card>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <Frame>
      <CardContent className="flex h-28 items-center justify-center text-sm text-faint">{children}</CardContent>
    </Frame>
  );
}

function StageCoverageCard({ data, loading, onRowClick }: StageCoverageCardProps) {
  if (loading) {
    return <div className="h-52 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }
  if (!data) return <Message>Couldn't load stage coverage</Message>;
  if (data.chains === 0) return <Message>No multi-stage chains in this window</Message>;

  const caught = data.blocked + data.detected;
  const width = (n: number) => (data.stagesRan > 0 ? `${(n / data.stagesRan) * 100}%` : '0%');
  const chainScore = Math.round((data.chainsProtected / data.chains) * 100);

  return (
    <Frame chip={chainCount(data.chains)}>
      <CardContent className="grid gap-x-7 gap-y-4 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-4xl font-semibold leading-none">
              {data.coverage === null ? '—' : `${Math.round(data.coverage)}%`}
            </span>
            <span className="text-[13px] text-muted">{`${caught} of ${data.stagesRan} stages caught`}</span>
          </div>
          <div
            role="img"
            aria-label={`${data.blocked} stages blocked, ${data.detected} detected, ${data.through} got through`}
            className="mb-2 mt-3.5 flex h-2.5 overflow-hidden rounded-sm bg-raised"
          >
            {SEGMENTS.map((s) => (
              <span key={s.key} data-segment={s.key} className="h-full" style={{ width: width(data[s.key]), backgroundColor: s.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
            {SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden="true" />
                {s.label}
                <span className="font-mono">{data[s.key]}</span>
              </span>
            ))}
          </div>
          <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted">
            Defense Score for these chains: <span className="font-mono font-semibold text-foreground">{`${chainScore}%`}</span>
            {` (${data.chainsProtected} of ${data.chains}). It counts a chain as protected once any stage is caught.`}
          </p>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-col gap-1">
            {rowsOf(data).map((row) => {
              const names = row.group.bundleNames.join(', ');
              const active = row.group.count > 0;
              return (
                <button
                  key={row.kind}
                  type="button"
                  disabled={!active}
                  onClick={() => onRowClick?.(row.group.bundleNames)}
                  aria-label={rowName(row)}
                  title={names || undefined}
                  className="grid w-full grid-cols-[minmax(0,1fr)_64px] items-center sm:grid-cols-[172px_minmax(0,1fr)_64px] gap-x-2.5 rounded px-1 py-1 text-left transition-colors enabled:hover:bg-raised disabled:cursor-default"
                >
                  <span className={cn('flex min-w-0 flex-col text-xs leading-tight', active ? ROW_COLOR[row.kind] : 'text-muted')}>
                    <span className="truncate">{row.label}</span>
                    <span className="truncate text-[10.5px] opacity-80">{row.sub}</span>
                  </span>
                  <span className="hidden truncate text-[11.5px] text-muted sm:block">{names}</span>
                  <span
                    className={cn(
                      'text-right font-mono text-[11px]',
                      active && row.kind !== 'layered' ? ROW_COLOR[row.kind] : 'text-muted',
                    )}
                  >
                    {chainCount(row.group.count)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-auto border-t border-border pt-2.5 text-xs text-muted">
            A chain is one multi-stage test on one host. Runs the EDR stopped before any stage (agent killed, blocked at
            launch) are not counted here. Click a row for those runs.
          </p>
        </div>
      </CardContent>
    </Frame>
  );
}

export default memo(StageCoverageCard);
