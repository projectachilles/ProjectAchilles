import { Loader2, Shield } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { useTheme } from '../../../hooks/useTheme';

interface ProtectionRateDonutProps {
  protected: number;
  total: number;
  loading?: boolean;
  title?: string;
}

export default function ProtectionRateDonut({
  protected: protectedCount,
  total,
  loading,
  title = 'Protection Rate'
}: ProtectionRateDonutProps) {
  // Theme hook available if needed for future styling
  useTheme();

  // Return early if loading
  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[280px] flex items-center justify-center shadow-sm">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const unprotectedCount = total - protectedCount;
  const protectionRate = total > 0 ? (protectedCount / total) * 100 : 0;

  // Colors
  const protectedColor = 'hsl(142 76% 46%)';  // Green
  const unprotectedColor = 'hsl(0 84% 60%)';   // Red

  const chartData = [
    { name: 'Protected', value: protectedCount, color: protectedColor },
    { name: 'Bypassed', value: unprotectedCount, color: unprotectedColor }
  ];

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = total > 0 ? ((data.value / total) * 100).toFixed(1) : '0';
      return (
        <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{data.name}</p>
          <p className="font-bold" style={{ color: data.color }}>
            {data.value.toLocaleString()} executions
          </p>
          <p className="text-sm text-muted-foreground">{percentage}%</p>
        </div>
      );
    }
    return null;
  };

  // Determine score color
  const getScoreColor = () => {
    if (protectionRate >= 80) return 'text-green-500';
    if (protectionRate >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[280px] flex items-center justify-center shadow-sm">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg text-foreground">{title}</h3>
      </div>

      <div className="relative h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={85}
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className={`text-3xl font-bold ${getScoreColor()}`}>
            {protectionRate.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground mt-1">Protected</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: protectedColor }}
          />
          <span className="text-sm text-muted-foreground">
            Protected ({protectedCount.toLocaleString()})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: unprotectedColor }}
          />
          <span className="text-sm text-muted-foreground">
            Bypassed ({unprotectedCount.toLocaleString()})
          </span>
        </div>
      </div>
    </div>
  );
}
