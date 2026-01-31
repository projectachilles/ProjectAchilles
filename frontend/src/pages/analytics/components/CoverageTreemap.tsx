import { useState, useMemo, useCallback } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { Loader2, ChevronLeft } from 'lucide-react';
import type { HostTestMatrixCell } from '../../../services/api/analytics';
import { useTheme } from '../../../hooks/useTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CoverageTreemapProps {
  data: HostTestMatrixCell[];
  loading?: boolean;
  title?: string;
  /** Stable test count from last 90 days for consistent coverage calculation */
  canonicalTestCount?: number;
}

interface TreemapNode {
  name: string;
  size?: number;
  children?: TreemapNode[];
  // Custom fields for our coverage data
  totalCount?: number;
  testCount?: number;
  coverage?: number;
  fill?: string;
  missingTests?: string[];
}

interface TooltipPayload {
  payload?: TreemapNode;
}

// Coverage threshold colors (theme-aware) - oklch for consistency with other dashboard charts
// Lightness tuned for white text contrast on filled backgrounds
const COVERAGE_COLORS = {
  dark: {
    high: 'oklch(0.50 0.14 155)',    // teal-green ≥80% — matches --chart-protected hue family
    medium: 'oklch(0.50 0.12 75)',   // warm amber 50-79% — matches --chart-4 hue family
    low: 'oklch(0.45 0.15 25)',      // muted red <50% — matches --chart-bypassed hue family
    empty: 'oklch(0.30 0.01 260)',   // neutral zinc — no data
  },
  light: {
    high: 'oklch(0.58 0.16 155)',    // teal-green
    medium: 'oklch(0.58 0.14 75)',   // warm amber
    low: 'oklch(0.52 0.17 25)',      // red
    empty: 'oklch(0.90 0.01 260)',   // light zinc
  },
};

function getCoverageColor(coverage: number, isDark: boolean): string {
  const colors = isDark ? COVERAGE_COLORS.dark : COVERAGE_COLORS.light;
  if (coverage >= 0.8) return colors.high;
  if (coverage >= 0.5) return colors.medium;
  return colors.low;
}

function getCoverageLabel(coverage: number): string {
  if (coverage >= 0.8) return 'Good';
  if (coverage >= 0.5) return 'Fair';
  return 'Poor';
}

// Custom content renderer for treemap cells
interface CustomContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  coverage?: number;
  testCount?: number;
  fill?: string;
  onClick?: () => void;
  isClickable?: boolean;
}

function CustomTreemapContent(props: CustomContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, coverage, testCount, fill, isClickable = true } = props;

  // Don't render tiny cells
  if (width < 30 || height < 20) return null;

  // Adjusted visibility thresholds for bottom-anchored layout
  const showName = width > 50 && height > 30;
  const showDetails = width > 70 && height > 45;

  // Truncate name based on available width
  const maxChars = Math.floor(width / 9);
  const displayName = name && name.length > maxChars ? name.slice(0, maxChars) + '…' : name;

  // Responsive font sizes: larger for better readability
  const fontSize = Math.min(14, Math.max(11, width / 8));
  const detailsFontSize = Math.min(11, Math.max(9, width / 10));
  const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';

  // Bottom-left anchored positioning
  const textPadding = 10;
  const textX = x + textPadding;
  const statsY = y + height - 12;      // Stats line near bottom
  // Only leave room for stats if we'll actually show them
  const willShowStats = showDetails && coverage !== undefined;
  const hostnameY = willShowStats ? y + height - 28 : y + height - 14;  // Hostname above stats

  // Compact stats format: "95% · 19 tests"
  const statsText = coverage !== undefined ? `${(coverage * 100).toFixed(0)}% · ${testCount} tests` : '';

  return (
    <g style={{ cursor: isClickable ? 'pointer' : 'default' }}>
      {/* Cell background */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="var(--background)"
        strokeWidth={3}
        rx={6}
        className="transition-opacity hover:opacity-80"
      />

      {/* Hostname text - bottom-left anchored */}
      {showName && (
        <text
          x={textX}
          y={hostnameY}
          textAnchor="start"
          dominantBaseline="auto"
          fill="white"
          stroke="none"
          fontSize={fontSize}
          fontWeight={500}
          fontFamily={fontFamily}
          letterSpacing={0.2}
        >
          {displayName}
        </text>
      )}

      {/* Coverage stats text - compact format below hostname */}
      {showDetails && coverage !== undefined && (
        <text
          x={textX}
          y={statsY}
          textAnchor="start"
          dominantBaseline="auto"
          fill="rgba(255, 255, 255, 0.75)"
          stroke="none"
          fontSize={detailsFontSize}
          fontWeight={400}
          fontFamily={fontFamily}
          letterSpacing={0.3}
        >
          {statsText}
        </text>
      )}
    </g>
  );
}

