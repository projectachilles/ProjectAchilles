import { Loader2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { SecureScoreSummary } from '@/services/api/defender';

interface SecureScoreCardProps {
  data: SecureScoreSummary | null;
  loading?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  Identity: 'bg-blue-500',
  Data: 'bg-purple-500',
  Device: 'bg-green-500',
  Apps: 'bg-amber-500',
  Infrastructure: 'bg-rose-500',
};

function getScoreColor(percentage: number): string {
  if (percentage >= 80) return 'text-green-500';
  if (percentage >= 60) return 'text-yellow-500';
  return 'text-red-500';
}

export default function SecureScoreCard({ data, loading }: SecureScoreCardProps) {
  if (loading || !data) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col p-0 overflow-hidden">
      {/* Top: Secure Score headline */}
      <div className="flex-[3] flex flex-col justify-center items-center px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Secure Score</span>
        </div>
        <div className={`text-4xl sm:text-5xl font-bold tracking-tight ${getScoreColor(data.percentage)}`}>
          {data.percentage.toFixed(1)}%
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {data.currentScore.toFixed(1)} / {data.maxScore.toFixed(1)} pts
        </div>
        {data.averageComparative !== null && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Avg comparable: {data.averageComparative.toFixed(1)}%
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border mx-4" />

      {/* Bottom: Category mini-bars */}
      <div className="flex-[2] px-4 py-3 space-y-1.5 overflow-auto">
        {data.categories.map((cat) => (
          <div key={cat.category} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate text-muted-foreground">{cat.category}</span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${CATEGORY_COLORS[cat.category] ?? 'bg-primary'}`}
                style={{ width: `${Math.min(cat.percentage, 100)}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums">{cat.percentage.toFixed(0)}%</span>
          </div>
        ))}
        {data.categories.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-2">No category data</div>
        )}
      </div>
    </Card>
  );
}
