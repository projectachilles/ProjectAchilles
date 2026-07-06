import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BulletBar } from '@/components/shared/ui/BulletBar';
import Sparkline from './Sparkline';

interface StatusCommandBarProps {
  defenseScore: number | null;
  defenseDelta?: number | null;
  defenseTrend?: number[];
  actualScore?: number | null;
  excludedCount?: number;
  edrOnlyScore?: number | null;
  inconclusiveRate?: number | null;
  secureScore?: number | null;
  uniqueEndpoints: number;
  executedTests: number;
  bypassedCount: number;
  bypassedTacticCount?: number;
  loading?: boolean;
}

const DEFENSE_TARGET = 80;

function formatScore(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${score.toFixed(1)}%`;
}

function DeltaChip({ delta }: { delta: number }) {
  const positive = delta >= 0;
  const color = positive ? 'var(--success)' : 'var(--chart-bypassed)';
  const arrow = positive ? '▲' : '▼';
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium tabular-nums"
      style={{ color }}
    >
      {arrow} {Math.abs(delta).toFixed(1)} 7d
    </span>
  );
}

function StatusCommandBar({
  defenseScore,
  defenseDelta,
  defenseTrend,
  actualScore,
  excludedCount,
  edrOnlyScore,
  inconclusiveRate,
  secureScore,
  uniqueEndpoints,
  executedTests,
  bypassedCount,
  bypassedTacticCount,
  loading,
}: StatusCommandBarProps) {
  if (loading) {
    return (
      <Card aria-busy="true" className="p-4 sm:p-6">
        <div className="flex flex-wrap gap-6">
          <div className="flex-[2] min-w-[200px] space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex-1 min-w-[120px] space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
          <div className="flex-1 min-w-[120px] space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
      </Card>
    );
  }

  const showEdrOnly =
    defenseScore != null && edrOnlyScore != null && edrOnlyScore !== defenseScore;
  const showInconclusive = inconclusiveRate != null && inconclusiveRate > 0;
  const showExcluded = excludedCount != null && excludedCount > 0;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border">
        {/* Defense Score cell */}
        <div className="flex-[2] min-w-[220px] px-4 sm:px-6 py-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Defense Score
            </span>
            {defenseDelta != null && <DeltaChip delta={defenseDelta} />}
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {formatScore(defenseScore)}
            </span>
            {defenseTrend && defenseTrend.length >= 2 && (
              <Sparkline
                data={defenseTrend}
                width={80}
                height={24}
                className="text-primary"
                ariaLabel="Defense score 7-day trend"
              />
            )}
          </div>

          <BulletBar
            value={defenseScore ?? 0}
            target={DEFENSE_TARGET}
            height={8}
            aria-label="Defense score vs target"
          />

          <div className="text-xs text-muted-foreground">
            actual {actualScore != null ? `${actualScore.toFixed(1)}%` : '—'} · target{' '}
            {DEFENSE_TARGET}%
            {showExcluded && <span> ({excludedCount} excluded)</span>}
          </div>

          {showEdrOnly && (
            <div className="text-xs text-muted-foreground">
              EDR-only: {edrOnlyScore!.toFixed(1)}%
            </div>
          )}

          {showInconclusive && (
            <div className="text-xs" style={{ color: 'var(--chart-warn)' }}>
              {inconclusiveRate!.toFixed(1)}% inconclusive
            </div>
          )}
        </div>

        {/* Secure Score cell — only when Defender is configured */}
        {secureScore != null && (
          <div className="flex-1 min-w-[120px] px-4 sm:px-6 py-4 space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Secure Score
            </span>
            <div className="text-2xl font-bold tabular-nums text-foreground">
              {secureScore.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">Microsoft Defender</div>
          </div>
        )}

        {/* Fleet cell */}
        <div className="flex-1 min-w-[120px] px-4 sm:px-6 py-4 space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fleet
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {uniqueEndpoints.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">endpoints</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {executedTests.toLocaleString()} tests
          </div>
        </div>

        {/* Needs attention cell */}
        <div className="flex-1 min-w-[120px] px-4 sm:px-6 py-4 space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Needs attention
          </span>
          <div className="flex items-baseline gap-1">
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color: 'var(--chart-bypassed)' }}
            >
              {bypassedCount.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">bypassed</span>
          </div>
          {bypassedTacticCount != null && (
            <div className="text-xs text-muted-foreground">
              {bypassedTacticCount.toLocaleString()} tactics
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export { StatusCommandBar };
export default StatusCommandBar;
