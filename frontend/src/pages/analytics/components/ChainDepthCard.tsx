import { memo } from 'react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ChainDepthResponse } from '@/services/api/analytics';

interface ChainDepthCardProps {
  /** null after a failed fetch. */
  data: ChainDepthResponse | null;
  loading?: boolean;
  /** Row click: the bundle names of the chains in that row. */
  onRowClick?: (bundleNames: string[]) => void;
}

const TITLE = 'How deep attack chains get';
const DESCRIPTION = "Stage where each chain's latest run was blocked";

interface Row {
  label: string;
  /** Second label line for the end-to-end rows: detected / undetected. */
  sub?: string;
  count: number;
  /** Stage rows only: chains blocked here after an earlier EDR alert. */
  alerted: number;
  bundleNames: string[];
  kind: 'stage' | 'preExec' | 'detected' | 'undetected';
}

const chainCount = (n: number) => `${n} ${n === 1 ? 'chain' : 'chains'}`;

function rowsOf(data: ChainDepthResponse): Row[] {
  const rows: Row[] = data.buckets.map((b) => ({
    label: b.stage === 4 ? 'Stage 4+' : `Stage ${b.stage}`,
    count: b.blocked,
    alerted: b.alertedNotBlocked,
    bundleNames: b.bundleNames,
    kind: 'stage' as const,
  }));
  // A control stopped the test binary before a stage ran (exit 260, e.g. an
  // ASR prevalence rule). The technique was never evaluated, so this is a
  // neutral row, never a blocked stage. Older backends don't send it.
  if (data.blockedBeforeRun !== undefined) {
    rows.push({
      label: 'Stage not run',
      sub: 'binary blocked',
      count: data.blockedBeforeRun,
      alerted: 0,
      bundleNames: data.blockedBeforeRunBundleNames ?? [],
      kind: 'preExec',
    });
  }
  // Chains nothing blocked, split by whether an EDR at least alerted: the
  // Defense Score counts a detection as protected, chain depth only a block
  rows.push(
    // The two name lists are newer than the counts: during a deploy the
    // frontend can be ahead of the backend, so never assume they exist
    {
      label: 'End to end',
      sub: 'detected',
      count: data.endToEndAlerted,
      alerted: 0,
      bundleNames: data.endToEndAlertedBundleNames ?? [],
      kind: 'detected',
    },
    {
      label: 'End to end',
      sub: 'undetected',
      count: data.endToEnd - data.endToEndAlerted,
      alerted: 0,
      bundleNames: data.endToEndUndetectedBundleNames ?? data.endToEndBundleNames ?? [],
      kind: 'undetected',
    },
  );
  return rows;
}

function rowName(row: Row): string {
  const name = row.sub ? `${row.label} · ${row.sub}` : row.label;
  if (row.count === 0) return `${name}: no chains`;
  if (row.kind === 'stage') {
    return `${name}: ${chainCount(row.count)} blocked, ${row.alerted} after an earlier EDR alert. Show these runs`;
  }
  if (row.kind === 'preExec') {
    return `${name}: ${chainCount(row.count)} — a control stopped the test binary before it ran, so the technique was not tested. Show these runs`;
  }
  const how = row.kind === 'detected' ? 'an EDR alerted' : 'no alert';
  return `${name}: ${chainCount(row.count)} ran every stage, ${how}. Show these runs`;
}

const MAIN_COLOR: Record<Row['kind'], string> = {
  stage: 'var(--chart-protected)',
  preExec: 'var(--chart-cat-2)',
  detected: 'var(--chart-warn)',
  undetected: 'var(--chart-bypassed)',
};

