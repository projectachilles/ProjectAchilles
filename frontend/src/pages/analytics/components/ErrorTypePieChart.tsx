import { Loader2 } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import type { ErrorTypeBreakdown } from '../../../services/api/analytics';
import { useTheme } from '../../../hooks/useTheme';

interface ErrorTypePieChartProps {
  data: ErrorTypeBreakdown[];
  loading?: boolean;
  title?: string;
}

// Color palette for error types
const ERROR_TYPE_COLORS: Record<string, string> = {
  'ExecutionPrevented': 'hsl(142 76% 46%)',      // Green - blocked
  'FileQuarantined': 'hsl(142 76% 36%)',          // Dark green - quarantined
  'Unprotected': 'hsl(0 84% 60%)',                // Red - bypassed
  'UnexpectedTestError': 'hsl(45 93% 47%)',       // Yellow - error
};

// Fallback colors for unknown types
const FALLBACK_COLORS = [
  'hsl(217 91% 60%)',   // Blue
  'hsl(262 83% 58%)',   // Purple
  'hsl(330 81% 60%)',   // Pink
  'hsl(173 80% 40%)',   // Teal
  'hsl(25 95% 53%)',    // Orange
];

export default function ErrorTypePieChart({
  data,
  loading,
  title = 'Results by Error Type'
}: ErrorTypePieChartProps) {
  // Theme hook available if needed for future styling
  useTheme();

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

  // Calculate total for percentages
  const total = data.reduce((sum, item) => sum + item.count, 0);

  // Get color for error type
  const getColor = (name: string, index: number): string => {
    return ERROR_TYPE_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  };

  // Format data with colors and percentages
  const chartData = data.map((item, index) => ({
    ...item,
    color: getColor(item.name, index),
    percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : '0'
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{data.name}</p>
          <p className="text-primary font-bold">{data.count.toLocaleString()} executions</p>
          <p className="text-sm text-muted-foreground">{data.percentage}% of total</p>
        </div>
      );
    }
    return null;
  };

  // Custom legend
  const renderLegend = () => (
    <div className="flex flex-col gap-2 ml-4">
      {chartData.map((entry, index) => (
        <div key={`legend-${index}`} className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-sm text-muted-foreground truncate">
            {entry.name}
          </span>
          <span className="text-sm font-medium ml-auto">
            {entry.percentage}%
          </span>
        </div>
      ))}
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

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <h3 className="font-semibold text-lg mb-4">{title}</h3>

      <div className="flex items-center h-[200px]">
        <div className="w-1/2 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={0}
                outerRadius={80}
                paddingAngle={1}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="w-1/2">
          {renderLegend()}
        </div>
      </div>
    </div>
  );
}
