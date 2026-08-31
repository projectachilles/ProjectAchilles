import { memo, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { DefenseScoreByHostItem } from '@/services/api/analytics';

interface DefenseScoreByHostChartProps {
  data: DefenseScoreByHostItem[];
  loading?: boolean;
  title?: string;
  maxVisibleItems?: number;
}

// Score threshold colors — governed chart tokens for consistency with other charts
const SCORE_COLORS = {
  high: 'var(--chart-protected)', // ≥80%
  medium: 'var(--chart-warn)', // 50-79%
  low: 'var(--chart-bypassed)', // <50%
};

function getScoreColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.high;
  if (score >= 50) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
}

const ROW_HEIGHT = 30;

/**
 * Flat per-host score list (approved Analyst Columns artboard style):
 * mono hostname + slim threshold-colored bar + mono percentage.
 * Replaces the old SVG chart with inside-bar labels.
 */
function DefenseScoreByHostChart({
  data,
  loading,
  title = 'Defense Score by Host',
  maxVisibleItems = 8,
}: DefenseScoreByHostChartProps) {
  // Most active hosts first
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.total - a.total), [data]);

  if (loading) {
    return (
      <Card className="flex h-full flex-col gap-3 p-5" aria-busy="true">
        <Skeleton className="h-3 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription>Per-endpoint breakdown</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-faint">
            No data available
          </div>
        ) : (
          <div
            className="flex flex-col gap-2.5 overflow-y-auto"
            style={{ maxHeight: rows.length > maxVisibleItems ? `${maxVisibleItems * ROW_HEIGHT}px` : undefined }}
          >
            {rows.map((item) => (
              <div
                key={item.hostname}
                className="flex items-center gap-2.5"
                title={`${item.protected.toLocaleString()} protected · ${item.unprotected.toLocaleString()} unprotected · ${item.total.toLocaleString()} executions`}
              >
                <span className="w-[130px] shrink-0 truncate font-mono text-[11px] text-muted">
                  {item.hostname}
                </span>
                <div className="h-1.5 min-w-0 flex-1 rounded-full bg-raised">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, Math.min(100, item.score))}%`,
                      backgroundColor: getScoreColor(item.score),
                    }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right font-mono text-[11px] text-foreground">
                  {Math.round(item.score)}%
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-shrink-0 items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SCORE_COLORS.high }} />
            ≥80%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SCORE_COLORS.medium }} />
            50-79%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SCORE_COLORS.low }} />
            &lt;50%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(DefenseScoreByHostChart);