function Frame({ chip, children }: { chip?: string; children: ReactNode }) {
  return (
    <Card className="h-full">
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

function ChainDepthCard({ data, loading, onRowClick }: ChainDepthCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }
  if (!data) {
    return (
      <Frame>
        <CardContent className="flex h-40 items-center justify-center text-sm text-faint">
          Couldn't load chain depth
        </CardContent>
      </Frame>
    );
  }
  const terminated = data.agentTerminated ?? 0;
  if (data.chains === 0 && data.inconclusive === 0 && (data.blockedBeforeRun ?? 0) === 0) {
    return (
      <Frame>
        <CardContent className="flex h-40 items-center justify-center text-sm text-faint">
          No multi-stage chains in this window
        </CardContent>
      </Frame>
    );
  }

  const rows = rowsOf(data);
  const max = Math.max(1, ...rows.map((r) => r.count));
  // The chip totals the rows; stage errors stay out of both (footer only)
  const shown = data.chains + (data.blockedBeforeRun ?? 0);
  const split = data.stageErrors !== undefined;

  return (
    <Frame chip={chainCount(shown)}>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => {
            const alerted = Math.min(row.alerted, row.count);
            return (
              <button
                key={row.sub ? `${row.label}-${row.sub}` : row.label}
                type="button"
                disabled={row.count === 0}
                onClick={() => onRowClick?.(row.bundleNames)}
                aria-label={rowName(row)}
                title={row.bundleNames.length > 0 ? row.bundleNames.join(', ') : undefined}
                className="grid w-full grid-cols-[92px_minmax(0,1fr)_64px] items-center gap-x-2.5 rounded px-1 py-1 text-left transition-colors enabled:hover:bg-raised disabled:cursor-default"
              >
                <span
                  className={cn(
                    'flex min-w-0 flex-col text-xs leading-tight',
                    row.kind === 'preExec' && 'text-info',
                    row.kind === 'detected' && 'text-warning',
                    row.kind === 'undetected' && 'text-danger',
                  )}
                >
                  <span className="truncate">{row.label}</span>
                  {row.sub && <span className="truncate text-[10.5px] opacity-80">{row.sub}</span>}
                </span>
                <span className="flex h-2.5 overflow-hidden rounded-sm bg-raised">
                  <span
                    data-segment="main"
                    className="h-full"
                    style={{
                      width: `${((row.count - alerted) / max) * 100}%`,
                      backgroundColor: MAIN_COLOR[row.kind],
                    }}
                  />
                  <span
                    data-segment="alerted"
                    className="h-full"
                    style={{ width: `${(alerted / max) * 100}%`, backgroundColor: 'var(--chart-warn)' }}
                  />
                </span>
                <span
                  className={cn(
                    'text-right font-mono text-[11px]',
                    row.count > 0 && row.kind === 'undetected'
                      ? 'text-danger'
                      : row.count > 0 && row.kind === 'detected'
                        ? 'text-warning'
                        : 'text-muted',
                  )}
                >
                  {chainCount(row.count)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-2.5 text-xs text-muted">
          <div className="flex flex-wrap gap-x-3.5 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: 'var(--chart-protected)' }}
                aria-hidden="true"
              />
              blocked at this stage
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: 'var(--chart-warn)' }}
                aria-hidden="true"
              />
              EDR alerted, didn't block
            </span>
            {(data.blockedBeforeRun ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: 'var(--chart-cat-2)' }}
                  aria-hidden="true"
                />
                blocked before running (not a technique result)
              </span>
            )}
          </div>
          {terminated > 0 && (
            <span title={(data.agentTerminatedBundleNames ?? []).join(', ') || undefined}>
              {`Stopped by EDR, stage unknown: ${terminated}`}
              {(data.agentTerminatedBundleNames ?? []).length > 0 && ` (${(data.agentTerminatedBundleNames ?? []).join(', ')})`}
            </span>
          )}
          {split
            ? (data.stageErrors ?? 0) > 0 && (
                <span>{`${chainCount(data.stageErrors ?? 0)} with a stage error — not shown`}</span>
              )
            : data.inconclusive > 0 && (
                <span>
                  {`${chainCount(data.inconclusive)} inconclusive — a stage errored or was blocked before it ran — not shown`}
                </span>
              )}
          <span>Follows the filter bar — pick an actor to see how far its chains get. Click a row for those runs.</span>
        </div>
      </CardContent>
    </Frame>
  );
}

export default memo(ChainDepthCard);
