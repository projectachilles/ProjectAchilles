import { Loader2, Shield, Monitor, FlaskConical, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface HeroMetricsCardProps {
  defenseScore: number | null;
  uniqueEndpoints: number;
  executedTests: number;
  errorRate?: number | null;
  realScore?: number | null;
  riskAcceptedCount?: number;
  loading?: boolean;
}

/**
 * A composite hero card that prominently displays the Defense Score
 * with Unique Endpoints and Executed Tests in a compact bottom section.
 * Designed to occupy 1/3 width alongside the Defense Score Trend chart.
 */
export default function HeroMetricsCard({
  defenseScore,
  uniqueEndpoints,
  executedTests,
  errorRate,
  realScore,
  riskAcceptedCount,
  loading,
}: HeroMetricsCardProps) {
  // Score-based color: green (≥80%), yellow (≥60%), red (<60%)
  const getScoreColor = (score: number | null): string => {
    if (score === null) return 'text-muted-foreground';
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const formatScore = (score: number | null): string => {
    if (score === null) return '—';
    return `${score.toFixed(1)}%`;
  };

  if (loading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col p-0 overflow-hidden">
      {/* Top Section: Defense Score (prominent) - ~60% height */}
      <div className="flex-[3] flex flex-col justify-center items-center px-2 sm:px-4 py-2 sm:py-4 min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-3">
          <Shield className="w-4 h-4 sm:w-5 md:w-6 sm:h-5 md:h-6 text-primary flex-shrink-0" />
          <span className="text-xs sm:text-sm md:text-base font-medium text-muted-foreground whitespace-nowrap">
            Defense Score
          </span>
        </div>
        <div className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight ${getScoreColor(defenseScore)}`}>
          {formatScore(defenseScore)}
        </div>
        {riskAcceptedCount != null && riskAcceptedCount > 0 && realScore != null && (
          <div className="flex flex-col items-center gap-0.5 mt-1">
            <span className={`text-sm sm:text-base font-medium ${getScoreColor(realScore)}`}>
              actual: {realScore.toFixed(1)}%
            </span>
            <span className="text-xs text-amber-500">
              {riskAcceptedCount} risk-accepted excluded
            </span>
          </div>
        )}
        {errorRate !== null && errorRate !== undefined && errorRate > 0 && (
          <div className="flex items-center gap-1 mt-1 sm:mt-2">
            <AlertTriangle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-xs sm:text-sm text-amber-500">
              {errorRate.toFixed(1)}% inconclusive
            </span>
          </div>
        )}
      </div>

      {/* Horizontal Divider */}
      <div className="border-t-[length:var(--theme-border-width)] border-border mx-2 sm:mx-4" />

      {/* Bottom Section: Two compact metrics side-by-side - ~40% height */}
      <div className="flex-[2] flex divide-x divide-border min-w-0">
        {/* Unique Endpoints */}
        <div className="flex-1 flex flex-col justify-center items-center px-1 sm:px-2 py-2 sm:py-3 min-w-0">
          <div className="flex items-center gap-1 sm:gap-1.5 mb-0.5 sm:mb-1">
            <Monitor className="w-3 h-3 sm:w-4 sm:h-4 text-primary flex-shrink-0" />
            <span className="text-xs sm:text-sm text-muted-foreground truncate">Endpoints</span>
          </div>
          <div className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground">
            {uniqueEndpoints.toLocaleString()}
          </div>
        </div>

        {/* Executed Tests */}
        <div className="flex-1 flex flex-col justify-center items-center px-1 sm:px-2 py-2 sm:py-3 min-w-0">
          <div className="flex items-center gap-1 sm:gap-1.5 mb-0.5 sm:mb-1">
            <FlaskConical className="w-3 h-3 sm:w-4 sm:h-4 text-primary flex-shrink-0" />
            <span className="text-xs sm:text-sm text-muted-foreground truncate">Tests</span>
          </div>
          <div className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground">
            {executedTests.toLocaleString()}
          </div>
        </div>
      </div>
    </Card>
  );
}
