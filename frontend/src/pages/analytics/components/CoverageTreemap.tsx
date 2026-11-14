import { useState, useMemo, useCallback, memo } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { HostTestMatrixCell } from '../../../services/api/analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChartTokens } from '@/lib/chartTokens';
import { pickAccessibleLabel } from '@/lib/contrast';
import { plural } from '../report/lib/format';
import { buildBreadthModel, breadthStep, breadthWord, type BreadthHost, type BreadthStep } from './testBreadth';

interface CoverageTreemapProps {
  data: HostTestMatrixCell[];
  loading?: boolean;
  title?: string;
  /** Names of the tests run in the last 90 days: the default test set. */
  baselineTests90d?: string[];
  /** Names of the tests run in the last 30 days. */
  baselineTests30d?: string[];
  /**
   * Hostnames of the active enrolled agents, already narrowed by the org and hostname filters.
   * null when the agent list could not be read: the card then shows tested hosts only.
   */
  enrolledHostnames?: string[] | null;
  /** A filter other than date/org is active, so a hollow tile is "no matching result". */
  filtered?: boolean;
}

type BaselineMode = '90d' | '30d' | 'window';

/** One tile. Every tile has the same size: the card shows breadth, not run volume. */
interface TileNode {
  name: string;
  /** Second line of the tile. */
  label: string;
  /** 0 = hollow (not tested / not run), 1..4 = the breadth ramp. */
  step: BreadthStep;
  fill?: string;
  /** A fold of several hosts or tests: neutral surface, not a breadth shade. */
  fold?: boolean;
  host?: BreadthHost;
  foldTested?: number;
  foldUntested?: number;
  runs?: number;
}

const MAX_VISIBLE_HOSTS = 25;
const MAX_VISIBLE_TESTS = 25;
const OTHERS = '__others__';

const BREADTH_TOKENS = ['--chart-breadth-1', '--chart-breadth-2', '--chart-breadth-3', '--chart-breadth-4'] as const;
const LEGEND: { step: BreadthStep; label: string }[] = [
  { step: 1, label: '<25%' },
  { step: 2, label: '25-49%' },
  { step: 3, label: '50-79%' },
  { step: 4, label: '≥80%' },
];

const num = (n: number) => n.toLocaleString('en-US');
const pct = (breadth: number) => `${Math.round(breadth * 100)}%`;
const isFoldName = (name: string | undefined) => !!name?.startsWith('Others (');

interface TileProps {
  node: TileNode;
  onClick?: () => void;
  labelOnLight: string;
  labelOnDark: string;
  children: React.ReactNode;
}

/** One equal tile: a button (keyboard reachable) whose tooltip opens on hover and focus. */
function Tile({ node, onClick, labelOnLight, labelOnDark, children }: TileProps) {
  const hollow = node.step === 0 && !node.fold;
  // A filled tile picks its label by computed contrast against its own fill (see contrast.ts);
  // hollow and fold tiles sit on the card surface, so they use the theme's text colours.
  const style = hollow || node.fold
    ? undefined
    : { backgroundColor: node.fill, color: pickAccessibleLabel(node.fill ?? '', [labelOnDark, labelOnLight]) };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="tile"
          data-name={node.name}
          data-step={node.step}
          onClick={onClick}
          style={style}
          className={`h-[72px] min-w-0 rounded-md px-2.5 pb-2 flex flex-col justify-end text-left transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
            onClick ? 'cursor-pointer' : 'cursor-default'
          } ${
            hollow
              ? 'border border-dashed border-border-strong text-muted-foreground'
              : node.fold ? 'bg-secondary text-foreground' : ''
          }`}
        >
          <span className="block truncate text-[13px] font-medium leading-tight">{node.name}</span>
          <span className="block truncate text-[11px] leading-tight mt-0.5">{node.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="p-3 max-w-xs text-left text-wrap">{children}</TooltipContent>
    </Tooltip>
  );
}

