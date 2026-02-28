import { Loader2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { SecureScoreSummary } from '@/services/api/defender';

interface SecureScoreCardProps {
  data: SecureScoreSummary | null;
  loading?: boolean;
}

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
    <Card className="h-full flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-3">
        <ShieldCheck className="w-4 h-4 sm:w-5 md:w-6 sm:h-5 md:h-6 text-primary flex-shrink-0" />
        <span className="text-xs sm:text-sm md:text-base font-medium text-muted-foreground whitespace-nowrap">Secure Score</span>
      </div>
      <div className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight ${getScoreColor(data.percentage)}`}>
        {data.percentage.toFixed(1)}%
      </div>
      <div className="text-sm text-muted-foreground mt-2">
        {data.currentScore.toFixed(1)} / {data.maxScore.toFixed(1)} pts
      </div>
      {data.averageComparative !== null && (
        <div className="text-xs text-muted-foreground mt-1">
          Avg comparable: {data.averageComparative.toFixed(1)}%
        </div>
      )}
    </Card>
  );
}
