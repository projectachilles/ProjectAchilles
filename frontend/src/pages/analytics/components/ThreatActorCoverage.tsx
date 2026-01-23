import { Loader2, Shield, ChevronRight } from 'lucide-react';
import type { ThreatActorCoverageItem } from '@/services/api/analytics';

interface ThreatActorCoverageProps {
  data: ThreatActorCoverageItem[];
  loading?: boolean;
  title?: string;
  maxItems?: number;
  onViewAll?: () => void;
}

export default function ThreatActorCoverage({
  data,
  loading,
  title = 'Threat Actor Coverage',
  maxItems = 5,
  onViewAll,
}: ThreatActorCoverageProps) {
  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Sort by total executions (most tested first) and limit
  const sortedData = [...data]
    .sort((a, b) => b.totalExecutions - a.totalExecutions)
    .slice(0, maxItems);

  if (sortedData.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex flex-col">
        <h3 className="font-semibold text-sm mb-4 text-foreground">{title}</h3>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No threat actor data available</p>
        </div>
      </div>
    );
  }

  // Color based on coverage percentage
  const getCoverageColor = (coverage: number): string => {
    if (coverage >= 80) return 'bg-green-500';
    if (coverage >= 60) return 'bg-yellow-500';
    if (coverage >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <Shield className="w-4 h-4 text-muted-foreground" />
      </div>

      <div className="flex-1 space-y-3">
        {sortedData.map((item) => {
          const barWidth = Math.max(item.coverage, 2);
          const coverageColor = getCoverageColor(item.coverage);

          return (
            <div key={item.threatActor} className="space-y-1.5">
              {/* Header: Name and Stats */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-purple-500 truncate pr-2" title={item.threatActor}>
                  {item.threatActor}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {item.testCount} tests
                </span>
              </div>

              {/* Progress Bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full ${coverageColor} transition-all duration-500 ease-out rounded-full`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <span className="text-xs font-medium w-10 text-right text-foreground">
                  {item.coverage.toFixed(0)}%
                </span>
              </div>

              {/* Details */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{item.protectedCount.toLocaleString()} blocked</span>
                <span>•</span>
                <span>{item.totalExecutions.toLocaleString()} total</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* View All Link */}
      {data.length > maxItems && onViewAll && (
        <button
          onClick={onViewAll}
          className="mt-4 pt-3 border-t border-border flex items-center justify-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          View all {data.length} threat actors
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Legend */}
      {!onViewAll && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" /> 80%+
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500" /> 60-79%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500" /> 40-59%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" /> &lt;40%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
