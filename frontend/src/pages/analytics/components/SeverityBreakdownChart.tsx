import { Loader2 } from 'lucide-react';
import type { SeverityBreakdownItem, SeverityLevel } from '@/services/api/analytics';

interface SeverityBreakdownChartProps {
  data: SeverityBreakdownItem[];
  loading?: boolean;
  title?: string;
}

const SEVERITY_COLORS: Record<SeverityLevel, { bar: string; text: string }> = {
  critical: { bar: 'bg-red-500', text: 'text-red-500' },
  high: { bar: 'bg-orange-500', text: 'text-orange-500' },
  medium: { bar: 'bg-yellow-500', text: 'text-yellow-500' },
  low: { bar: 'bg-green-500', text: 'text-green-500' },
  info: { bar: 'bg-gray-400', text: 'text-gray-400' },
};

const SEVERITY_ORDER: SeverityLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

export default function SeverityBreakdownChart({
  data,
  loading,
  title = 'Score by Severity',
}: SeverityBreakdownChartProps) {
  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Sort data by severity order
  const sortedData = [...data].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  if (sortedData.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex flex-col">
        <h3 className="font-semibold text-sm mb-4">{title}</h3>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No severity data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex flex-col">
      <h3 className="font-semibold text-sm mb-4">{title}</h3>

      <div className="flex-1 flex flex-col justify-center space-y-3">
        {sortedData.map((item) => {
          const colors = SEVERITY_COLORS[item.severity];
          const barWidth = Math.max(item.score, 2); // Minimum 2% width for visibility

          return (
            <div key={item.severity} className="flex items-center gap-3">
              {/* Label */}
              <div className={`w-16 text-sm font-medium capitalize ${colors.text}`}>
                {item.severity}
              </div>

              {/* Bar Container */}
              <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${colors.bar} transition-all duration-500 ease-out rounded-full`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* Score */}
              <div className="w-12 text-right text-sm font-medium">
                {item.score.toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Defense score (% blocked) by severity level
        </p>
      </div>
    </div>
  );
}
