import { Loader2, Shield } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ProtectionRateDonutProps {
  protected: number;
  total: number;
  loading?: boolean;
  title?: string;
}

const chartConfig = {
  protected: {
    label: 'Protected',
    color: 'var(--chart-protected)',
  },
  bypassed: {
    label: 'Bypassed',
    color: 'var(--chart-bypassed)',
  },
} satisfies ChartConfig;

export default function ProtectionRateDonut({
  protected: protectedCount,
  total,
  loading,
  title = 'Protection Rate'
}: ProtectionRateDonutProps) {
  // Return early if loading
  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const unprotectedCount = total - protectedCount;
  const protectionRate = total > 0 ? (protectedCount / total) * 100 : 0;

  const chartData = [
    { name: 'protected', value: protectedCount, fill: 'var(--color-protected)' },
    { name: 'bypassed', value: unprotectedCount, fill: 'var(--color-bypassed)' }
  ];

  // Determine score color
  const getScoreColor = () => {
    if (protectionRate >= 80) return 'text-green-500';
    if (protectionRate >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <div className="relative h-[160px]">
          <ChartContainer config={chartConfig} className="h-full w-full">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={70}
                paddingAngle={2}
                startAngle={90}
                endAngle={-270}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const percentage = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : '0';
                      const label = name === 'protected' ? 'Protected' : 'Bypassed';
                      return (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{label}</span>
                          <span className="text-foreground font-bold">
                            {Number(value).toLocaleString()} executions
                          </span>
                          <span className="text-xs text-muted-foreground">{percentage}%</span>
                        </div>
                      );
                    }}
                  />
                }
              />
            </PieChart>
          </ChartContainer>

          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className={`text-3xl font-bold ${getScoreColor()}`}>
              {protectionRate.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground mt-1">Protected</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex justify-center gap-4 mt-2 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: 'var(--chart-protected)' }}
            />
            <span className="text-xs text-muted-foreground">
              Protected ({protectedCount.toLocaleString()})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: 'var(--chart-bypassed)' }}
            />
            <span className="text-xs text-muted-foreground">
              Bypassed ({unprotectedCount.toLocaleString()})
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
