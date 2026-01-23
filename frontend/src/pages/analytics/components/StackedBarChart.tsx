import { Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { useTheme } from '../../../hooks/useTheme';

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

// Colors
const PROTECTED_COLOR = 'hsl(142 76% 46%)';    // Green
const UNPROTECTED_COLOR = 'hsl(0 84% 60%)';    // Red

export default function StackedBarChart({
  data,
  loading,
  title = 'Coverage',
  layout = 'horizontal'
}: StackedBarChartProps) {
  const { theme } = useTheme();

  // Return early if no data to prevent rendering issues
  if (!data || data.length === 0) {
    if (loading) {
      return (
        <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[280px] flex items-center justify-center shadow-sm">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[280px] flex items-center justify-center shadow-sm">
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const isDark = theme === 'dark';
  const gridColor = isDark ? 'hsl(217.2 32.6% 25%)' : 'hsl(214.3 31.8% 91.4%)';
  const textColor = isDark ? 'hsl(215 20.2% 65.1%)' : 'hsl(215.4 16.3% 46.9%)';

  // Normalize data to have 'name' field
  const chartData = data.map(item => ({
    name: item.name || item.technique || 'Unknown',
    protected: item.protected,
    unprotected: item.unprotected,
    total: item.protected + item.unprotected
  }));

  // Truncate long names
  const truncateName = (name: string, maxLength: number = 20) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 2) + '...';
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const protectedVal = payload.find((p: any) => p.dataKey === 'protected')?.value || 0;
      const unprotectedVal = payload.find((p: any) => p.dataKey === 'unprotected')?.value || 0;
      const total = protectedVal + unprotectedVal;
      const rate = total > 0 ? ((protectedVal / total) * 100).toFixed(1) : '0';

      return (
        <div className="bg-background border border-border rounded-lg p-3 shadow-lg max-w-[300px]">
          <p className="font-medium truncate">{label}</p>
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PROTECTED_COLOR }} />
              <span className="text-sm">Protected: {protectedVal.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: UNPROTECTED_COLOR }} />
              <span className="text-sm">Bypassed: {unprotectedVal.toLocaleString()}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Protection rate: {rate}%
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom legend
  const renderLegend = () => (
    <div className="flex justify-center gap-6 mb-2">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PROTECTED_COLOR }} />
        <span className="text-sm text-muted-foreground">Protected</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: UNPROTECTED_COLOR }} />
        <span className="text-sm text-muted-foreground">Bypassed</span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[280px] flex items-center justify-center shadow-sm">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[280px] flex items-center justify-center shadow-sm">
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const isVertical = layout === 'vertical';

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <h3 className="font-semibold text-lg mb-2 text-foreground">{title}</h3>
      {renderLegend()}

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout={isVertical ? 'vertical' : 'horizontal'}
            margin={
              isVertical
                ? { top: 10, right: 20, left: 10, bottom: 10 }
                : { top: 10, right: 20, left: 10, bottom: 30 }
            }
          >
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            {isVertical ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fill: textColor, fontSize: 11 }}
                  tickLine={{ stroke: gridColor }}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: textColor, fontSize: 12 }}
                  tickLine={{ stroke: gridColor }}
                  axisLine={{ stroke: gridColor }}
                  tickFormatter={(value) => truncateName(value, 16)}
                  width={100}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="name"
                  tick={{ fill: textColor, fontSize: 11 }}
                  tickLine={{ stroke: gridColor }}
                  axisLine={{ stroke: gridColor }}
                  tickFormatter={(value) => truncateName(value, 12)}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fill: textColor, fontSize: 11 }}
                  tickLine={{ stroke: gridColor }}
                  axisLine={{ stroke: gridColor }}
                />
              </>
            )}
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="protected" stackId="stack" fill={PROTECTED_COLOR} radius={[0, 0, 0, 0]} />
            <Bar dataKey="unprotected" stackId="stack" fill={UNPROTECTED_COLOR} radius={isVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
