import { useMemo } from 'react';
import type { TestMetadata } from '@/types/test';
import { useTheme } from '@/hooks/useTheme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/shared/ui/Badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Grid3X3 } from 'lucide-react';

// ── MITRE ATT&CK Enterprise Tactics (kill-chain order) ──────────────

interface MitreTactic {
  slug: string;       // kebab-case matching test data
  id: string;         // TA00xx
  name: string;       // Full name
  shortName: string;  // Abbreviated for narrow columns
}

const ENTERPRISE_TACTICS: MitreTactic[] = [
  { slug: 'reconnaissance',       id: 'TA0043', name: 'Reconnaissance',        shortName: 'Recon' },
  { slug: 'resource-development',  id: 'TA0042', name: 'Resource Development',  shortName: 'Res. Dev.' },
  { slug: 'initial-access',       id: 'TA0001', name: 'Initial Access',        shortName: 'Init. Access' },
  { slug: 'execution',            id: 'TA0002', name: 'Execution',             shortName: 'Execution' },
  { slug: 'persistence',          id: 'TA0003', name: 'Persistence',           shortName: 'Persistence' },
  { slug: 'privilege-escalation', id: 'TA0004', name: 'Privilege Escalation',  shortName: 'Priv. Esc.' },
  { slug: 'defense-evasion',      id: 'TA0005', name: 'Defense Evasion',       shortName: 'Def. Evasion' },
  { slug: 'credential-access',    id: 'TA0006', name: 'Credential Access',     shortName: 'Cred. Access' },
  { slug: 'discovery',            id: 'TA0007', name: 'Discovery',             shortName: 'Discovery' },
  { slug: 'lateral-movement',     id: 'TA0008', name: 'Lateral Movement',      shortName: 'Lat. Movement' },
  { slug: 'collection',           id: 'TA0009', name: 'Collection',            shortName: 'Collection' },
  { slug: 'command-and-control',  id: 'TA0011', name: 'Command and Control',   shortName: 'C2' },
  { slug: 'exfiltration',         id: 'TA0010', name: 'Exfiltration',          shortName: 'Exfiltration' },
  { slug: 'impact',               id: 'TA0040', name: 'Impact',                shortName: 'Impact' },
];

// ── Types ────────────────────────────────────────────────────────────

interface TechniqueCell {
  techniqueId: string;
  count: number;
  testNames: string[];
}

interface MitreAttackMatrixProps {
  tests: TestMetadata[];
  onDrillToTechnique: (technique: string) => void;
}

// ── Component ────────────────────────────────────────────────────────

