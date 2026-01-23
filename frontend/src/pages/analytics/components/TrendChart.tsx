import { Loader2, TrendingUp } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import { format } from 'date-fns';
import type { TrendDataPoint } from '../../../services/api/analytics';
import { applyForwardFill } from '../utils/trendDataTransformations';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

// Helper to parse timestamp - handles both epoch ms strings and ISO strings
function parseTimestamp(timestamp: string): Date {
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  return new Date(timestamp);
}

interface TrendChartProps {
  data: TrendDataPoint[];
  loading?: boolean;
  title?: string;
}

const chartConfig = {
  score: {
    label: 'Defense Score',
    color: 'var(--chart-primary-line)',
  },
} satisfies ChartConfig;

export default function TrendChart({ data, loading, title = 'Defense Score Trend' }: TrendChartProps) {
  // Return early if no data to prevent rendering issues
  if (!data || data.length === 0) {
    if (loading) {
      return (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-medium">{title}</CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          <p className="text-sm text-muted-foreground">No trend data available</p>
        </CardContent>
      </Card>
    );
  }

  // Apply forward-fill to preserve scores on days without data
  const filledData = applyForwardFill(data);

  // Format data for chart
  const chartData = filledData.map(point => {
    const date = parseTimestamp(point.timestamp);
    return {
      ...point,
      date: format(date, 'MMM d'),
      fullDate: format(date, 'MMM d, yyyy')
    };
  });

  // Calculate average score for description
  const avgScore = chartData.length > 0
    ? (chartData.reduce((sum, d) => sum + d.score, 0) / chartData.length).toFixed(1)
    : '0';

  // Show only 5-7 ticks max to prevent overflow
  const tickCount = Math.min(7, chartData.length);
  const tickInterval = chartData.length > tickCount ? Math.floor(chartData.length / tickCount) : 0;

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <CardDescription className="flex items-center gap-1 text-sm">
          <span>Average: {avgScore}%</span>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <div className="w-full min-w-0 overflow-hidden">
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[200px] w-full max-w-full"
          >
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="fillScore" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-score)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-score)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={tickInterval}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value}%`}
              width={40}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    if (payload && payload[0]) {
                      return payload[0].payload.fullDate;
                    }
                    return '';
                  }}
                  formatter={(value, name, item) => {
                    const payload = item.payload;
                    const isEstimated = payload?.isCarriedForward;
                    return (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: 'var(--color-score)' }}
                          />
                          <span className="text-foreground font-medium">
                            {Number(value).toFixed(1)}%{isEstimated ? ' (est.)' : ''}
                          </span>
                        </div>
                        {!isEstimated && payload.total > 0 && (
                          <span className="text-xs text-muted-foreground ml-4">
                            {payload.protected}/{payload.total} protected
                          </span>
                        )}
                      </div>
                    );
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="var(--color-score)"
              strokeWidth={2}
              fill="url(#fillScore)"
            />
          </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
