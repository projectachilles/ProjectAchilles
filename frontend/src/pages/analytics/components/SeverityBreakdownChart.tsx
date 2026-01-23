import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Cell } from 'recharts';
import type { SeverityBreakdownItem, SeverityLevel } from '@/services/api/analytics';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface SeverityBreakdownChartProps {
  data: SeverityBreakdownItem[];
  loading?: boolean;
  title?: string;
}

// Map severity to display colors (oklch values for proper rendering)
const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  critical: 'oklch(0.63 0.24 25)',   // red-500
  high: 'oklch(0.70 0.19 50)',       // orange-500
  medium: 'oklch(0.80 0.18 85)',     // yellow-500
  low: 'oklch(0.72 0.19 145)',       // green-500
  info: 'oklch(0.55 0.01 250)',      // gray-400
};

const SEVERITY_ORDER: SeverityLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

// Build chart config dynamically
const chartConfig = SEVERITY_ORDER.reduce((acc, severity) => {
  acc[severity] = {
    label: SEVERITY_LABELS[severity],
    color: SEVERITY_COLORS[severity],
  };
  return acc;
}, {} as ChartConfig);

export default function SeverityBreakdownChart({
  data,
  loading,
  title = 'Score by Severity',
}: SeverityBreakdownChartProps) {
  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  // Sort data by severity order
  const sortedData = [...data].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  if (sortedData.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No severity data available</p>
        </CardContent>
      </Card>
    );
  }

  // Format data for chart
  const chartData = sortedData.map((item) => ({
    severity: item.severity,
    label: SEVERITY_LABELS[item.severity],
    score: item.score,
    fill: SEVERITY_COLORS[item.severity],
  }));

  const chartHeight = Math.max(160, chartData.length * 32);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">
          Defense score (% blocked) by severity level
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-4">
        <ChartContainer config={chartConfig} className="w-full" style={{ height: chartHeight }}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 40, left: 5, bottom: 5 }}
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}%`}
              tick={{ fontSize: 11 }}
              hide
            />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={60}
              tick={{ fontSize: 12 }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, _name, item) => {
                    const payload = item.payload;
                    return (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: payload.fill }}
                          />
                          <span className="font-medium">{payload.label}</span>
                        </div>
                        <span className="text-foreground font-bold ml-4">
                          {Number(value).toFixed(1)}% blocked
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
