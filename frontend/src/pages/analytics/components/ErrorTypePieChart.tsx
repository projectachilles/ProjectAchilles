import { Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
import type { ErrorTypeBreakdown } from '../../../services/api/analytics';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorTypePieChartProps {
  data: ErrorTypeBreakdown[];
  loading?: boolean;
  title?: string;
}

// Color palette for error types - use CSS variables directly (oklch values)
const ERROR_TYPE_COLORS: Record<string, string> = {
  'ExecutionPrevented': 'var(--chart-protected)',
  'FileQuarantined': 'oklch(0.55 0.18 145)',
  'Unprotected': 'var(--chart-bypassed)',
  'UnexpectedTestError': 'var(--chart-4)',
};

// Fallback colors for unknown types - use CSS variables directly
const FALLBACK_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export default function ErrorTypePieChart({
  data,
  loading,
  title = 'Results by Error Type'
}: ErrorTypePieChartProps) {
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
    percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0'
  }));

  // Build chart config from data
  const chartConfig = chartData.reduce((acc, item) => {
    acc[item.name] = {
      label: item.name,
      color: item.fill,
    };
    return acc;
  }, {} as ChartConfig);

  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <div className="flex items-start gap-2 sm:gap-4 h-[160px] sm:h-[180px]">
          <div className="w-[90px] sm:w-[120px] md:w-2/5 h-full flex-shrink-0">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={0}
                  outerRadius="80%"
                  paddingAngle={1}
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
                            <span className="font-medium">{payload.name}</span>
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
          <div className="flex-1 overflow-hidden min-w-0">
            {/* Legend */}
            <div className="flex flex-col gap-1 sm:gap-1.5 overflow-y-auto max-h-[160px] sm:max-h-[180px]">
              {chartData.map((entry, index) => (
                <div key={`legend-${index}`} className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div
                    className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <span className="text-[10px] sm:text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {entry.name.length > 15 ? entry.name.substring(0, 13) + '…' : entry.name}
                  </span>
                  <span className="text-[10px] sm:text-xs font-medium text-foreground flex-shrink-0">
                    {entry.percentage}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