// Custom tooltip
function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  if (!data) return null;

  const { name, totalCount, testCount, coverage, missingTests } = data;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 max-w-xs">
      <p className="font-semibold text-foreground mb-1">{name}</p>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{testCount}</span> unique tests run
        </p>
        <p>
          <span className="font-medium text-foreground">{totalCount}</span> total executions
        </p>
        {coverage !== undefined && (
          <p>
            Coverage:{' '}
            <span
              className="font-medium"
              style={{ color: coverage >= 0.8 ? 'oklch(0.65 0.22 145)' : coverage >= 0.5 ? 'oklch(0.65 0.18 85)' : 'oklch(0.6 0.22 25)' }}
            >
              {(coverage * 100).toFixed(0)}% ({getCoverageLabel(coverage)})
            </span>
          </p>
        )}
        {missingTests && missingTests.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">
              Missing {missingTests.length} test{missingTests.length !== 1 ? 's' : ''}:
            </p>
            <ul className="text-xs text-red-400 space-y-0.5">
              {missingTests.slice(0, 5).map(test => (
                <li key={test}>• {test}</li>
              ))}
              {missingTests.length > 5 && (
                <li className="text-muted-foreground">...and {missingTests.length - 5} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2 italic">Click to drill down</p>
    </div>
  );
}

// Drill-down tooltip for individual tests
function DrillDownTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  if (!data) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
      <p className="font-semibold text-foreground">{data.name}</p>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{data.size}</span> executions
      </p>
    </div>
  );
}

