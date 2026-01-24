import { Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Tooltip
} from 'recharts';
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
}

// Use oklch colors directly since SVG doesn't resolve CSS variables properly in fill
const PROTECTED_COLOR = 'oklch(0.65 0.22 145)';
const BYPASSED_COLOR = 'oklch(0.6 0.22 25)';

/**
 * Stacked bar chart showing Protected vs Bypassed counts.
 *
 * Note: Uses horizontal layout (vertical bars) because Recharts 2.15.4 has a bug
 * where stackId + layout="vertical" fails to render bar paths inside the containers.
 */
export default function StackedBarChart({
  data,
  loading,
  title = 'Coverage'
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

  // Truncate long names for axis labels
  const truncateName = (name: string, maxLength: number = 8) => {
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

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 5, bottom: 50 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickFormatter={truncateName}
              angle={-45}
              textAnchor="end"
              height={50}
              interval={0}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={35}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px'
              }}
              formatter={(value: number, name: string) => {
                const label = name === 'protected' ? 'Protected' : 'Bypassed';
                return [value.toLocaleString(), label];
              }}
              labelFormatter={(label) => label}
            />
            <Legend
              formatter={(value) => (value === 'protected' ? 'Protected' : 'Bypassed')}
              wrapperStyle={{ fontSize: '12px' }}
            />
            <Bar
              dataKey="protected"
              stackId="stack"
              fill={PROTECTED_COLOR}
              radius={[0, 0, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="unprotected"
              stackId="stack"
              fill={BYPASSED_COLOR}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
