import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { POSTURE_HELP, postureCaption, scoreTone } from '@/lib/posture';

interface HeroMetricsCardProps {
  defenseScore: number | null;
  uniqueEndpoints: number;
  executedTests: number;
  /** Total executions in the window, shown compacted (e.g. "17k"). */
  totalResults?: number | null;
  /**
   * Pairs with results in the window but no conclusive one yet (latest basis,
   * the Outcome breakdown's "No conclusive result yet"). The Inconclusive row
   * is their share of all pairs; undefined shows a dash.
   */
  noConclusiveCount?: number | null;
  /** EDR-only score (strict, on the same exclusion-filtered base as defenseScore). */
  realScore?: number | null;
  /** Combined score against the unfiltered (pre-risk-acceptance) base — the "Actual" row. */
  rawScore?: number | null;
  riskAcceptedCount?: number;
  /** Active window label, e.g. "90d" or "last 365d". */
  windowLabel?: string;
  /** Test x endpoint pairs behind the score (latest-result basis). Switches the footer to PAIRS. */
  pairCount?: number | null;
  /** The score endpoint's own score; EDR-only is compared against it so both sides come from one response. Defaults to defenseScore. */
  tileScore?: number | null;
  /** Change in score across the window, in points. */
  delta?: number | null;
  loading?: boolean;
}

const TONE_CLASS = {
  muted: 'text-muted',
  danger: 'text-danger',
  warning: 'text-warning',
  accent: 'text-accent',
} as const;

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
  noConclusiveCount,
  realScore,
  rawScore,
  riskAcceptedCount,
  windowLabel,
  pairCount,
  tileScore,
  delta,
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
  const edrBase = tileScore !== undefined ? tileScore : defenseScore;
  const showEdrOnly = edrBase != null && realScore != null && realScore !== edrBase;

  const hasPairs = pairCount !== undefined;
  // Same unit as the PAIRS footer: pairs with no verdict yet, out of all pairs with results.
  const inconclusiveBase = (pairCount ?? 0) + (noConclusiveCount ?? 0);
  const inconclusivePct = noConclusiveCount != null && inconclusiveBase > 0 ? (noConclusiveCount / inconclusiveBase) * 100 : null;
  const ringClass = hasPairs ? TONE_CLASS[scoreTone(defenseScore, pairCount)] : scoreColorClass(defenseScore);
  const ringFill = defenseScore != null ? Math.max(0, Math.min(100, defenseScore)) / 100 : 0;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">Defense Score</span>
        {windowLabel && <span className="font-mono text-[11px] text-muted">{windowLabel}</span>}
      </div>

      <div className="flex items-center gap-4">
        <div className={`shrink-0 ${ringClass}`} title={POSTURE_HELP}>
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
            value={inconclusivePct != null && inconclusivePct > 0 ? `${inconclusivePct.toFixed(1)}%` : '—'}
            valueClass={inconclusivePct != null && inconclusivePct > 0 ? 'text-warning' : 'text-faint'}
            last
          />
        </div>
      </div>

      {hasPairs && (
        <p className="font-mono text-[11px] text-muted">
          {postureCaption(pairCount, delta ?? null, windowLabel ?? '')}
        </p>
      )}

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
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">{hasPairs ? 'Pairs' : 'Results'}</span>
          <span className="font-mono text-xl font-semibold">{formatCount(hasPairs ? pairCount : totalResults)}</span>
        </div>
      </div>
    </Card>
  );
}

export default memo(HeroMetricsCard);
