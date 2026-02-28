import { Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
import type { CategorySubcategoryBreakdownItem, CategoryType } from '@/services/api/analytics';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface CategoryBreakdownChartProps {
  data: CategorySubcategoryBreakdownItem[];
  loading?: boolean;
  title?: string;
}

// Category colors (oklch) — same hue/chroma, used for outer ring
const CATEGORY_COLORS: Record<CategoryType, string> = {
  'intel-driven': 'oklch(0.62 0.19 250)',
  'mitre-top10': 'oklch(0.55 0.22 290)',
  'cyber-hygiene': 'oklch(0.70 0.15 180)',
  'phase-aligned': 'oklch(0.55 0.22 270)',
};

// Parsed oklch values for generating subcategory shades
const CATEGORY_OKLCH: Record<CategoryType, { l: number; c: number; h: number }> = {
  'intel-driven': { l: 0.62, c: 0.19, h: 250 },
  'mitre-top10': { l: 0.55, c: 0.22, h: 290 },
  'cyber-hygiene': { l: 0.70, c: 0.15, h: 180 },
  'phase-aligned': { l: 0.55, c: 0.22, h: 270 },
};

const CATEGORY_LABELS: Record<CategoryType, string> = {
  'intel-driven': 'Intel-Driven',
  'mitre-top10': 'MITRE Top 10',
  'cyber-hygiene': 'Cyber Hygiene',
  'phase-aligned': 'Phase-Aligned',
};

const MAX_SUBCATEGORIES = 8;

// Generate lightness-varied shades for subcategories
function getSubcategoryColor(category: CategoryType, index: number, total: number): string {
  const base = CATEGORY_OKLCH[category] || { l: 0.55, c: 0.15, h: 250 };
  // Spread lightness from 0.45 to 0.80 across subcategories
  const step = total > 1 ? (0.35 / (total - 1)) : 0;
  const lightness = Math.min(0.80, Math.max(0.45, 0.45 + step * index));
  return `oklch(${lightness.toFixed(2)} ${(base.c * 0.8).toFixed(2)} ${base.h})`;
}

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

  if (!data || data.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No category data available</p>
        </CardContent>
      </Card>
    );
  }

  // Sort by count descending for donut sizing
  const sortedData = [...data].sort((a, b) => b.count - a.count);

  // Build outer ring data (categories, sized by count)
  const outerData = sortedData.map((item) => ({
    name: CATEGORY_LABELS[item.category] || item.category,
    category: item.category,
    value: item.count,
    score: item.score,
    protected: item.protected,
    unprotected: item.unprotected,
    fill: CATEGORY_COLORS[item.category] || 'oklch(0.55 0.01 250)',
  }));

  // Build inner ring data (subcategories, sized by count)
  // Order must match outer ring — subcategories grouped under their parent category
  const innerData: Array<{
    name: string;
    parentCategory: CategoryType;
    parentLabel: string;
    value: number;
    score: number;
    protected: number;
    unprotected: number;
    fill: string;
  }> = [];

  for (const item of sortedData) {
    let subs = item.subcategories || [];
    // Group extras into "Other" if too many
    if (subs.length > MAX_SUBCATEGORIES) {
      const kept = subs.slice(0, MAX_SUBCATEGORIES - 1);
      const rest = subs.slice(MAX_SUBCATEGORIES - 1);
      const otherCount = rest.reduce((s, r) => s + r.count, 0);
      const otherProtected = rest.reduce((s, r) => s + r.protected, 0);
      const otherScore = otherCount > 0 ? (otherProtected / otherCount) * 100 : 0;
      kept.push({
        subcategory: 'Other',
        score: Math.round(otherScore * 100) / 100,
        count: otherCount,
        protected: otherProtected,
        unprotected: otherCount - otherProtected,
      });
      subs = kept;
    }

    if (subs.length === 0) {
      // No subcategories — add a single segment matching the category
      innerData.push({
        name: CATEGORY_LABELS[item.category] || item.category,
        parentCategory: item.category,
        parentLabel: CATEGORY_LABELS[item.category] || item.category,
        value: item.count,
        score: item.score,
        protected: item.protected,
        unprotected: item.unprotected,
        fill: getSubcategoryColor(item.category, 0, 1),
      });
    } else {
      subs.forEach((sub, idx) => {
        innerData.push({
          name: sub.subcategory,
          parentCategory: item.category,
          parentLabel: CATEGORY_LABELS[item.category] || item.category,
          value: sub.count,
          score: sub.score,
          protected: sub.protected,
          unprotected: sub.unprotected,
          fill: getSubcategoryColor(item.category, idx, subs.length),
        });
      });
    }
  }

  // Chart config for Recharts (union of all segments)
  const chartConfig: ChartConfig = {};
  outerData.forEach((d) => {
    chartConfig[d.category] = { label: d.name, color: d.fill };
  });
  innerData.forEach((d) => {
    chartConfig[d.name] = { label: d.name, color: d.fill };
  });

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">
          Outer: categories · Inner: subcategories · Sized by execution count
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden">
        <div className="flex items-center gap-4 h-full">
          {/* Nested donut chart */}
          <div className="w-[140px] h-[140px] flex-shrink-0">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <PieChart>
                {/* Inner ring — subcategories */}
                <Pie
                  data={innerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="25%"
                  outerRadius="48%"
                  paddingAngle={1}
                >
                  {innerData.map((entry, index) => (
                    <Cell key={`inner-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                {/* Outer ring — categories */}
                <Pie
                  data={outerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="52%"
                  outerRadius="85%"
                  paddingAngle={2}
                >
                  {outerData.map((entry, index) => (
                    <Cell key={`outer-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, _name, item) => {
                        const p = item.payload;
                        const label = p.parentLabel ? `${p.parentLabel} › ${p.name}` : p.name;
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: p.fill }}
                              />
                              <span className="font-medium">{label}</span>
                            </div>
                            <span className="text-foreground font-bold ml-4">
                              {p.score.toFixed(1)}% blocked
                            </span>
                            <span className="text-xs text-muted-foreground ml-4">
                              {Number(value).toLocaleString()} executions ({p.protected} protected, {p.unprotected} bypassed)
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
          </div>

          {/* Legend — categories with indented subcategories */}
          <div className="flex flex-col gap-1 overflow-y-auto flex-1 min-w-0 max-h-full">
            {sortedData.map((cat) => {
              const subs = cat.subcategories || [];
              return (
                <div key={cat.category}>
                  {/* Category row */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: CATEGORY_COLORS[cat.category] }}
                    />
                    <span className="text-xs font-medium text-foreground whitespace-nowrap">
                      {CATEGORY_LABELS[cat.category] || cat.category}
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums flex-shrink-0 ml-auto">
                      {cat.score.toFixed(1)}%
                    </span>
                  </div>
                  {/* Subcategory rows */}
                  {subs.slice(0, MAX_SUBCATEGORIES).map((sub, idx) => (
                    <div key={sub.subcategory} className="flex items-center gap-2 ml-4">
                      <div
                        className="w-2 h-2 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: getSubcategoryColor(cat.category, idx, Math.min(subs.length, MAX_SUBCATEGORIES)) }}
                      />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap truncate">
                        {sub.subcategory}
                      </span>
                      <span className="text-[11px] tabular-nums flex-shrink-0 ml-auto text-muted-foreground">
                        {sub.score.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
