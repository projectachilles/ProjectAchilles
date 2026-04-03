import { memo } from 'react';
import { Loader2, TrendingUp } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import { format } from 'date-fns';
import type { TrendDataPoint, ErrorRateTrendDataPoint } from '../../../services/api/analytics';
import type { SecureScoreTrendPoint } from '@/services/api/defender';
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

// Normalize timestamp to a YYYY-MM-DD key for merging
function toDateKey(timestamp: string): string {
  const d = parseTimestamp(timestamp);
  return format(d, 'yyyy-MM-dd');
}

interface TrendChartProps {
  data: TrendDataPoint[];
  errorRateData?: ErrorRateTrendDataPoint[];
  errorRateOverall?: number | null;
  secureScoreTrendData?: SecureScoreTrendPoint[];
  loading?: boolean;
  title?: string;
  windowDays?: number;
}

const chartConfig = {
  score: {
    label: 'Defense Score',
    color: 'var(--chart-protected)',
  },
  realScore: {
    label: 'Actual Score',
    color: 'var(--chart-real-score)',
  },
  errorRate: {
    label: 'Error Rate',
    color: 'var(--chart-bypassed)',
  },
  secureScore: {
    label: 'Secure Score',
    color: 'var(--chart-primary-line)',
  },
} satisfies ChartConfig;

