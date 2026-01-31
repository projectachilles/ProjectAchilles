import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon?: LucideIcon;
  loading?: boolean;
  format?: 'number' | 'percent';
  valueColor?: 'default' | 'score' | 'green' | 'red' | 'yellow';
}

export default function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  format = 'number',
  valueColor = 'default'
}: MetricCardProps) {
  // Format the value
  const formattedValue = typeof value === 'number'
    ? format === 'percent'
      ? `${value.toFixed(1)}%`
      : value.toLocaleString()
    : value;

  // Determine color based on score (for defense score)
  const getScoreColor = (val: number | string) => {
    if (typeof val !== 'number') return 'text-foreground';
    if (valueColor === 'score') {
      if (val >= 80) return 'text-green-500';
      if (val >= 60) return 'text-yellow-500';
      return 'text-red-500';
    }
    if (valueColor === 'green') return 'text-green-500';
    if (valueColor === 'red') return 'text-red-500';
    if (valueColor === 'yellow') return 'text-yellow-500';
    return 'text-foreground';
  };

  if (loading) {
    return (
      <Card className="h-full min-h-[140px] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-primary" />}
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          <div className={`text-4xl font-bold ${getScoreColor(value)}`}>
            {formattedValue}
          </div>

          {subtitle && (
            <div className="mt-2 text-xs text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
