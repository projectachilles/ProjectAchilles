import { Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StackedBarChartProps {
  data: Array<{
    name?: string;
    technique?: string;
    protected: number;
    unprotected: number;
  }>;
  loading?: boolean;
  title?: string;
  layout?: 'horizontal' | 'vertical';
}

const chartConfig = {
  protected: {
    label: 'Protected',
    color: 'var(--chart-protected)',
  },
  unprotected: {
    label: 'Bypassed',
    color: 'var(--chart-bypassed)',
  },
} satisfies ChartConfig;

export default function StackedBarChart({
  data,
  loading,
  title = 'Coverage',
  layout = 'horizontal'
}: StackedBarChartProps) {
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

  // Normalize data to have 'name' field and limit to 5 items for cleaner display
  const chartData = data.slice(0, 5).map(item => ({
    name: item.name || item.technique || 'Unknown',
    protected: item.protected,
    unprotected: item.unprotected,
    total: item.protected + item.unprotected
  }));

  // Truncate long names
  const truncateName = (name: string, maxLength: number = 12) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
  };

  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const isVertical = layout === 'vertical';
  // Fixed height based on layout
  const chartHeight = isVertical ? Math.max(180, chartData.length * 36) : 200;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <ChartContainer config={chartConfig} className="w-full" style={{ height: chartHeight }}>
          <BarChart
            data={chartData}
            layout={isVertical ? 'vertical' : 'horizontal'}
            margin={
              isVertical
                ? { top: 5, right: 20, left: 5, bottom: 5 }
                : { top: 5, right: 10, left: 5, bottom: 20 }
            }
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
            {isVertical ? (
              <>
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  className="text-xs fill-muted-foreground"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => truncateName(value, 16)}
                  width={100}
                  className="text-xs fill-muted-foreground"
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => truncateName(value, 10)}
                  angle={-45}
                  textAnchor="end"
                  height={50}
                  interval={0}
                  className="text-xs fill-muted-foreground"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={35}
                  className="text-xs fill-muted-foreground"
                />
              </>
            )}
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => {
                    const payload = item.payload;
                    const total = payload.protected + payload.unprotected;
                    const rate = total > 0 ? ((payload.protected / total) * 100).toFixed(1) : '0';
                    const label = name === 'protected' ? 'Protected' : 'Bypassed';
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{payload.name}</span>
                        <span className="text-foreground">
                          {label}: {Number(value).toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Protection rate: {rate}%
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="protected"
              stackId="stack"
              fill="var(--color-protected)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="unprotected"
              stackId="stack"
              fill="var(--color-unprotected)"
              radius={isVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
