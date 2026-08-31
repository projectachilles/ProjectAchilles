import { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { TechniqueDistributionItem } from '@/services/api/analytics';

interface TechniqueDistributionCardProps {
  data: TechniqueDistributionItem[];
  loading?: boolean;
  /** Techniques that also raised Defender alerts (warning badge in header). */
  defenderTechniqueCount?: number;
  /** Row click — filters executions to the technique. */
  onTechniqueClick?: (technique: string) => void;
}

function TechniqueDistributionCard({
  data,
  loading,
  defenderTechniqueCount = 0,
  onTechniqueClick,
}: TechniqueDistributionCardProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  const rows = [...data]
    .map((d) => ({
      ...d,
      total: d.protected + d.unprotected,
      pct: d.protected + d.unprotected > 0 ? (d.protected / (d.protected + d.unprotected)) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 grid-rows-1">
        <CardTitle>ATT&CK technique distribution</CardTitle>
        {defenderTechniqueCount > 0 && (
          <Badge variant="medium">{defenderTechniqueCount} with Defender alerts</Badge>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
            {rows.map((row) => (
              <button
                key={row.technique}
                onClick={() => onTechniqueClick?.(row.technique)}
                className="flex w-full items-center gap-2.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-raised"
                title={`${row.technique}: ${row.protected} protected / ${row.unprotected} unprotected`}
              >
                <Badge variant="default" className="w-[76px] shrink-0 justify-center font-mono">
                  {row.technique}
                </Badge>
                <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised">
                  {row.total > 0 && (
                    <>
                      <span
                        className="h-full"
                        style={{
                          width: `${(row.protected / row.total) * 100}%`,
                          backgroundColor: 'var(--chart-protected)',
                        }}
                      />
                      <span
                        className="h-full"
                        style={{
                          width: `${(row.unprotected / row.total) * 100}%`,
                          backgroundColor: 'var(--chart-bypassed)',
                        }}
                      />
                    </>
                  )}
                </span>
                <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted">
                  {Math.round(row.pct)}%
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted">
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

export default memo(TechniqueDistributionCard);
