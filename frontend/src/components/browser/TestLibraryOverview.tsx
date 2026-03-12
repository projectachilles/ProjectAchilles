import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, PieChart, Pie } from 'recharts';
import { Crosshair, Layers, FolderTree, Star, Shield, Cpu, FileSearch, Workflow, ShieldCheck } from 'lucide-react';
import type { TestMetadata } from '@/types/test';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import MetricCard from '@/pages/analytics/components/MetricCard';
import { Badge } from '@/components/shared/ui/Badge';
import { formatRelativeDate } from '@/utils/dateFormatters';

// Reuse oklch palette from analytics charts
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'oklch(0.63 0.24 25)',
  high: 'oklch(0.70 0.19 50)',
  medium: 'oklch(0.80 0.18 85)',
  low: 'oklch(0.72 0.19 145)',
  info: 'oklch(0.55 0.01 250)',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const CATEGORY_COLORS: Record<string, string> = {
  'intel-driven': 'oklch(0.62 0.19 250)',
  'mitre-top10': 'oklch(0.55 0.22 290)',
  'cyber-hygiene': 'oklch(0.70 0.15 180)',
  'phase-aligned': 'oklch(0.55 0.22 270)',
};

const SEVERITY_BADGE_VARIANT: Record<string, 'destructive' | 'warning' | 'default' | 'success'> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'warning',
  low: 'success',
};

interface TestLibraryOverviewProps {
  tests: TestMetadata[];
  onDrillToSeverity: (severity: string) => void;
  onDrillToCategory: (category: string) => void;
  onDrillToTechnique: (technique: string) => void;
  onNavigateToTest: (uuid: string) => void;
}

