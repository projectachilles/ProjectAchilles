import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface HeroMetricsCardProps {
  defenseScore: number | null;
  uniqueEndpoints: number;
  executedTests: number;
  /** Total executions in the window, shown compacted (e.g. "17k"). */
  totalResults?: number | null;
  errorRate?: number | null;
  /** EDR-only score (strict, on the same exclusion-filtered base as defenseScore). */
  realScore?: number | null;
  /** Combined score against the unfiltered (pre-risk-acceptance) base — the "Actual" row. */
  rawScore?: number | null;
  riskAcceptedCount?: number;
  /** Active date-range label, e.g. "90d window". */
  windowLabel?: string;
  loading?: boolean;
}

// Score-based semantic color: accent (≥80%), warning (≥60%), danger (<60%)
function scoreColorClass(score: number | null): string {
  if (score === null) return 'text-muted';
  if (score >= 80) return 'text-accent';
  if (score >= 60) return 'text-warning';
  return 'text-danger';
}

const RING_RADIUS = 38;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatCount(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

function LedgerRow({ label, value, valueClass, last }: { label: string; value: string; valueClass?: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-[7px] ${last ? '' : 'border-b border-raised'}`}>
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-mono text-xs ${valueClass ?? 'text-foreground'}`}>{value}</span>
    </div>
  );
}

/**
 * Defense Score ledger — ring gauge + score-breakdown rows + fleet facts.
 * Column-1 posture card of the Analytics dashboard tab (approved
 * "Analyst Columns" redesign): every row is data the API already returns,
 * replacing the old centered-number card's dead air.
 */
function HeroMetricsCard({
  defenseScore,
  uniqueEndpoints,
  executedTests,
  totalResults,
  errorRate,
  realScore,
  rawScore,
  riskAcceptedCount,
  windowLabel,
  loading,
}: HeroMetricsCardProps) {
  if (loading) {
    return (
      <Card className="flex flex-col gap-3 p-5" aria-busy="true">
        <Skeleton className="h-3 w-28" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-[92px] w-[92px] rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  // "Actual" is the raw (pre-risk-acceptance) score — only meaningful when
  // exclusions are active; otherwise it would just repeat the headline.
  const showActual = riskAcceptedCount != null && riskAcceptedCount > 0 && rawScore != null;
  // EDR-only differs from the headline only when Defender detections boost it.
  const showEdrOnly = defenseScore != null && realScore != null && realScore !== defenseScore;

  const ringClass = scoreColorClass(defenseScore);
  const ringFill = defenseScore != null ? Math.max(0, Math.min(100, defenseScore)) / 100 : 0;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">Defense Score</span>
        {windowLabel && <span className="font-mono text-[11px] text-muted">{windowLabel}</span>}
      </div>

      <div className="flex items-center gap-4">
        <div className={`shrink-0 ${ringClass}`}>
          <svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label={`Defense score ${defenseScore != null ? defenseScore.toFixed(1) : 'unavailable'}%`}>
            <circle cx="46" cy="46" r={RING_RADIUS} fill="none" className="stroke-raised" strokeWidth="8" />
            <circle
              cx="46"
              cy="46"
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(ringFill * RING_CIRCUMFERENCE).toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
              transform="rotate(-90 46 46)"
            />
            <text
              x="46"
              y="51"
              textAnchor="middle"
              fill="currentColor"
              stroke="none"
              className="font-mono text-[16px] font-semibold"
            >
              {defenseScore != null ? `${defenseScore.toFixed(1)}%` : '—'}
            </text>
          </svg>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <LedgerRow
            label="Actual"
            value={showActual ? `${rawScore.toFixed(1)}%` : '—'}
            valueClass={showActual ? scoreColorClass(rawScore) : 'text-faint'}
          />
          <LedgerRow
            label="EDR-only"
            value={showEdrOnly ? `${realScore.toFixed(1)}%` : '—'}
            valueClass={showEdrOnly ? undefined : 'text-faint'}
          />
          <LedgerRow
            label="Risk-accepted"
            value={riskAcceptedCount != null && riskAcceptedCount > 0 ? `${riskAcceptedCount} excluded` : 'none'}
            valueClass={riskAcceptedCount != null && riskAcceptedCount > 0 ? undefined : 'text-faint'}
          />
          <LedgerRow
            label="Inconclusive"
            value={errorRate != null && errorRate > 0 ? `${errorRate.toFixed(1)}%` : '—'}
            valueClass={errorRate != null && errorRate > 0 ? 'text-warning' : 'text-faint'}
            last
          />
        </div>
      </div>

      <div className="flex border-t border-border pt-3">
        <div className="flex flex-1 flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">Endpoints</span>
          <span className="font-mono text-xl font-semibold">{uniqueEndpoints.toLocaleString()}</span>
        </div>
        <div className="w-px bg-border" />
        <div className="flex flex-1 flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">Tests</span>
          <span className="font-mono text-xl font-semibold">{executedTests.toLocaleString()}</span>
        </div>
        <div className="w-px bg-border" />
        <div className="flex flex-1 flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">Results</span>
          <span className="font-mono text-xl font-semibold">{formatCount(totalResults)}</span>
        </div>
      </div>
    </Card>
  );
}

export default memo(HeroMetricsCard);