function TrendChart({ data, errorRateData, errorRateOverall, secureScoreTrendData, loading, title = 'Trend Overview', windowDays }: TrendChartProps) {
  const hasErrorRate = errorRateData && errorRateData.length > 0;
  const hasSecureScore = secureScoreTrendData && secureScoreTrendData.length > 0;
  const hasRealScore = data.some(d => d.realScore !== undefined && d.realScore !== d.score);
  const hasExtraData = hasErrorRate || hasSecureScore || hasRealScore;

  // Return early if no data to prevent rendering issues
  if (!data || data.length === 0) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          {loading
            ? <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            : <p className="text-sm text-muted-foreground">No trend data available</p>
          }
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Build error rate lookup by date key
  const errorRateByDate = new Map<string, ErrorRateTrendDataPoint>();
  if (hasErrorRate) {
    for (const point of errorRateData) {
      errorRateByDate.set(toDateKey(point.timestamp), point);
    }
  }

  // Build secure score lookup by date key (normalize ISO dates to YYYY-MM-DD to match defense score keys)
  const secureScoreByDate = new Map<string, SecureScoreTrendPoint>();
  if (hasSecureScore) {
    for (const point of secureScoreTrendData) {
      secureScoreByDate.set(toDateKey(point.date), point);
    }
  }

  // Merge datasets: defense score is the primary axis, error rate + secure score joined by date
  const chartData = data.map(point => {
    const date = parseTimestamp(point.timestamp);
    const dateKey = toDateKey(point.timestamp);
    const errPoint = errorRateByDate.get(dateKey);
    const ssPoint = secureScoreByDate.get(dateKey);
    return {
      ...point,
      realScore: point.realScore ?? null,
      realTotal: point.realTotal ?? 0,
      realProtected: point.realProtected ?? 0,
      errorRate: errPoint?.errorRate ?? null,
      errorCount: errPoint?.errorCount ?? 0,
      errorTotal: errPoint?.total ?? 0,
      secureScore: ssPoint?.percentage ?? null,
      secureScorePoints: ssPoint?.score ?? 0,
      secureScoreMax: ssPoint?.maxScore ?? 0,
      date: format(date, 'MMM d'),
      fullDate: format(date, 'MMM d, yyyy'),
    };
  });

  // Calculate averages for description
  const avgScore = chartData.length > 0
    ? (chartData.reduce((sum, d) => sum + d.score, 0) / chartData.length).toFixed(1)
    : '0';

  const avgRealScore = hasRealScore
    ? (chartData.filter(d => d.realScore != null).reduce((sum, d) => sum + (d.realScore ?? 0), 0) / chartData.filter(d => d.realScore != null).length).toFixed(1)
    : null;

  const avgErrorRate = hasErrorRate && errorRateOverall != null
    ? errorRateOverall.toFixed(1)
    : null;

  const avgSecureScore = hasSecureScore
    ? (secureScoreTrendData.reduce((sum, d) => sum + d.percentage, 0) / secureScoreTrendData.length).toFixed(1)
    : null;

  // Show only 5-7 ticks max to prevent overflow
  const tickCount = Math.min(7, chartData.length);
  const tickInterval = chartData.length > tickCount ? Math.floor(chartData.length / tickCount) : 0;

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="flex-shrink-0 pb-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="flex items-center gap-2 text-sm flex-wrap">
          <span>Defense: {avgScore}%</span>
          {avgRealScore !== null && (
            <>
              <span className="text-muted-foreground">|</span>
              <span>Actual: {avgRealScore}%</span>
            </>
          )}
          {avgSecureScore !== null && (
            <>
              <span className="text-muted-foreground">|</span>
              <span>Secure Score: {avgSecureScore}%</span>
            </>
          )}
          {avgErrorRate !== null && (
            <>
              <span className="text-muted-foreground">|</span>
              <span>Error rate: {avgErrorRate}%</span>
            </>
          )}
          {windowDays && (
            <span className="text-muted-foreground">({windowDays}-day rolling)</span>
          )}
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-4 flex flex-col">
        <div className="flex-1 w-full min-h-0 overflow-hidden">
          <ChartContainer
            config={chartConfig}
            className="h-full w-full"
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
              <linearGradient id="fillErrorRate" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-errorRate)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-errorRate)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillSecureScore" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-secureScore)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-secureScore)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillRealScore" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-realScore)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-realScore)"
                  stopOpacity={0.05}
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
              width={48}
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
                    const config = chartConfig[name as keyof typeof chartConfig];
                    if (!config) return null;
                    return (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: config.color }}
                          />
                          <span className="text-muted-foreground">{config.label}:</span>
                          <span className="text-foreground font-medium">
                            {Number(value).toFixed(1)}%
                          </span>
                        </div>
                        {name === 'score' && payload.total > 0 && (
                          <span className="text-xs text-muted-foreground ml-[18px]">
                            {payload.protected}/{payload.total} protected
                          </span>
                        )}
                        {name === 'errorRate' && payload.errorTotal > 0 && (
                          <span className="text-xs text-muted-foreground ml-[18px]">
                            {payload.errorCount}/{payload.errorTotal} errors
                          </span>
                        )}
                        {name === 'realScore' && payload.realTotal > 0 && (
                          <span className="text-xs text-muted-foreground ml-[18px]">
                            {payload.realProtected}/{payload.realTotal} protected
                          </span>
                        )}
                        {name === 'secureScore' && payload.secureScoreMax > 0 && (
                          <span className="text-xs text-muted-foreground ml-[18px]">
                            {payload.secureScorePoints}/{payload.secureScoreMax} pts
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
            {hasRealScore && (
              <Area
                type="monotone"
                dataKey="realScore"
                stroke="var(--color-realScore)"
                strokeWidth={2}
                strokeDasharray="6 3"
                fill="url(#fillRealScore)"
                connectNulls
              />
            )}
            {hasSecureScore && (
              <Area
                type="monotone"
                dataKey="secureScore"
                stroke="var(--color-secureScore)"
                strokeWidth={2}
                fill="url(#fillSecureScore)"
                connectNulls
              />
            )}
            {hasErrorRate && (
              <Area
                type="monotone"
                dataKey="errorRate"
                stroke="var(--color-errorRate)"
                strokeWidth={2}
                fill="url(#fillErrorRate)"
                connectNulls
              />
            )}
          </AreaChart>
          </ChartContainer>
        </div>
        {hasExtraData && (
          <div className="flex items-center justify-center gap-4 pt-2 flex-shrink-0">
            {Object.entries(chartConfig)
              .filter(([key]) => key === 'score' || (key === 'realScore' && hasRealScore) || (key === 'errorRate' && hasErrorRate) || (key === 'secureScore' && hasSecureScore))
              .map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: cfg.color }}
                />
                <span>{cfg.label}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(TrendChart);
