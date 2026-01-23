import { Loader2 } from 'lucide-react';
import type { HostTestMatrixCell } from '../../../services/api/analytics';
import { useTheme } from '../../../hooks/useTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HeatmapChartProps {
  data: HostTestMatrixCell[];
  loading?: boolean;
  title?: string;
}

export default function HeatmapChart({
  data,
  loading,
  title = 'Host-Test Coverage Matrix'
}: HeatmapChartProps) {
  const { theme } = useTheme();

  // Return early if no data
  if (!data || data.length === 0) {
    if (loading) {
      return (
        <Card className="h-full min-h-[280px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </Card>
      );
    }
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <p className="text-muted-foreground">No matrix data available</p>
      </Card>
    );
  }

  const isDark = theme === 'dark';

  // Extract unique hostnames and test names
  const hostnames = [...new Set(data.map(d => d.hostname))].sort();
  const testNames = [...new Set(data.map(d => d.testName))].sort();

  // Create a lookup map
  const dataMap = new Map<string, number>();
  let maxCount = 0;
  data.forEach(d => {
    const key = `${d.hostname}|${d.testName}`;
    dataMap.set(key, d.count);
    if (d.count > maxCount) maxCount = d.count;
  });

  // Get color intensity based on count (blues color scheme)
  const getColor = (count: number): string => {
    if (count === 0) {
      return isDark ? 'hsl(217 32% 20%)' : 'hsl(217 32% 95%)';
    }
    const intensity = maxCount > 0 ? count / maxCount : 0;

    if (isDark) {
      if (intensity > 0.75) return 'hsl(217 91% 50%)';
      if (intensity > 0.5) return 'hsl(217 91% 40%)';
      if (intensity > 0.25) return 'hsl(217 91% 30%)';
      return 'hsl(217 91% 25%)';
    } else {
      if (intensity > 0.75) return 'hsl(217 91% 45%)';
      if (intensity > 0.5) return 'hsl(217 91% 60%)';
      if (intensity > 0.25) return 'hsl(217 91% 75%)';
      return 'hsl(217 91% 85%)';
    }
  };

  // Truncate text
  const truncate = (text: string, maxLen: number) => {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 2) + '...';
  };

  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (hostnames.length === 0 || testNames.length === 0) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <p className="text-muted-foreground">No matrix data available</p>
      </Card>
    );
  }

  const cellSize = 28;
  const labelWidth = 80;
  const headerHeight = 80;

  // Limit display to first 8 hosts and 10 tests for cleaner view
  const displayHostnames = hostnames.slice(0, 8);
  const displayTestNames = testNames.slice(0, 10);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-auto">
        <div
          className="inline-block"
          style={{
            minWidth: labelWidth + displayTestNames.length * cellSize + 20
          }}
        >
          {/* Header row with test names */}
          <div className="flex" style={{ marginLeft: labelWidth }}>
            {displayTestNames.map((testName, i) => (
              <div
                key={testName}
                className="flex items-end justify-center text-[10px] text-muted-foreground"
                style={{
                  width: cellSize,
                  height: headerHeight,
                  transform: 'rotate(-45deg)',
                  transformOrigin: 'bottom left',
                  marginLeft: i === 0 ? 14 : 0
                }}
                title={testName}
              >
                <span className="truncate max-w-[80px]">
                  {truncate(testName, 12)}
                </span>
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div className="mt-1">
            {displayHostnames.map(hostname => (
              <div key={hostname} className="flex items-center">
                {/* Hostname label */}
                <div
                  className="text-[10px] text-muted-foreground text-right pr-1 truncate"
                  style={{ width: labelWidth }}
                  title={hostname}
                >
                  {truncate(hostname, 10)}
                </div>

                {/* Cells */}
                {displayTestNames.map(testName => {
                  const key = `${hostname}|${testName}`;
                  const count = dataMap.get(key) || 0;
                  const color = getColor(count);

                  return (
                    <div
                      key={key}
                      className="border border-background/50 flex items-center justify-center text-[10px] font-medium transition-transform hover:scale-110 hover:z-10 cursor-default"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: color,
                        color: count > 0 ? (isDark ? 'white' : (count / maxCount > 0.5 ? 'white' : 'black')) : 'transparent'
                      }}
                      title={`${hostname} × ${testName}: ${count} executions`}
                    >
                      {count > 0 && count}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-muted-foreground">
            <span>Low</span>
            <div className="flex">
              {[0.1, 0.25, 0.5, 0.75, 1].map((intensity, i) => (
                <div
                  key={i}
                  className="w-4 h-4 border border-background/50"
                  style={{ backgroundColor: getColor(Math.ceil(maxCount * intensity)) }}
                />
              ))}
            </div>
            <span>High ({maxCount})</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
