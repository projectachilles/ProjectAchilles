import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMemo, useState } from 'react';

interface StackedBarChartProps {
  data: Array<{
    name?: string;
    technique?: string;
    protected: number;
    unprotected: number;
  }>;
  loading?: boolean;
  title?: string;
  badge?: React.ReactNode; // Optional badge rendered next to the title
  maxVisibleItems?: number; // Items shown before scrolling (default: 8)
}

// Use oklch colors directly since SVG doesn't resolve CSS variables properly in fill
const PROTECTED_COLOR = 'oklch(0.65 0.22 145)';
const BYPASSED_COLOR = 'oklch(0.6 0.22 25)';

interface ChartItem {
  name: string;
  protected: number;
  unprotected: number;
  total: number;
  percentage: number;
}

interface TooltipData {
  item: ChartItem;
  x: number;
  y: number;
}

/**
 * Horizontal stacked bar chart showing Protected vs Unprotected counts.
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │  Category Name ████████████████░░░░░░  65%  │
 * │  Another Item  ██████████████████░░░  82%   │
 * └─────────────────────────────────────────────┘
 *   ████ = Protected (green)    ░░░░ = Unprotected (red)
 *
 * Uses custom SVG rendering to avoid Recharts stacking bugs.
 */
export default function StackedBarChart({
  data,
  loading,
  title = 'Coverage',
  badge,
  maxVisibleItems = 8
}: StackedBarChartProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Normalize data and calculate percentages
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map(item => {
      const total = item.protected + item.unprotected;
      const percentage = total > 0 ? Math.round((item.protected / total) * 100) : 0;
      return {
        name: item.name || item.technique || 'Unknown',
        protected: item.protected,
        unprotected: item.unprotected,
        total,
        percentage
      };
    });
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

  // Truncate long names for inside-bar labels (responsive)
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

  // Find max total for scaling
  const maxTotal = Math.max(...chartData.map(d => d.total), 1);

  // Calculate scroll container max height (items * row height + padding)
  const scrollMaxHeight = maxVisibleItems * (barHeight + barGap) + topPadding;
  const needsScroll = chartData.length > maxVisibleItems;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {badge}
        </div>
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
            const protectedRatio = item.total > 0 ? item.protected / item.total : 0;
            const bypassedRatio = item.total > 0 ? item.unprotected / item.total : 0;
            // Scale bar to max value
            const scaleFactor = item.total / maxTotal;

            return (
              <g
                key={item.name}
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
                      width: `${scaleFactor * 100}%`,
                      height: '100%',
                      display: 'flex',
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Protected segment (green) */}
                    {protectedRatio > 0 && (
                      <div
                        style={{
                          width: `${protectedRatio * 100}%`,
                          height: '100%',
                          backgroundColor: PROTECTED_COLOR,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: '8px',
                          minWidth: protectedRatio > 0.15 ? 'auto' : '0'
                        }}
                      >
                        {protectedRatio > 0.25 && (
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
                            {truncateName(item.name)}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Unprotected segment (red) */}
                    {bypassedRatio > 0 && (
                      <div
                        style={{
                          width: `${bypassedRatio * 100}%`,
                          height: '100%',
                          backgroundColor: BYPASSED_COLOR,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: protectedRatio <= 0.25 ? '8px' : '0'
                        }}
                      >
                        {/* Show label in red section if green is too small */}
                        {protectedRatio <= 0.25 && bypassedRatio > 0.25 && (
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
                            {truncateName(item.name)}
                          </span>
                        )}
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
                  {item.percentage}%
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
              <div className="font-medium mb-1">{tooltip.item.name}</div>
              <div style={{ color: PROTECTED_COLOR }}>
                Protected: {tooltip.item.protected.toLocaleString()}
              </div>
              <div style={{ color: BYPASSED_COLOR }}>
                Unprotected: {tooltip.item.unprotected.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Legend (fixed outside scroll area) */}
        <div className="flex items-center justify-center gap-3 sm:gap-6 mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div
              className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm"
              style={{ backgroundColor: PROTECTED_COLOR }}
            />
            <span>Protected</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div
              className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm"
              style={{ backgroundColor: BYPASSED_COLOR }}
            />
            <span>Unprotected</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
