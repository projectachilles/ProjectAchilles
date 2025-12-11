import { Shield, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';

interface DefenseScoreCardProps {
  score: number;
  delta?: number | null;
  total?: number;
  protected?: number;
  loading?: boolean;
}

export default function DefenseScoreCard({
  score,
  delta,
  total,
  protected: protectedCount,
  loading
}: DefenseScoreCardProps) {
  // Determine color based on score
  const getScoreColor = (value: number) => {
    if (value >= 80) return 'text-green-500';
    if (value >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  // Determine delta indicator
  const getDeltaDisplay = () => {
    if (delta === null || delta === undefined) return null;

    const isPositive = delta > 0;
    const isNegative = delta < 0;
    const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
    const colorClass = isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-muted-foreground';

    return (
      <div className={`flex items-center gap-1 text-sm ${colorClass}`}>
        <Icon className="w-4 h-4" />
        <span>{isPositive ? '+' : ''}{delta.toFixed(1)}%</span>
        <span className="text-muted-foreground">vs prior week</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-secondary/50 border border-border rounded-xl p-6 flex items-center justify-center min-h-[180px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="bg-secondary/50 border border-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">Defense Score</h3>
      </div>

      <div className="flex flex-col items-center justify-center py-4">
        <div className={`text-6xl font-bold ${getScoreColor(score)}`}>
          {score.toFixed(1)}%
        </div>

        {getDeltaDisplay()}

        {total !== undefined && protectedCount !== undefined && (
          <div className="mt-4 text-sm text-muted-foreground">
            {protectedCount} protected of {total} executions
          </div>
        )}
      </div>
    </div>
  );
}
