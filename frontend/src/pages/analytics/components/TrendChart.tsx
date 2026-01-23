import { Loader2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { format } from 'date-fns';
import type { TrendDataPoint } from '../../../services/api/analytics';
import { applyForwardFill } from '../utils/trendDataTransformations';

// Helper to parse timestamp - handles both epoch ms strings and ISO strings
function parseTimestamp(timestamp: string): Date {
  // Check if it's a numeric string (epoch milliseconds)
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  // Otherwise parse as ISO string
  return new Date(timestamp);
}
import { useTheme } from '../../../hooks/useTheme';

interface TrendChartProps {
  data: TrendDataPoint[];
  loading?: boolean;
  title?: string;
}

export default function TrendChart({ data, loading, title = 'Defense Score Trend' }: TrendChartProps) {
  const { theme } = useTheme();

  // Return early if no data to prevent rendering issues
  if (!data || data.length === 0) {
    if (loading) {
      return (
        <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[300px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[300px] flex items-center justify-center">
        <p className="text-muted-foreground">No trend data available</p>
      </div>
    );
  }

  const isDark = theme === 'dark';
  const gridColor = isDark ? 'hsl(217.2 32.6% 25%)' : 'hsl(214.3 31.8% 91.4%)';
  const textColor = isDark ? 'hsl(215 20.2% 65.1%)' : 'hsl(215.4 16.3% 46.9%)';
  const lineColor = isDark ? 'hsl(217.2 91.2% 59.8%)' : 'hsl(221.2 83.2% 53.3%)';

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

  // Custom tooltip - shows different content for carried-forward data
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isEstimated = data.isCarriedForward;

      return (
        <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{data.fullDate}</p>
          <p className="text-primary font-bold">
            {data.score.toFixed(1)}%{isEstimated && ' (estimated)'}
          </p>
          {isEstimated ? (
            <p className="text-sm text-muted-foreground italic">
              {data.total === 0 ? 'No tests on this day' : `Insufficient data (${data.total} tests)`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.protected} / {data.total} protected
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  // Custom dot - hollow for carried-forward, solid for real data
  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined) return null;

    const isEstimated = payload?.isCarriedForward;

    if (isEstimated) {
      // Hollow circle for estimated/carried-forward data
      return (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="hsl(var(--background))"
          stroke={lineColor}
          strokeWidth={2}
        />
      );
    }

    // Solid circle for real data
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={lineColor}
        stroke="none"
      />
    );
  };

  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 min-h-[300px] flex items-center justify-center">
        <p className="text-muted-foreground">No trend data available</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 flex flex-col">
      <h3 className="font-semibold text-lg mb-4 text-foreground">{title}</h3>

      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="date"
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={{ stroke: gridColor }}
              axisLine={{ stroke: gridColor }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: textColor, fontSize: 12 }}
              tickLine={{ stroke: gridColor }}
              axisLine={{ stroke: gridColor }}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={80} stroke="hsl(142 76% 36%)" strokeDasharray="5 5" opacity={0.5} />
            <Line
              type="monotone"
              dataKey="score"
              stroke={lineColor}
              strokeWidth={2}
              dot={<CustomDot />}
              activeDot={{ r: 6, stroke: lineColor, strokeWidth: 2, fill: 'hsl(var(--background))' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
