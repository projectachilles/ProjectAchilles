import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CategorySubcategoryBreakdownItem } from '@/services/api/analytics';

interface CategoryBreakdownChartProps {
  data: CategorySubcategoryBreakdownItem[];
  loading?: boolean;
  title?: string;
}

function BarRow({
  label,
  pct,
  sub,
}: {
  label: string;
  pct: number;
  /** Subcategory rows render muted with a lighter fill. */
  sub?: boolean;
}) {
  return (
    <div className={sub ? 'pl-3' : undefined}>
      <div className="flex items-center justify-between">
        <span className={`truncate font-mono text-xs ${sub ? 'text-muted' : ''}`}>{label}</span>
        <span className="shrink-0 font-mono text-xs text-muted">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            backgroundColor: 'var(--chart-protected)',
            opacity: sub ? 0.55 : 1,
          }}
        />
      </div>
    </div>
  );
}

function CategoryBreakdownChart({ data, loading, title = 'Score by category' }: CategoryBreakdownChartProps) {
  if (loading) {
    return <div className="h-72 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Defense score per test category</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-faint">
            Nothing recorded yet.
          </div>
        ) : (
          <div className="flex max-h-64 flex-col gap-2.5 overflow-y-auto pr-1">
            {data.map((category) => (
              <div key={category.category} className="flex flex-col gap-2">
                <BarRow label={category.category} pct={category.score} />
                {category.subcategories.map((sub) => (
                  <BarRow
                    key={`${category.category}/${sub.subcategory}`}
                    label={sub.subcategory}
                    pct={sub.score}
                    sub
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(CategoryBreakdownChart);
