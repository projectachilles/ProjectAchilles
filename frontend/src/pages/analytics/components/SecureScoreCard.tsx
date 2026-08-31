import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { SecureScoreSummary } from '@/services/api/defender';

interface SecureScoreCardProps {
  data: SecureScoreSummary | null;
  loading?: boolean;
}

// Score-based semantic color + matching bar fill: accent (≥80%), warning (≥60%), danger (<60%)
function scoreClasses(percentage: number): { text: string; bar: string } {
  if (percentage >= 80) return { text: 'text-accent', bar: 'bg-accent' };
  if (percentage >= 60) return { text: 'text-warning', bar: 'bg-warning' };
  return { text: 'text-danger', bar: 'bg-danger' };
}

/**
 * Compact Secure Score card — number + points progress bar + comparable-orgs
 * row (approved "Analyst Columns" redesign; replaces the old centered-number
 * card whose h-full stretch left a mostly-empty column).
 */
function SecureScoreCard({ data, loading }: SecureScoreCardProps) {
  if (loading || !data) {
    return (
      <Card className="flex flex-col gap-3 p-5" aria-busy="true">
        <Skeleton className="h-3 w-36" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-24" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </Card>
    );
  }

  const { text, bar } = scoreClasses(data.percentage);
  const fillPct = Math.max(0, Math.min(100, data.percentage));

  return (
    <Card className="flex flex-col gap-3 p-5">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
        Secure Score · Defender
      </span>
      <div className="flex items-center gap-4">
        <span className={`font-mono text-[32px] font-semibold leading-none ${text}`}>
          {data.percentage.toFixed(1)}%
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="h-1.5 rounded-full bg-raised">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${fillPct}%` }} />
          </div>
          <span className="font-mono text-[11px] text-muted">
            {data.currentScore.toFixed(1)} / {data.maxScore.toFixed(1)} pts
          </span>
        </div>
      </div>
      {data.averageComparative !== null && (
        <div className="flex items-center justify-between border-t border-raised pt-2">
          <span className="text-xs text-muted">Avg comparable orgs</span>
          <span className="font-mono text-xs">{data.averageComparative.toFixed(1)}%</span>
        </div>
      )}
    </Card>
  );
}

export default memo(SecureScoreCard);
