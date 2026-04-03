import { memo, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DefenseScoreByHostItem } from '@/services/api/analytics';

interface DefenseScoreByHostChartProps {
  data: DefenseScoreByHostItem[];
  loading?: boolean;
  title?: string;
  maxVisibleItems?: number;
}

// Score threshold colors using oklch for consistency with other charts
const SCORE_COLORS = {
  high: 'oklch(0.65 0.22 145)',    // Green: ≥80%
  medium: 'oklch(0.65 0.18 85)',   // Yellow: 50-79%
  low: 'oklch(0.6 0.22 25)',       // Red: <50%
};

function getScoreColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.high;
  if (score >= 50) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
}

interface TooltipData {
  item: DefenseScoreByHostItem;
  x: number;
  y: number;
}

/**
 * Horizontal bar chart showing Defense Score per Host.
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │  Hostname  ████████████████████████░░░  85% │
 * │  Host2     █████████████████░░░░░░░░░  62%  │
 * │  Host3     █████████░░░░░░░░░░░░░░░░░  35%  │
 * └─────────────────────────────────────────────┘
 *   ████ = Score fill (colored by threshold)
 *   ░░░░ = Empty background
 */
function DefenseScoreByHostChart({
  data,
  loading,
  title = 'Defense Score by Host',
  maxVisibleItems = 8
}: DefenseScoreByHostChartProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Sort by total executions (most active hosts first) if not already sorted
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...data].sort((a, b) => b.total - a.total);
  }, [data]);

  // Return early if no data
  if (!data || data.length === 0) {
    if (loading) {
      return (
        <Card className="h-full min-h-[280px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </Card>
      );
    }
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <p className="text-muted-foreground">No data available</p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center overflow-hidden">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  // Truncate long hostnames for inside-bar labels (responsive)
  const truncateName = (name: string, maxLength: number = 16) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
  };

  // Chart dimensions (responsive-friendly)
  const barHeight = 26;
  const barGap = 6;
  const leftPadding = 8;
  const rightPadding = 45; // Space for percentage labels
  const topPadding = 5;
  const chartHeight = chartData.length * (barHeight + barGap) + topPadding;

  // Calculate scroll container max height
  const scrollMaxHeight = maxVisibleItems * (barHeight + barGap) + topPadding;
  const needsScroll = chartData.length > maxVisibleItems;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pb-4 overflow-hidden relative flex flex-col">
        {/* Scrollable chart area */}
        <div
          className={needsScroll ? 'overflow-y-auto' : 'overflow-hidden'}
          style={{ maxHeight: needsScroll ? `${scrollMaxHeight}px` : undefined }}
        >
          <svg
            width="100%"
            height={chartHeight}
            className="overflow-visible"
            onMouseLeave={() => setTooltip(null)}
          >
            {chartData.map((item, index) => {
              const y = topPadding + index * (barHeight + barGap);
              const barWidth = `calc(100% - ${leftPadding + rightPadding}px)`;
              const scoreRatio = item.score / 100;
              const color = getScoreColor(item.score);

              return (
                <g
                  key={item.hostname}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltip({
                      item,
                      x: rect.left + rect.width / 2,
                      y: rect.top
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Container for the bar using foreignObject for percentage width */}
                  <foreignObject
                    x={leftPadding}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    style={{ overflow: 'visible' }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        backgroundColor: 'var(--secondary)'
                      }}
                    >
                      {/* Score fill bar */}
                      <div
                        style={{
                          width: `${scoreRatio * 100}%`,
                          height: '100%',
                          backgroundColor: color,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: '8px',
                          minWidth: scoreRatio > 0.15 ? 'auto' : '0',
                          transition: 'width 0.3s ease-out'
                        }}
                      >
                        {scoreRatio > 0.25 && (
                          <span
                            style={{
                              color: 'white',
                              fontSize: '12px',
                              fontWeight: 500,
                              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {truncateName(item.hostname)}
                          </span>
                        )}
                      </div>
                      {/* Show hostname in empty space if bar is too small */}
                      {scoreRatio <= 0.25 && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: '8px',
                            flex: 1
                          }}
                        >
                          <span
                            style={{
                              color: 'var(--foreground)',
                              fontSize: '12px',
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {truncateName(item.hostname)}
                          </span>
                        </div>
                      )}
                    </div>
                  </foreignObject>

                  {/* Percentage label on the right */}
                  <text
                    x="100%"
                    y={y + barHeight / 2}
                    dx={-rightPadding + 8}
                    dy="0.35em"
                    fill="var(--foreground)"
                    fontSize="12px"
                    fontWeight={500}
                  >
                    {Math.round(item.score)}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y - 10,
              transform: 'translate(-50%, -100%)'
            }}
          >
            <div
              className="px-3 py-2 rounded-lg text-xs"
              style={{
                backgroundColor: 'var(--background)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}
            >
              <div className="font-medium mb-1">{tooltip.item.hostname}</div>
              <div style={{ color: SCORE_COLORS.high }}>
                Protected: {tooltip.item.protected.toLocaleString()}
              </div>
              <div style={{ color: SCORE_COLORS.low }}>
                Unprotected: {tooltip.item.unprotected.toLocaleString()}
              </div>
              <div className="text-muted-foreground mt-1">
                Total: {tooltip.item.total.toLocaleString()} executions
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center justify-center gap-2 sm:gap-4 mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div
              className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm"
              style={{ backgroundColor: SCORE_COLORS.high }}
            />
            <span>≥80%</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div
              className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm"
              style={{ backgroundColor: SCORE_COLORS.medium }}
            />
            <span>50-79%</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div
              className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm"
              style={{ backgroundColor: SCORE_COLORS.low }}
            />
            <span>&lt;50%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(DefenseScoreByHostChart);
