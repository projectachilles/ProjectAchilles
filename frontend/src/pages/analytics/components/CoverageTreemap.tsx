import { useState, useMemo, useCallback, memo } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { Loader2, ChevronLeft } from 'lucide-react';
import type { HostTestMatrixCell } from '../../../services/api/analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useChartTokens } from '@/lib/chartTokens';
import { pickAccessibleLabel } from '@/lib/contrast';

interface CoverageTreemapProps {
  data: HostTestMatrixCell[];
  loading?: boolean;
  title?: string;
  /** Stable test count from last 90 days for consistent coverage calculation */
  canonicalTestCount?: number;
  /** Stable test count from last 30 days */
  canonicalTestCount30d?: number;
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

const MAX_VISIBLE_HOSTS = 25;
const MAX_VISIBLE_TESTS = 25;

// Coverage ratio → governed sequential heat ramp (resolved via useChartTokens so the
// SVG `fill` attribute gets a concrete color, not an unresolved `var(...)` string).
// heat[4]/[2]/[0] give the high/medium/low contrast steps; theme-awareness comes
// from the token values themselves (see --chart-heat-* in index.css), not branching here.
function getCoverageColor(coverage: number, heat: readonly string[]): string {
  if (coverage >= 0.8) return heat[4];
  if (coverage >= 0.5) return heat[2];
  return heat[0];
}

function getCoverageLabel(coverage: number): string {
  if (coverage >= 0.8) return 'Good';
  if (coverage >= 0.5) return 'Fair';
  return 'Poor';
}

// Coverage band → swatch color (used only as a small color-cue dot beside the
// label; the label TEXT itself always renders in --foreground so it stays
// legible on --popover/--card regardless of band — --chart-warn (amber) fails
// WCAG AA as a text color on those surfaces in light mode).
function getCoverageBandColor(coverage: number): string {
  if (coverage >= 0.8) return 'var(--chart-protected)';
  if (coverage >= 0.5) return 'var(--chart-warn)';
  return 'var(--chart-bypassed)';
}

// Pick a readable label color for a treemap cell by computing the ACTUAL WCAG
// contrast ratio of each candidate label against the cell's own resolved
// "oklch(L C H)" fill (contrast depends on the cell background — including its
// chroma, not just lightness — and NOT on the page theme). Delegates to
// pickAccessibleLabel, which returns whichever label has the higher computed
// contrast; unresolved fills (e.g. jsdom, which never resolves CSS custom
// properties) fall back to candidates[0] without throwing.
function pickLabelFill(fill: string | undefined, labelOnLight: string, labelOnDark: string): string {
  return pickAccessibleLabel(fill ?? '', [labelOnDark, labelOnLight]);
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
  hideCoverageStats?: boolean;
  labelOnLight?: string;
  labelOnDark?: string;
}

function CustomTreemapContent(props: CustomContentProps) {
  const {
    x = 0, y = 0, width = 0, height = 0, name, coverage: rawCoverage, testCount: rawTestCount, fill,
    isClickable = true, hideCoverageStats = false, labelOnLight = '', labelOnDark = '',
  } = props;
  // Contrast-aware label color: chosen against this cell's own background
  // lightness, not the surrounding page theme, so text stays legible across
  // the whole --chart-heat-1..5 range (WCAG 2.2 AA, both theme directions).
  const textFill = pickLabelFill(fill, labelOnLight, labelOnDark);
  const coverage = hideCoverageStats ? undefined : rawCoverage;
  const testCount = hideCoverageStats ? undefined : rawTestCount;

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

  // Compact stats format: "95% · 19 tests" — append "⋯" for "Others" aggregate node
  const isOthersNode = name?.startsWith('Others (');
  const statsText = coverage !== undefined
    ? `${(coverage * 100).toFixed(0)}% · ${testCount} tests${isOthersNode ? ' ⋯' : ''}`
    : '';

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
          fill={textFill}
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
          fill={textFill}
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
function CustomTooltip({ active, payload, baselineLabel }: { active?: boolean; payload?: TooltipPayload[]; baselineLabel?: string }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  if (!data) return null;

  const { name, totalCount, testCount, coverage, missingTests } = data;
  const isOthersNode = name?.startsWith('Others (');

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 max-w-xs">
      <p className="font-semibold text-foreground mb-1">{name}</p>
      <div className="space-y-1 text-sm text-muted-foreground">
        {isOthersNode ? (
          <>
            <p>
              <span className="font-medium text-foreground">{totalCount}</span> total executions across aggregated hosts
            </p>
            {coverage !== undefined && (
              <p>
                Combined coverage:{' '}
                <span className="font-medium text-foreground">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                    style={{ backgroundColor: getCoverageBandColor(coverage) }}
                  />
                  {(coverage * 100).toFixed(0)}% ({getCoverageLabel(coverage)})
                </span>
                {baselineLabel && (
                  <span className="text-xs text-muted-foreground"> — {baselineLabel}</span>
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              <span className="font-medium text-foreground">{testCount}</span> unique tests run
            </p>
            <p>
              <span className="font-medium text-foreground">{totalCount}</span> total executions
            </p>
            {coverage !== undefined && (
              <p>
                Coverage:{' '}
                <span className="font-medium text-foreground">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                    style={{ backgroundColor: getCoverageBandColor(coverage) }}
                  />
                  {(coverage * 100).toFixed(0)}% ({getCoverageLabel(coverage)})
                </span>
                {baselineLabel && (
                  <span className="text-xs text-muted-foreground"> — {baselineLabel}</span>
                )}
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
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2 italic">
        {isOthersNode ? 'Click to expand' : 'Click to drill down'}
      </p>
    </div>
  );
}

// Tooltip for "Others" drill-down view (shows host-level stats)
function OthersDrillDownTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  if (!data) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
      <p className="font-semibold text-foreground mb-1">{data.name}</p>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{data.testCount}</span> unique tests
        </p>
        <p>
          <span className="font-medium text-foreground">{data.totalCount}</span> total executions
        </p>
        {data.coverage !== undefined && (
          <p>
            Coverage:{' '}
            <span className="font-medium text-foreground">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                style={{ backgroundColor: getCoverageBandColor(data.coverage) }}
              />
              {(data.coverage * 100).toFixed(0)}% ({getCoverageLabel(data.coverage)})
            </span>
          </p>
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

  const isOthersTestNode = data.name?.startsWith('Others (');

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
      <p className="font-semibold text-foreground">{data.name}</p>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{data.size}</span>
        {isOthersTestNode ? ' total executions across aggregated tests' : ' executions'}
      </p>
    </div>
  );
}

function CoverageTreemap({
  data,
  loading,
  title = 'Test Breadth by Host',
  canonicalTestCount,
  canonicalTestCount30d
}: CoverageTreemapProps) {
  // Resolved sequential heat ramp + neutral "aggregate bucket" token — re-reads on
  // theme flips via useChartTokens' MutationObserver, so no manual isDark branching.
  const heatTokens = useChartTokens([
    '--chart-heat-1', '--chart-heat-2', '--chart-heat-3', '--chart-heat-4', '--chart-heat-5', '--chart-cat-5',
    '--chart-label-on-light', '--chart-label-on-dark',
  ]);
  const HEAT = [
    heatTokens['--chart-heat-1'], heatTokens['--chart-heat-2'], heatTokens['--chart-heat-3'],
    heatTokens['--chart-heat-4'], heatTokens['--chart-heat-5'],
  ];

  // Drill-down state: null = overview, string = hostname to show tests for
  const [drillDownHost, setDrillDownHost] = useState<string | null>(null);
  // Track whether we navigated to a host from the "Others" view (for back-navigation)
  const [cameFromOthers, setCameFromOthers] = useState(false);
  // Coverage denominator toggle: '90d'/'30d' uses canonical count, 'window' uses current window's unique tests
  const [baselineMode, setBaselineMode] = useState<'90d' | '30d' | 'window'>('90d');

  // Transform flat data to hierarchical treemap structure
  const { treemapData, effectiveTestCount, remainingHostnames } = useMemo(() => {
    if (!data || data.length === 0) {
      return { treemapData: null, allUniqueTests: new Set<string>(), effectiveTestCount: 0, remainingHostnames: new Set<string>() };
    }

    // Get all unique tests across all hosts (for coverage calculation)
    const allTests = new Set(data.map(d => d.testName));

    // Use canonical test count (90d/30d) or current window's unique test count based on toggle
    const baselineCount =
      baselineMode === '90d' && canonicalTestCount && canonicalTestCount > 0
        ? canonicalTestCount
        : baselineMode === '30d' && canonicalTestCount30d && canonicalTestCount30d > 0
          ? canonicalTestCount30d
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
        fill: getCoverageColor(coverage, HEAT),
        missingTests,
        // NOTE: Don't include children here - Recharts renders them as nested cells
      };
    });

    // Sort by total count descending (biggest hosts first)
    children.sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));

    // Aggregate tail hosts into "Others" if there are too many
    let finalChildren = children;
    let remaining = new Set<string>();

    if (children.length > MAX_VISIBLE_HOSTS) {
      const topHosts = children.slice(0, MAX_VISIBLE_HOSTS);
      const remainingHosts = children.slice(MAX_VISIBLE_HOSTS);

      remaining = new Set(remainingHosts.map(h => h.name));

      // Compute aggregate stats for "Others" node
      const othersTotalCount = remainingHosts.reduce((sum, h) => sum + (h.totalCount || 0), 0);

      // Union of unique tests across remaining hosts
      const othersTestSet = new Set<string>();
      data.forEach(cell => {
        if (remaining.has(cell.hostname)) {
          othersTestSet.add(cell.testName);
        }
      });
      const othersTestCount = othersTestSet.size;
      const othersCoverage = baselineCount > 0 ? othersTestCount / baselineCount : 0;

      // Union of missing tests across remaining hosts (deduplicated)
      const othersMissingTests = Array.from(allTests).filter(t => !othersTestSet.has(t));

      const othersNode: TreemapNode = {
        name: `Others (${remainingHosts.length} hosts)`,
        size: othersTotalCount,
        totalCount: othersTotalCount,
        testCount: othersTestCount,
        coverage: othersCoverage,
        fill: getCoverageColor(othersCoverage, HEAT),
        missingTests: othersMissingTests,
      };

      finalChildren = [...topHosts, othersNode];
    }

    return {
      treemapData: { name: 'root', children: finalChildren },
      allUniqueTests: allTests,
      effectiveTestCount: baselineCount,
      remainingHostnames: remaining,
    };
  }, [data, heatTokens, canonicalTestCount, canonicalTestCount30d, baselineMode]);

  // Get drill-down data if a host is selected (build test children from original data)
  const drillDownData = useMemo(() => {
    if (!drillDownHost || !data) return null;

    // "Others" drill-down: show remaining hosts as treemap cells
    if (drillDownHost === '__others__' && remainingHostnames.size > 0) {
      // Use same baseline as the overview
      const allTests = new Set(data.map(d => d.testName));
      const baselineCount =
        baselineMode === '90d' && canonicalTestCount && canonicalTestCount > 0
          ? canonicalTestCount
          : baselineMode === '30d' && canonicalTestCount30d && canonicalTestCount30d > 0
            ? canonicalTestCount30d
            : allTests.size;

      const hostMap = new Map<string, { tests: Map<string, number>; totalCount: number }>();
      data.forEach(cell => {
        if (!remainingHostnames.has(cell.hostname)) return;
        if (!hostMap.has(cell.hostname)) {
          hostMap.set(cell.hostname, { tests: new Map(), totalCount: 0 });
        }
        const hostData = hostMap.get(cell.hostname)!;
        hostData.tests.set(cell.testName, cell.count);
        hostData.totalCount += cell.count;
      });

      const hostChildren: TreemapNode[] = Array.from(hostMap.entries())
        .map(([hostname, hostData]) => {
          const testCount = hostData.tests.size;
          const coverage = baselineCount > 0 ? testCount / baselineCount : 0;
          return {
            name: hostname,
            size: hostData.totalCount,
            totalCount: hostData.totalCount,
            testCount,
            coverage,
            fill: getCoverageColor(coverage, HEAT),
          };
        })
        .sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));

      return {
        name: '__others__',
        children: hostChildren,
      };
    }

    // Single-host drill-down: show individual tests
    const hostTests = data.filter(d => d.hostname === drillDownHost);
    if (hostTests.length === 0) return null;

    const testChildren: TreemapNode[] = hostTests
      .map(test => ({
        name: test.testName,
        size: test.count,
        fill: getCoverageColor(1, HEAT), // Tests shown as "covered"
      }))
      .sort((a, b) => (b.size || 0) - (a.size || 0));

    // Aggregate tail tests into "Others" if there are too many
    let finalTestChildren = testChildren;
    if (testChildren.length > MAX_VISIBLE_TESTS) {
      const topTests = testChildren.slice(0, MAX_VISIBLE_TESTS);
      const remainingTests = testChildren.slice(MAX_VISIBLE_TESTS);
      const othersSize = remainingTests.reduce((sum, t) => sum + (t.size || 0), 0);

      const othersTestNode: TreemapNode = {
        name: `Others (${remainingTests.length} tests)`,
        size: othersSize,
        totalCount: othersSize,
        fill: heatTokens['--chart-cat-5'],
      };

      finalTestChildren = [...topTests, othersTestNode];
    }

    return {
      name: drillDownHost,
      children: finalTestChildren,
    };
  }, [drillDownHost, data, heatTokens, remainingHostnames, baselineMode, canonicalTestCount, canonicalTestCount30d]);

  const handleCellClick = useCallback((node: TreemapNode) => {
    if (!node.name) return;

    if (!drillDownHost) {
      // Overview: click host → drill down, click "Others" → expand
      if (node.name.startsWith('Others (')) {
        setDrillDownHost('__others__');
      } else {
        setDrillDownHost(node.name);
      }
    } else if (drillDownHost === '__others__') {
      // "Others" view: click a host → drill into its tests
      setDrillDownHost(node.name);
      setCameFromOthers(true);
    }
  }, [drillDownHost]);

  const handleBackClick = useCallback(() => {
    if (cameFromOthers) {
      // Go back to the "Others" view, not all the way to overview
      setDrillDownHost('__others__');
      setCameFromOthers(false);
    } else {
      setDrillDownHost(null);
    }
  }, [cameFromOthers]);

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
  const isOthersDrillDown = drillDownHost === '__others__';
  const isSingleHostDrillDown = isInDrillDown && !isOthersDrillDown;

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
            <CardTitle className="text-sm font-medium">
              {isInDrillDown
                ? drillDownHost === '__others__'
                  ? `Other Hosts (${remainingHostnames.size})`
                  : `${drillDownHost} Tests`
                : title}
            </CardTitle>
          </div>
          {!isInDrillDown && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: 'var(--chart-heat-5)' }}
                />
                ≥80%
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: 'var(--chart-heat-3)' }}
                />
                50-79%
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: 'var(--chart-heat-1)' }}
                />
                &lt;50%
              </span>
            </div>
          )}
        </div>
        {!isInDrillDown && (
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-xs text-muted-foreground">
              {remainingHostnames.size > 0
                ? (MAX_VISIBLE_HOSTS + remainingHostnames.size)
                : (treemapData.children?.length || 0)} hosts • {effectiveTestCount} unique tests
              {canonicalTestCount
                ? baselineMode === '90d' ? ' (90d baseline)'
                  : baselineMode === '30d' ? ' (30d baseline)'
                  : ' (current window)'
                : ''}
              {' '}• Click host to drill down
            </p>
            {canonicalTestCount && canonicalTestCount > 0 && (
              <div className="flex items-center border border-border rounded-md overflow-hidden flex-shrink-0">
                <button
                  onClick={() => setBaselineMode('90d')}
                  className={`px-2 py-0.5 text-xs transition-colors ${
                    baselineMode === '90d'
                      ? 'bg-secondary text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  90d
                </button>
                <button
                  onClick={() => setBaselineMode('30d')}
                  className={`px-2 py-0.5 text-xs transition-colors border-l border-border ${
                    baselineMode === '30d'
                      ? 'bg-secondary text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  30d
                </button>
                <button
                  onClick={() => setBaselineMode('window')}
                  className={`px-2 py-0.5 text-xs transition-colors border-l border-border ${
                    baselineMode === 'window'
                      ? 'bg-secondary text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Window
                </button>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 pb-4 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={currentData.children}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="var(--background)"
            onClick={isSingleHostDrillDown ? undefined : (node) => {
              if (node && node.name) {
                handleCellClick({ name: node.name });
              }
            }}
            content={
              <CustomTreemapContent
                isClickable={!isSingleHostDrillDown}
                hideCoverageStats={isSingleHostDrillDown}
                labelOnLight={heatTokens['--chart-label-on-light']}
                labelOnDark={heatTokens['--chart-label-on-dark']}
              />
            }
          >
            <Tooltip content={isSingleHostDrillDown
              ? <DrillDownTooltip />
              : isOthersDrillDown
                ? <OthersDrillDownTooltip />
                : <CustomTooltip baselineLabel={
                    canonicalTestCount
                      ? baselineMode === '90d' ? '90d baseline'
                        : baselineMode === '30d' ? '30d baseline'
                        : 'current window'
                      : undefined
                  } />
            } />
          </Treemap>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default memo(CoverageTreemap);
