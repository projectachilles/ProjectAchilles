import { Loader2 } from 'lucide-react';
import type { CategoryBreakdownItem, CategoryType } from '@/services/api/analytics';

interface CategoryBreakdownChartProps {
  data: CategoryBreakdownItem[];
  loading?: boolean;
  title?: string;
}

const CATEGORY_COLORS: Record<CategoryType, { bar: string; text: string }> = {
  'intel-driven': { bar: 'bg-blue-500', text: 'text-blue-500' },
  'mitre-top10': { bar: 'bg-purple-500', text: 'text-purple-500' },
  'cyber-hygiene': { bar: 'bg-teal-500', text: 'text-teal-500' },
  'phase-aligned': { bar: 'bg-indigo-500', text: 'text-indigo-500' },
};

const CATEGORY_LABELS: Record<CategoryType, string> = {
  'intel-driven': 'Intel-Driven',
  'mitre-top10': 'MITRE Top 10',
  'cyber-hygiene': 'Cyber Hygiene',
  'phase-aligned': 'Phase-Aligned',
};

export default function CategoryBreakdownChart({
  data,
  loading,
  title = 'Score by Category',
}: CategoryBreakdownChartProps) {
  if (loading) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Sort by score descending
  const sortedData = [...data].sort((a, b) => b.score - a.score);

  if (sortedData.length === 0) {
    return (
      <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex flex-col">
        <h3 className="font-semibold text-sm mb-4 text-foreground">{title}</h3>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">No category data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-secondary/50 border border-border rounded-xl p-4 flex flex-col">
      <h3 className="font-semibold text-sm mb-4 text-foreground">{title}</h3>

      <div className="flex-1 flex flex-col justify-center space-y-3">
        {sortedData.map((item) => {
          const colors = CATEGORY_COLORS[item.category] || { bar: 'bg-gray-500', text: 'text-gray-500' };
          const label = CATEGORY_LABELS[item.category] || item.category;
          const barWidth = Math.max(item.score, 2);

          return (
            <div key={item.category} className="flex items-center gap-3">
              {/* Label */}
              <div className={`w-24 text-sm font-medium truncate ${colors.text}`} title={label}>
                {label}
              </div>

              {/* Bar Container */}
              <div className="flex-1 h-5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${colors.bar} transition-all duration-500 ease-out rounded-full`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* Score */}
              <div className="w-12 text-right text-sm font-medium text-foreground">
                {item.score.toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Defense score (% blocked) by test category
        </p>
      </div>
    </div>
  );
}