export default function TestLibraryOverview({
  tests,
  onDrillToSeverity,
  onDrillToCategory,
  onDrillToTechnique,
  onNavigateToTest,
}: TestLibraryOverviewProps) {
  const stats = useMemo(() => {
    const allTechniques = tests.flatMap(t => t.techniques);
    const uniqueTechniques = new Set(allTechniques);
    const categories = new Set(tests.map(t => t.category).filter(Boolean));
    const scores = tests.map(t => t.score).filter((s): s is number => s != null && s > 0);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    // Severity distribution
    const severityCounts: Record<string, number> = {};
    for (const t of tests) {
      const sev = (t.severity || 'info').toLowerCase();
      severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    }
    const severityData = SEVERITY_ORDER
      .filter(s => severityCounts[s])
      .map(s => ({ name: s, count: severityCounts[s], fill: SEVERITY_COLORS[s] || SEVERITY_COLORS.info }));

    // Category distribution
    const categoryCounts: Record<string, number> = {};
    for (const t of tests) {
      const cat = t.category || 'uncategorized';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    const categoryData = Object.entries(categoryCounts).map(([name, count]) => ({
      name,
      count,
      fill: CATEGORY_COLORS[name] || 'oklch(0.55 0.10 250)',
    }));

    // Top rated
    const topRated = [...tests]
      .filter(t => t.score != null && t.score > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);

    // Recently modified
    const recentlyModified = [...tests]
      .filter(t => t.lastModifiedDate)
      .sort((a, b) => new Date(b.lastModifiedDate!).getTime() - new Date(a.lastModifiedDate!).getTime())
      .slice(0, 5);

    // Top 15 techniques
    const techCounts: Record<string, number> = {};
    for (const tech of allTechniques) {
      techCounts[tech] = (techCounts[tech] || 0) + 1;
    }
    const topTechniques = Object.entries(techCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count, fill: 'oklch(0.62 0.19 250)' }));

    // Platform distribution
    const platformSet = new Set<string>();
    for (const t of tests) {
      if (t.target) t.target.forEach(p => platformSet.add(p));
    }

    // Tactic count
    const allTactics = tests.flatMap(t => t.tactics || []);
    const uniqueTactics = new Set(allTactics);

    // Severity summary for subtitle
    const critHighCount = (severityCounts['critical'] || 0) + (severityCounts['high'] || 0);

    // Feature counts
    const multiStageCount = tests.filter(t => t.isMultiStage).length;
    const withDetection = tests.filter(t => t.hasDetectionFiles).length;
    const withAttackFlow = tests.filter(t => t.hasAttackFlow).length;
    const withKillChain = tests.filter(t => t.hasKillChain).length;
    const withDefenseGuidance = tests.filter(t => t.hasDefenseGuidance).length;

    return {
      totalTests: tests.length,
      uniqueTechniqueCount: uniqueTechniques.size,
      uniqueTacticCount: uniqueTactics.size,
      categoryCount: categories.size,
      categoryNames: [...categories] as string[],
      critHighCount,
      avgScore,
      severityData,
      categoryData,
      topRated,
      recentlyModified,
      topTechniques,
      platforms: [...platformSet],
      multiStageCount,
      withDetection,
      withAttackFlow,
      withKillChain,
      withDefenseGuidance,
    };
  }, [tests]);

  if (tests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
        <FolderTree className="w-10 h-10 opacity-30" />
        <p>No tests in library. Sync your test repository to get started.</p>
      </div>
    );
  }

  // Chart configs
  const severityChartConfig: ChartConfig = {};
  for (const d of stats.severityData) {
    severityChartConfig[d.name] = { label: d.name.charAt(0).toUpperCase() + d.name.slice(1), color: d.fill };
  }

  const categoryChartConfig: ChartConfig = {};
  for (const d of stats.categoryData) {
    categoryChartConfig[d.name] = { label: d.name, color: d.fill };
  }

  const techniqueChartConfig: ChartConfig = {
    count: { label: 'Tests', color: 'oklch(0.62 0.19 250)' },
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Row 1: Metric cards */}
      <div className="col-span-3">
        <MetricCard
          title="Total Tests"
          value={stats.totalTests}
          icon={Shield}
          subtitle={stats.critHighCount > 0 ? `${stats.critHighCount} critical/high severity` : undefined}
        />
      </div>
      <div className="col-span-3">
        <MetricCard
          title="MITRE Techniques"
          value={stats.uniqueTechniqueCount}
          icon={Crosshair}
          subtitle={`across ${stats.uniqueTacticCount} tactics`}
        />
      </div>
      <div className="col-span-3">
        <MetricCard
          title="Categories"
          value={stats.categoryCount}
          icon={FolderTree}
          subtitle={stats.categoryNames.join(', ')}
        />
      </div>
      <div className="col-span-3">
        <MetricCard
          title="Avg Score"
          value={stats.avgScore}
          icon={Star}
          format="number"
          subtitle={`across ${tests.filter(t => t.score && t.score > 0).length} scored tests`}
        />
      </div>

      {/* Row 2-3: Severity bar chart + Category donut */}
      <div className="col-span-6 row-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Severity Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={severityChartConfig} className="w-full" style={{ height: 220 }}>
              <BarChart data={stats.severityData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 12, textTransform: 'capitalize' } as object} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(data) => { if (data?.name) onDrillToSeverity(data.name); }}
                >
                  {stats.severityData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="col-span-6 row-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={categoryChartConfig} className="w-full" style={{ height: 190 }}>
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={stats.categoryData}
                  dataKey="count"
                  nameKey="name"
                  innerRadius="45%"
                  outerRadius="80%"
                  paddingAngle={2}
                  cursor="pointer"
                  onClick={(data) => { if (data?.name) onDrillToCategory(data.name); }}
                >
                  {stats.categoryData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
              {stats.categoryData.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => onDrillToCategory(entry.name)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: entry.fill }} />
                  {entry.name} ({entry.count})
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4-5: Top Rated + Recently Modified */}
      <div className="col-span-6 row-span-2">
        <Card className="h-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Top Rated</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {stats.topRated.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scored tests yet</p>
            ) : (
              <div className="space-y-1">
                {stats.topRated.map((test) => (
                  <button
                    key={test.uuid}
                    onClick={() => onNavigateToTest(test.uuid)}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-base hover:bg-accent/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm truncate">{test.name}</span>
                      {test.severity && (
                        <Badge variant={SEVERITY_BADGE_VARIANT[test.severity] || 'default'} className="shrink-0 text-[10px] px-1.5 py-0.5">
                          {test.severity}
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm font-medium text-amber-500 tabular-nums shrink-0 ml-2">
                      {test.score?.toFixed(1)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="col-span-6 row-span-2">
        <Card className="h-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Recently Modified</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {stats.recentlyModified.length === 0 ? (
              <p className="text-sm text-muted-foreground">No modification history available</p>
            ) : (
              <div className="space-y-1">
                {stats.recentlyModified.map((test) => (
                  <button
                    key={test.uuid}
                    onClick={() => onNavigateToTest(test.uuid)}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-base hover:bg-accent/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm truncate">{test.name}</span>
                      {test.severity && (
                        <Badge variant={SEVERITY_BADGE_VARIANT[test.severity] || 'default'} className="shrink-0 text-[10px] px-1.5 py-0.5">
                          {test.severity}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {formatRelativeDate(test.lastModifiedDate!)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 6-7: Technique Coverage */}
      <div className="col-span-12 row-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Technique Coverage (Top 15)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={techniqueChartConfig} className="w-full" style={{ height: 320 }}>
              <BarChart data={stats.topTechniques} layout="vertical" margin={{ left: 20, right: 20 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(data) => { if (data?.name) onDrillToTechnique(data.name); }}
                >
                  {stats.topTechniques.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 8: Summary badges */}
      <div className="col-span-12">
        <Card>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-3">
              {stats.platforms.length > 0 && (
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Platforms:</span>
                  {stats.platforms.map(p => (
                    <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                  ))}
                </div>
              )}
              {stats.multiStageCount > 0 && (
                <Badge variant="primary">
                  <Layers className="w-3 h-3 mr-1" />
                  {stats.multiStageCount} multi-stage
                </Badge>
              )}
              {stats.withDetection > 0 && (
                <Badge variant="primary">
                  <FileSearch className="w-3 h-3 mr-1" />
                  {stats.withDetection} with detection rules
                </Badge>
              )}
              {stats.withAttackFlow > 0 && (
                <Badge variant="primary">
                  <Workflow className="w-3 h-3 mr-1" />
                  {stats.withAttackFlow} attack flows
                </Badge>
              )}
              {stats.withKillChain > 0 && (
                <Badge variant="primary">
                  <Workflow className="w-3 h-3 mr-1" />
                  {stats.withKillChain} kill chains
                </Badge>
              )}
              {stats.withDefenseGuidance > 0 && (
                <Badge variant="primary">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  {stats.withDefenseGuidance} defense guidance
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