export default function CoverageTreemap({
  data,
  loading,
  title = 'Test Breadth by Host',
  canonicalTestCount
}: CoverageTreemapProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Drill-down state: null = overview, string = hostname to show tests for
  const [drillDownHost, setDrillDownHost] = useState<string | null>(null);

  // Transform flat data to hierarchical treemap structure
  const { treemapData, allUniqueTests, effectiveTestCount } = useMemo(() => {
    if (!data || data.length === 0) {
      return { treemapData: null, allUniqueTests: new Set<string>(), effectiveTestCount: 0 };
    }

    // Get all unique tests across all hosts (for coverage calculation)
    const allTests = new Set(data.map(d => d.testName));

    // Use canonical test count if provided, otherwise fall back to current window's tests
    // This ensures consistent coverage percentages across different time ranges
    const baselineCount = canonicalTestCount && canonicalTestCount > 0
      ? canonicalTestCount
      : allTests.size;

    // Group by hostname
    const hostMap = new Map<string, { tests: Map<string, number>; totalCount: number }>();

    data.forEach(cell => {
      if (!hostMap.has(cell.hostname)) {
        hostMap.set(cell.hostname, { tests: new Map(), totalCount: 0 });
      }
      const hostData = hostMap.get(cell.hostname)!;
      hostData.tests.set(cell.testName, cell.count);
      hostData.totalCount += cell.count;
    });

    // Build treemap children (overview mode - NO nested children to avoid nested cells)
    const children: TreemapNode[] = Array.from(hostMap.entries()).map(([hostname, hostData]) => {
      const testCount = hostData.tests.size;
      const coverage = baselineCount > 0 ? testCount / baselineCount : 0;

      // Find missing tests
      const runTests = new Set(hostData.tests.keys());
      const missingTests = Array.from(allTests).filter(t => !runTests.has(t));

      return {
        name: hostname,
        size: hostData.totalCount, // Size by total executions
        totalCount: hostData.totalCount,
        testCount,
        coverage,
        fill: getCoverageColor(coverage, isDark),
        missingTests,
        // NOTE: Don't include children here - Recharts renders them as nested cells
      };
    });

    // Sort by total count descending (biggest hosts first)
    children.sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));

    return {
      treemapData: { name: 'root', children },
      allUniqueTests: allTests,
      effectiveTestCount: baselineCount,
    };
  }, [data, isDark, canonicalTestCount]);

  // Get drill-down data if a host is selected (build test children from original data)
  const drillDownData = useMemo(() => {
    if (!drillDownHost || !data) return null;

    // Filter original data for the selected host and build test children
    const hostTests = data.filter(d => d.hostname === drillDownHost);
    if (hostTests.length === 0) return null;

    const testChildren: TreemapNode[] = hostTests
      .map(test => ({
        name: test.testName,
        size: test.count,
        fill: getCoverageColor(1, isDark), // Tests shown as "covered"
      }))
      .sort((a, b) => (b.size || 0) - (a.size || 0));

    return {
      name: drillDownHost,
      children: testChildren,
    };
  }, [drillDownHost, data, isDark]);

  const handleCellClick = useCallback((node: TreemapNode) => {
    if (!drillDownHost && node.name) {
      setDrillDownHost(node.name);
    }
  }, [drillDownHost]);

  const handleBackClick = useCallback(() => {
    setDrillDownHost(null);
  }, []);

  // Loading state
  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  // Empty state
  if (!data || data.length === 0 || !treemapData) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <p className="text-muted-foreground">No coverage data available</p>
      </Card>
    );
  }

  const currentData = drillDownData || treemapData;
  const isInDrillDown = drillDownHost !== null;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isInDrillDown && (
              <button
                onClick={handleBackClick}
                className="p-1 hover:bg-secondary rounded transition-colors"
                title="Back to overview"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <CardTitle className="text-lg font-semibold">
              {isInDrillDown ? `${drillDownHost} Tests` : title}
            </CardTitle>
          </div>
          {!isInDrillDown && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: COVERAGE_COLORS[isDark ? 'dark' : 'light'].high }}
                />
                ≥80%
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: COVERAGE_COLORS[isDark ? 'dark' : 'light'].medium }}
                />
                50-79%
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: COVERAGE_COLORS[isDark ? 'dark' : 'light'].low }}
                />
                &lt;50%
              </span>
            </div>
          )}
        </div>
        {!isInDrillDown && (
          <p className="text-xs text-muted-foreground mt-1">
            {treemapData.children?.length || 0} hosts • {effectiveTestCount} unique tests{canonicalTestCount ? ' (90d baseline)' : ''} • Click host to drill down
          </p>
        )}
      </CardHeader>
      <CardContent className="flex-1 pb-4 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={currentData.children}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="var(--background)"
            onClick={isInDrillDown ? undefined : (node) => {
              if (node && node.name) {
                handleCellClick({ name: node.name });
              }
            }}
            content={({ x, y, width, height, name, coverage, testCount, fill }) => (
              <CustomTreemapContent
                x={x}
                y={y}
                width={width}
                height={height}
                name={name}
                coverage={isInDrillDown ? undefined : coverage}
                testCount={isInDrillDown ? undefined : testCount}
                fill={fill}
                isClickable={!isInDrillDown}
              />
            )}
          >
            <Tooltip content={isInDrillDown ? <DrillDownTooltip /> : <CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
