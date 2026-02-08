import { Loader2 } from 'lucide-react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell
} from 'recharts';
import type { BreakdownItem, OrgBreakdownItem } from '../../../services/api/analytics';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface BarChartProps {
  data: (BreakdownItem | OrgBreakdownItem)[];
  title: string;
  loading?: boolean;
}

const chartConfig = {
  score: {
    label: 'Defense Score',
    color: 'var(--chart-primary-line)',
  },
} satisfies ChartConfig;

// Get bar color based on score - use oklch colors directly (no hsl wrapper)
const getBarColor = (score: number) => {
  if (score >= 80) return 'var(--chart-protected)';
  if (score >= 60) return 'var(--chart-4)'; // yellow/warning
  return 'var(--chart-bypassed)';
};

export default function BarChart({ data, title, loading }: BarChartProps) {
  // Return early if loading or no data
  if (loading) {
    return (
      <Card className="h-full min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <Card className="h-full min-h-[300px] flex items-center justify-center">
        <p className="text-muted-foreground">No data available</p>
      </Card>
    );
  }

  // Format data to add display name
  const chartData = data.map(item => {
    const displayName = 'orgName' in item ? item.orgName : item.name;
    const safeName = displayName || 'Unknown';
    return {
      ...item,
      displayName: safeName.length > 20 ? safeName.substring(0, 20) + '...' : safeName,
      fullName: safeName,
    };
  });

  // Limit to top 10 items for cleaner display
  const displayData = chartData.slice(0, 10);
  const chartHeight = Math.max(200, displayData.length * 32);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <ChartContainer config={chartConfig} className="w-full" style={{ height: chartHeight }}>
          <RechartsBarChart
            data={displayData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 5, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/50" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}%`}
              className="text-xs fill-muted-foreground"
            />
            <YAxis
              type="category"
              dataKey="displayName"
              tickLine={false}
              axisLine={false}
              width={100}
              className="text-xs fill-muted-foreground"
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideLabel={true}
                  formatter={(value, _name, item) => {
                    const payload = item.payload;
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{payload.fullName}</span>
                        <span className="text-foreground font-bold">{Number(value).toFixed(1)}%</span>
                        <span className="text-xs text-muted-foreground">
                          {payload.protected} / {payload.count} protected
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={18}>
              {displayData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.score)} />
              ))}
            </Bar>
          </RechartsBarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
