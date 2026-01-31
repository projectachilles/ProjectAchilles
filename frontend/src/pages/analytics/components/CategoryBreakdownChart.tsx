import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Cell } from 'recharts';
import type { CategoryBreakdownItem, CategoryType } from '@/services/api/analytics';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface CategoryBreakdownChartProps {
  data: CategoryBreakdownItem[];
  loading?: boolean;
  title?: string;
}

// Map category to display colors (oklch values for proper rendering)
const CATEGORY_COLORS: Record<CategoryType, string> = {
  'intel-driven': 'oklch(0.62 0.19 250)',     // blue-500
  'mitre-top10': 'oklch(0.55 0.22 290)',      // purple-500
  'cyber-hygiene': 'oklch(0.70 0.15 180)',    // teal-500
  'phase-aligned': 'oklch(0.55 0.22 270)',    // indigo-500
};

const CATEGORY_LABELS: Record<CategoryType, string> = {
  'intel-driven': 'Intel-Driven',
  'mitre-top10': 'MITRE Top 10',
  'cyber-hygiene': 'Cyber Hygiene',
  'phase-aligned': 'Phase-Aligned',
};

// Build chart config dynamically
const chartConfig = Object.keys(CATEGORY_LABELS).reduce((acc, category) => {
  const cat = category as CategoryType;
  acc[cat] = {
    label: CATEGORY_LABELS[cat],
    color: CATEGORY_COLORS[cat],
  };
  return acc;
}, {} as ChartConfig);

export default function CategoryBreakdownChart({
  data,
  loading,
  title = 'Score by Category',
}: CategoryBreakdownChartProps) {
  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  // Sort by score descending
  const sortedData = [...data].sort((a, b) => b.score - a.score);

  if (sortedData.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No category data available</p>
        </CardContent>
      </Card>
    );
  }

  // Format data for chart
  const chartData = sortedData.map((item) => ({
    category: item.category,
    label: CATEGORY_LABELS[item.category] || item.category,
    score: item.score,
    fill: CATEGORY_COLORS[item.category] || 'oklch(0.55 0.01 250)',
  }));

  const chartHeight = Math.max(140, chartData.length * 36);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">
          Defense score (% blocked) by test category
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
              width={85}
              tick={{ fontSize: 11 }}
              tickFormatter={(value) => {
                // Truncate long labels for small screens
                if (value.length > 12) return value.substring(0, 10) + '…';
                return value;
              }}
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
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={24}>
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