export default function MitreAttackMatrix({ tests, onDrillToTechnique }: MitreAttackMatrixProps) {
  const { theme, themeStyle } = useTheme();
  const isDark = theme === 'dark' || themeStyle === 'hackerterminal';
  const isHacker = themeStyle === 'hackerterminal';

  // Build tactic → technique[] map from test data
  const { tacticMap, maxCount, stats } = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; testNames: string[] }>>();
    let max = 0;
    const mappedTestIds = new Set<string>();
    const allTechniqueIds = new Set<string>();

    // Initialize all tactics with empty maps
    for (const tactic of ENTERPRISE_TACTICS) {
      map.set(tactic.slug, new Map());
    }

    for (const test of tests) {
      const tactics = test.tactics;
      const techniques = test.techniques;
      if (!tactics?.length || !techniques?.length) continue;

      mappedTestIds.add(test.uuid);

      for (const tactic of tactics) {
        const slug = tactic.toLowerCase();
        const techMap = map.get(slug);
        if (!techMap) continue; // unknown tactic, skip

        for (const tech of techniques) {
          allTechniqueIds.add(tech);
          const existing = techMap.get(tech);
          if (existing) {
            existing.count++;
            if (existing.testNames.length < 5) {
              existing.testNames.push(test.name);
            }
          } else {
            techMap.set(tech, { count: 1, testNames: [test.name] });
          }
          if ((existing?.count ?? 1) > max) max = existing?.count ?? 1;
        }
      }
    }

    // Convert to sorted TechniqueCell[] per tactic
    const result = new Map<string, TechniqueCell[]>();
    for (const [slug, techMap] of map) {
      const cells: TechniqueCell[] = [];
      for (const [techniqueId, data] of techMap) {
        cells.push({ techniqueId, count: data.count, testNames: data.testNames });
      }
      cells.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId));
      result.set(slug, cells);
    }

    const coveredTactics = ENTERPRISE_TACTICS.filter(t => (result.get(t.slug)?.length ?? 0) > 0).length;

    return {
      tacticMap: result,
      maxCount: max,
      stats: {
        techniqueCount: allTechniqueIds.size,
        tacticCount: coveredTactics,
        testCount: mappedTestIds.size,
      },
    };
  }, [tests]);

  // ── Color ramp ─────────────────────────────────────────────────────

  function getIntensityColor(count: number): string {
    if (count === 0) return 'transparent';
    const intensity = maxCount > 0 ? count / maxCount : 0;

    if (isHacker) {
      // Green phosphor shades
      if (intensity > 0.75) return 'oklch(0.70 0.22 142)';
      if (intensity > 0.5)  return 'oklch(0.58 0.18 142)';
      if (intensity > 0.25) return 'oklch(0.45 0.14 142)';
      return 'oklch(0.35 0.10 142)';
    }

    if (isDark) {
      if (intensity > 0.75) return 'oklch(0.65 0.20 145)';
      if (intensity > 0.5)  return 'oklch(0.52 0.16 145)';
      if (intensity > 0.25) return 'oklch(0.42 0.13 145)';
      return 'oklch(0.32 0.10 145)';
    }

    // Light mode
    if (intensity > 0.75) return 'oklch(0.55 0.18 145)';
    if (intensity > 0.5)  return 'oklch(0.65 0.15 145)';
    if (intensity > 0.25) return 'oklch(0.75 0.12 145)';
    return 'oklch(0.85 0.10 145)';
  }

  function getTextColor(count: number): string {
    if (count === 0) return '';
    const intensity = maxCount > 0 ? count / maxCount : 0;

    if (isHacker) return 'oklch(0.15 0.02 142)';
    if (isDark) return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.90 0 0)';
    return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.20 0.02 145)';
  }

  // ── Empty state ────────────────────────────────────────────────────

  if (stats.testCount === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Grid3X3 className="w-10 h-10 opacity-30" />
          <p className="text-sm">No tests have MITRE ATT&CK tactic data yet.</p>
          <p className="text-xs opacity-60">
            Add <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">TACTICS:</code> to test headers to map tests to the ATT&CK matrix.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Legend color steps ─────────────────────────────────────────────

  const legendSteps = [0.1, 0.25, 0.5, 0.75, 1].map(frac => ({
    color: getIntensityColor(Math.max(1, Math.ceil(maxCount * frac))),
  }));

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 flex-wrap">
          <span>MITRE ATT&CK Coverage</span>
          <div className="flex items-center gap-2">
            <Badge variant="success">{stats.techniqueCount} techniques</Badge>
            <Badge variant="primary">{stats.tacticCount}/14 tactics</Badge>
            <Badge variant="default">{stats.testCount} tests mapped</Badge>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Scrollable matrix */}
        <div className="overflow-x-auto pb-2">
          <div className="inline-flex gap-1" style={{ minWidth: 1400 }}>
            {ENTERPRISE_TACTICS.map(tactic => {
              const cells = tacticMap.get(tactic.slug) ?? [];
              const isEmpty = cells.length === 0;

              return (
                <div
                  key={tactic.slug}
                  className="flex flex-col flex-1 min-w-[95px]"
                >
                  {/* Column header */}
                  <div
                    className={`sticky top-0 z-10 px-1.5 py-2 text-center border-b border-border bg-card ${
                      isEmpty ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="text-[11px] font-semibold leading-tight truncate" title={tactic.name}>
                      {tactic.shortName}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">{tactic.id}</div>
                    {!isEmpty && (
                      <div className="mt-1">
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                          {cells.length}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Technique cells */}
                  <div className="flex flex-col gap-0.5 pt-1">
                    {isEmpty ? (
                      <div className="px-1 py-3 text-center text-[10px] text-muted-foreground opacity-40 italic">
                        No coverage
                      </div>
                    ) : (
                      cells.map(cell => (
                        <Tooltip key={cell.techniqueId}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onDrillToTechnique(cell.techniqueId)}
                              className="w-full px-1.5 py-1 rounded-sm text-left transition-opacity hover:opacity-80 active:opacity-60 cursor-pointer"
                              style={{
                                backgroundColor: getIntensityColor(cell.count),
                                color: getTextColor(cell.count),
                              }}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[10px] leading-tight truncate">
                                  {cell.techniqueId}
                                </span>
                                <span className="text-[10px] font-semibold shrink-0">
                                  {cell.count}
                                </span>
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={4}>
                            <div className="space-y-1 max-w-[220px]">
                              <div className="font-mono font-semibold">{cell.techniqueId}</div>
                              <div className="text-[11px] opacity-80">
                                {cell.count} {cell.count === 1 ? 'test' : 'tests'}
                              </div>
                              <div className="text-[10px] opacity-60 space-y-0.5">
                                {cell.testNames.map((name, i) => (
                                  <div key={i} className="truncate">{name}</div>
                                ))}
                                {cell.count > 5 && (
                                  <div className="italic">+{cell.count - 5} more</div>
                                )}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-4 text-[10px] text-muted-foreground">
          <span>Low</span>
          <div className="flex">
            {legendSteps.map((step, i) => (
              <div
                key={i}
                className="w-5 h-4 border border-border/30"
                style={{ backgroundColor: step.color }}
              />
            ))}
          </div>
          <span>High ({maxCount})</span>
        </div>
      </CardContent>
    </Card>
  );
}
