import { memo } from 'react';
import { PieChart, Pie, Cell } from 'recharts';
import type { ErrorTypeBreakdown } from '../../../services/api/analytics';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ErrorTypePieChartProps {
  data: ErrorTypeBreakdown[];
  loading?: boolean;
  title?: string;
}

// Color palette for error types - keyed to canonical error names from ERROR_CODE_MAP
const ERROR_TYPE_COLORS: Record<string, string> = {
  // Protected outcomes (greens)
  'ExecutionPrevented': 'var(--chart-protected)',
  'FileQuarantinedOnExtraction': 'var(--chart-protected)',
  'QuarantinedOnExecution': 'var(--chart-real-score)',
  // Failed outcome (red)
  'Unprotected': 'var(--chart-bypassed)',
  // Inconclusive / error outcomes
  'NormalExit': 'var(--chart-3)',
  'BinaryNotRecognized': 'var(--chart-4)',
  'StillActive': 'var(--chart-5)',
  'NoOutput': 'var(--chart-1)',
  'UnexpectedTestError': 'var(--chart-2)',
};

// Fallback colors for unknown types
const FALLBACK_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

function ErrorTypePieChart({
  data,
  loading,
  title = 'Results by Error Type'
}: ErrorTypePieChartProps) {
  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex flex-col overflow-hidden">
        <CardHeader className="pb-2 flex-shrink-0">
          <Skeleton className="h-4 w-36" />
        </CardHeader>
        <CardContent className="flex-1 pb-4 overflow-hidden" aria-busy="true">
          <div className="flex items-center gap-4 h-full">
            <Skeleton className="w-[120px] h-[120px] rounded-full flex-shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Return early if no data
  if (!data || data.length === 0) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <p className="text-muted-foreground">No data available</p>
      </Card>
    );
  }

  // Calculate total for percentages
  const total = data.reduce((sum, item) => sum + item.count, 0);

  // Get color for error type
  const getColor = (name: string, index: number): string => {
    return ERROR_TYPE_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  };

  // Format data with colors and percentages
  const chartData = data.map((item, index) => ({
    ...item,
    fill: getColor(item.name, index),
    percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0',
    displayName: `${item.name} (${item.code})`,
  }));

  // Build chart config from data
  const chartConfig = chartData.reduce((acc, item) => {
    acc[item.name] = {
      label: item.displayName,
      color: item.fill,
    };
    return acc;
  }, {} as ChartConfig);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <div className="flex items-center gap-4 h-full">
          {/* Donut chart - compact left side */}
          <div className="w-[120px] h-[120px] flex-shrink-0">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="45%"
                  outerRadius="85%"
                  paddingAngle={2}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => {
                        const payload = item.payload;
                        return (
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{payload.displayName}</span>
                            <span className="text-foreground font-bold">
                              {Number(value).toLocaleString()} executions
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {payload.percentage}% of total
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
          </div>
          {/* Legend - takes remaining space, no truncation */}
          <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-w-0 max-h-full">
            {chartData.map((entry, index) => (
              <div key={`legend-${index}`} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: entry.fill }}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {entry.displayName}
                </span>
                <span className="text-xs font-medium text-foreground tabular-nums flex-shrink-0 ml-auto">
                  {entry.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(ErrorTypePieChart);
