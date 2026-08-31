import { memo, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface StackedBarChartProps {
  data: Array<{
    name?: string;
    technique?: string;
    protected: number;
    unprotected: number;
  }>;
  loading?: boolean;
  title?: string;
  description?: string;
  maxVisibleItems?: number;
}

const ROW_HEIGHT = 44; // label line + bar + gap

/**
 * Flat protected-vs-unprotected bar list (approved Analyst Columns
 * artboard style): mono label + count, full-width split bar with a
 * 2px surface gap between the segments. Replaces the old SVG chart.
 */
function StackedBarChart({
  data,
  loading,
  title = 'Test Coverage',
  description = 'Protected vs unprotected executions',
  maxVisibleItems = 8,
}: StackedBarChartProps) {
  const rows = useMemo(() => {
    return (data ?? [])
      .map((d) => {
        const total = d.protected + d.unprotected;
        return {
          label: d.name ?? d.technique ?? '—',
          protected: d.protected,
          unprotected: d.unprotected,
          total,
          pct: total > 0 ? (d.protected / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [data]);

  if (loading) {
    return (
      <Card className="flex h-full flex-col gap-3 p-5" aria-busy="true">
        <Skeleton className="h-3 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1"
                title={`${row.protected.toLocaleString()} protected · ${row.unprotected.toLocaleString()} unprotected`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-[11px] text-foreground">{row.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {row.total.toLocaleString()}
                  </span>
                </div>
                <div
                  className="h-2.5 overflow-hidden rounded"
                  style={{ backgroundColor: 'var(--chart-bypassed)' }}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${row.pct}%`,
                      backgroundColor: 'var(--chart-protected)',
                      borderRight: row.pct > 0 && row.pct < 100 ? '2px solid var(--surface)' : undefined,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-shrink-0 items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--chart-protected)' }} />
            protected
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--chart-bypassed)' }} />
            unprotected
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(StackedBarChart);