/** A swatch in the tile's own shade; dashed outline for "not tested". */
function StepSwatch({ step, className = 'w-3 h-3' }: { step: BreadthStep; className?: string }) {
  return step === 0 ? (
    <span className={`inline-block rounded border border-dashed border-border-strong ${className}`} />
  ) : (
    <span className={`inline-block rounded ${className}`} style={{ backgroundColor: `var(--chart-breadth-${step})` }} />
  );
}

interface BreadthTooltipProps {
  tile: Pick<TileNode, 'name' | 'host' | 'foldTested' | 'foldUntested'>;
  /** Size of the test set the hosts are measured against. */
  setSize: number;
  baselineLabel?: string;
  filtered?: boolean;
}

/** Tooltip body of a host tile (overview and the Others view) and of the Others fold. */
export function BreadthTooltip({ tile, setSize, baselineLabel, filtered }: BreadthTooltipProps) {
  if (!tile.host) {
    return (
      <>
        <p className="text-sm font-semibold text-foreground mb-1">{tile.name}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{tile.foldTested ?? 0}</span> tested,{' '}
          <span className="font-medium text-foreground">{tile.foldUntested ?? 0}</span> not tested
        </p>
        <p className="text-xs text-muted-foreground mt-2 italic">Click to expand</p>
      </>
    );
  }

  const { host } = tile;
  return (
    <>
      <p className="text-sm font-semibold text-foreground mb-1">{host.hostname}</p>
      <div className="space-y-1 text-sm text-muted-foreground">
        {!host.tested && (
          <p className="font-medium text-foreground">
            {filtered ? 'No result matches the current filters' : 'Not tested in this window'}
          </p>
        )}
        <p>
          <span className="font-medium text-foreground">{host.ranCount} of {setSize}</span>{' '}
          {setSize === 1 ? 'test' : 'tests'} run
        </p>
        {host.tested && (
          <>
            <p>
              <span className="font-medium text-foreground">{plural(host.totalRuns, 'run')}</span> in this window
            </p>
            <p>
              Breadth:{' '}
              <span className="font-medium text-foreground">
                <StepSwatch step={breadthStep(host)} className="w-2 h-2 mr-1 align-middle" />
                {pct(host.breadth)} ({breadthWord(host.breadth)})
              </span>
              {baselineLabel && <span className="text-xs text-muted-foreground"> — {baselineLabel}</span>}
            </p>
          </>
        )}
        {host.missing.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Missing {plural(host.missing.length, 'test')}:</p>
            <ul className="text-xs text-foreground space-y-0.5">
              {host.missing.slice(0, 5).map((test) => (
                <li key={test}>• {test}</li>
              ))}
            </ul>
            {host.missing.length > 5 && (
              <p className="text-xs text-muted-foreground mt-0.5">and {host.missing.length - 5} more</p>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2 italic">Click to see its tests</p>
    </>
  );
}

/** Tooltip body of a test tile inside one host. */
function TestTooltip({ tile }: { tile: TileNode }) {
  return (
    <>
      <p className="text-sm font-semibold text-foreground">{tile.name}</p>
      <p className="text-sm text-muted-foreground">
        {tile.fold
          ? `${plural(tile.runs ?? 0, 'run')} across these tests`
          : tile.runs
            ? `${plural(tile.runs, 'run')} on this host in this window`
            : 'Not run on this host in this window'}
      </p>
    </>
  );
}

function CoverageTreemap({
  data,
  loading,
  title = 'Test Breadth by Host',
  baselineTests90d,
  baselineTests30d,
  enrolledHostnames = null,
  filtered = false,
}: CoverageTreemapProps) {
  // Resolved ramp + label tokens: a concrete colour is needed to pick a readable label per tile.
  const tokens = useChartTokens([...BREADTH_TOKENS, '--chart-label-on-light', '--chart-label-on-dark']);

  // Drill-down state: null = overview, OTHERS = the folded hosts, else a hostname
  const [drillDownHost, setDrillDownHost] = useState<string | null>(null);
  // Track whether we navigated to a host from the "Others" view (for back-navigation)
  const [cameFromOthers, setCameFromOthers] = useState(false);
  const [baselineMode, setBaselineMode] = useState<BaselineMode>('90d');

  const has90d = !!baselineTests90d && baselineTests90d.length > 0;
  const has30d = !!baselineTests30d && baselineTests30d.length > 0;
  // A baseline that is not loaded (or empty) falls back to the window's own tests.
  const effectiveMode: BaselineMode =
    baselineMode === '90d' && has90d ? '90d' : baselineMode === '30d' && has30d ? '30d' : 'window';
  const baselineLabel =
    effectiveMode === '90d' ? '90d baseline' : effectiveMode === '30d' ? '30d baseline' : 'current window';

  const model = useMemo(
    () =>
      buildBreadthModel(
        data ?? [],
        effectiveMode === '90d' ? baselineTests90d! : effectiveMode === '30d' ? baselineTests30d! : null,
        enrolledHostnames,
      ),
    [data, effectiveMode, baselineTests90d, baselineTests30d, enrolledHostnames],
  );

  const hostTile = useCallback(
    (host: BreadthHost): TileNode => {
      const step = breadthStep(host);
      return {
        name: host.hostname,
        label: host.tested
          ? `${pct(host.breadth)} · ${host.ranCount} of ${model.tests.length}`
          : filtered ? 'no matching result' : 'not tested',
        step,
        fill: step === 0 ? undefined : tokens[BREADTH_TOKENS[step - 1]],
        host,
      };
    },
    [model.tests.length, filtered, tokens],
  );

  // The model is ordered worst first, so the fold hides the best-tested hosts, never the gaps.
  const { overviewTiles, foldedHosts } = useMemo(() => {
    if (model.hosts.length <= MAX_VISIBLE_HOSTS) {
      return { overviewTiles: model.hosts.map(hostTile), foldedHosts: [] as BreadthHost[] };
    }
    const folded = model.hosts.slice(MAX_VISIBLE_HOSTS);
    const foldTested = folded.filter((h) => h.tested).length;
    const others: TileNode = {
      name: `Others (${plural(folded.length, 'host')})`,
      label: `${plural(folded.length, 'host')} ⋯`,
      step: 0,
      fold: true,
      foldTested,
      foldUntested: folded.length - foldTested,
    };
    return { overviewTiles: [...model.hosts.slice(0, MAX_VISIBLE_HOSTS).map(hostTile), others], foldedHosts: folded };
  }, [model.hosts, hostTile]);

  const selectedHost = useMemo(
    () => (drillDownHost && drillDownHost !== OTHERS ? model.hosts.find((h) => h.hostname === drillDownHost) : undefined),
    [drillDownHost, model.hosts],
  );

  // One tile per test of the set: the ones this host did not run first, hollow.
  const testTiles = useMemo(() => {
    if (!selectedHost) return null;
    const all: TileNode[] = [
      ...selectedHost.missing.map((name): TileNode => ({ name, label: 'not run', step: 0 })),
      ...model.tests
        .filter((name) => selectedHost.runsByTest.has(name))
        .map((name): TileNode => {
          const runs = selectedHost.runsByTest.get(name) ?? 0;
          return { name, label: plural(runs, 'run'), step: 4, fill: tokens[BREADTH_TOKENS[3]], runs };
        }),
    ];
    if (all.length <= MAX_VISIBLE_TESTS) return all;
    const rest = all.slice(MAX_VISIBLE_TESTS);
    return [
      ...all.slice(0, MAX_VISIBLE_TESTS),
      {
        name: `Others (${plural(rest.length, 'test')})`,
        label: `${plural(rest.length, 'test')} ⋯`,
        step: 0 as const,
        fold: true,
        runs: rest.reduce((sum, t) => sum + (t.runs ?? 0), 0),
      },
    ];
  }, [selectedHost, model.tests, tokens]);

  const handleCellClick = useCallback((name: string) => {
    if (!drillDownHost) {
      // Overview: click host → drill down, click "Others" → expand
      setDrillDownHost(isFoldName(name) ? OTHERS : name);
    } else if (drillDownHost === OTHERS) {
      // "Others" view: click a host → drill into its tests
      setDrillDownHost(name);
      setCameFromOthers(true);
    }
  }, [drillDownHost]);

  const handleBackClick = useCallback(() => {
    if (cameFromOthers) {
      // Go back to the "Others" view, not all the way to overview
      setDrillDownHost(OTHERS);
      setCameFromOthers(false);
    } else {
      setDrillDownHost(null);
    }
  }, [cameFromOthers]);

  // Loading state
  if (loading) {
    return (
      <Card className="h-full min-h-[280px] flex flex-col overflow-hidden">
        <CardHeader className="pb-2 flex-shrink-0 gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </CardHeader>
        <CardContent className="flex-1 pb-4 min-h-0" aria-busy="true">
          <div className="grid grid-cols-3 gap-1.5 h-full">
            <Skeleton className="col-span-2 row-span-2 h-full w-full" />
            <Skeleton className="h-full w-full" />
            <Skeleton className="h-full w-full" />
            <Skeleton className="col-span-3 h-full w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (model.hosts.length === 0) {
    return (
      <Card className="h-full min-h-[280px] flex items-center justify-center">
        <p className="text-muted-foreground">No test results or enrolled hosts for this view</p>
      </Card>
    );
  }

  // A host or fold that the current data no longer has falls back to the overview.
  const isOthersView = drillDownHost === OTHERS && foldedHosts.length > 0;
  const isHostView = !!selectedHost && !!testTiles;
  const isOverview = !isOthersView && !isHostView;
  const tiles = isHostView ? testTiles : isOthersView ? foldedHosts.map(hostTile) : overviewTiles;

  const hostsSummary =
    enrolledHostnames === null
      ? `${plural(model.testedCount, 'host')} tested · enrolled hosts unavailable`
      : `${plural(model.hosts.length, 'host')} · ${num(model.testedCount)} tested · ${num(model.untestedCount)} not tested`;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {!isOverview && (
              <button
                onClick={handleBackClick}
                className="p-1 hover:bg-secondary rounded transition-colors"
                title="Back to overview"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <CardTitle className="text-sm font-medium">
              {isHostView
                ? `${selectedHost.hostname} · ${selectedHost.ranCount} of ${model.tests.length} ${model.tests.length === 1 ? 'test' : 'tests'}`
                : isOthersView
                  ? `Other Hosts (${foldedHosts.length})`
                  : title}
            </CardTitle>
          </div>
          {!isHostView && (
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-muted-foreground">
              <span>Share of tests run:</span>
              {LEGEND.map(({ step, label }) => (
                <span key={step} className="flex items-center gap-1">
                  <StepSwatch step={step} />
                  {label}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <StepSwatch step={0} />
                {filtered ? 'no matching result' : 'not tested'}
              </span>
            </div>
          )}
        </div>
        {isOverview && (
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-xs text-muted-foreground">
              {hostsSummary} · {plural(model.tests.length, 'test')} ({baselineLabel}) · Click a host to see its tests
            </p>
            {has90d && (
              <div className="flex items-center border border-border rounded-md overflow-hidden flex-shrink-0">
                {(['90d', '30d', 'window'] as const).map((mode, i) => (
                  <button
                    key={mode}
                    onClick={() => setBaselineMode(mode)}
                    className={`px-2 py-0.5 text-xs transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                      baselineMode === mode
                        ? 'bg-secondary text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                    }`}
                  >
                    {mode === 'window' ? 'Window' : mode}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardHeader>
      {/* A plain grid, not a treemap: equal tiles of one shape, so neither area nor shape
          carries meaning, and a small fleet does not stretch into a few huge cells. */}
      <CardContent className="flex-1 pb-4">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {tiles.map((node) => (
            <Tile
              key={node.name}
              node={node}
              onClick={isHostView ? undefined : () => handleCellClick(node.name)}
              labelOnLight={tokens['--chart-label-on-light']}
              labelOnDark={tokens['--chart-label-on-dark']}
            >
              {isHostView
                ? <TestTooltip tile={node} />
                : <BreadthTooltip tile={node} setSize={model.tests.length} baselineLabel={baselineLabel} filtered={filtered} />}
            </Tile>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(CoverageTreemap);
