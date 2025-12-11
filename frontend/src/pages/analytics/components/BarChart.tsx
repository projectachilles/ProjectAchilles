import { Loader2 } from 'lucide-react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import type { BreakdownItem, OrgBreakdownItem } from '../../../services/api/analytics';
import { useTheme } from '../../../hooks/useTheme';

interface BarChartProps {
  data: (BreakdownItem | OrgBreakdownItem)[];
  title: string;
  loading?: boolean;
}

export default function BarChart({ data, title, loading }: BarChartProps) {
  // Return early if loading or no data to prevent rendering issues
  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[300px] flex items-center justify-center">
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const { theme } = useTheme();

  const isDark = theme === 'dark';
  const gridColor = isDark ? 'hsl(217.2 32.6% 25%)' : 'hsl(214.3 31.8% 91.4%)';
  const textColor = isDark ? 'hsl(215 20.2% 65.1%)' : 'hsl(215.4 16.3% 46.9%)';

  // Get bar color based on score
  const getBarColor = (score: number) => {
    if (score >= 80) return isDark ? 'hsl(142 76% 46%)' : 'hsl(142 76% 36%)';
    if (score >= 60) return isDark ? 'hsl(45 93% 47%)' : 'hsl(45 93% 37%)';
    return isDark ? 'hsl(0 84% 60%)' : 'hsl(0 84% 50%)';
  };

  // Format data to add display name
  const chartData = data.map(item => {
    const displayName = 'orgName' in item ? item.orgName : item.name;
    const safeName = displayName || 'Unknown';
    return {
      ...item,
      displayName: safeName.length > 20 ? safeName.substring(0, 20) + '...' : safeName
    };
  });

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      const name = 'orgName' in item ? item.orgName : item.name;
      return (
        <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{name}</p>
          <p className="text-primary font-bold">{item.score.toFixed(1)}%</p>
          <p className="text-sm text-muted-foreground">
            {item.protected} / {item.count} protected
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 flex flex-col">
      <h3 className="font-semibold text-lg mb-4">{title}</h3>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={{ stroke: gridColor }}
              axisLine={{ stroke: gridColor }}
              tickFormatter={(value) => `${value}%`}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={{ stroke: gridColor }}
              axisLine={{ stroke: gridColor }}
              width={100}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.score)} />
              ))}
            </Bar>
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
