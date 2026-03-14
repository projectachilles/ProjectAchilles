import { useMemo, useState } from 'react';
import type { TestMetadata } from '@/types/test';
import { useTheme } from '@/hooks/useTheme';
import { Badge } from '@/components/shared/ui/Badge';
import { Switch } from '@/components/shared/ui/Switch';
import { Grid3X3 } from 'lucide-react';
import { TECHNIQUE_NAMES } from '@/data/mitre-techniques';

// ── MITRE ATT&CK Enterprise Tactics (kill-chain order) ──────────────

interface MitreTactic {
  slug: string;       // kebab-case matching test data
  id: string;         // TA00xx
  name: string;       // Full name
  shortName: string;  // Abbreviated for narrow columns
  barLabel: string;   // 2-letter bar axis label
}

const ENTERPRISE_TACTICS: MitreTactic[] = [
  { slug: 'reconnaissance',       id: 'TA0043', name: 'Reconnaissance',        shortName: 'Recon',        barLabel: 'RE' },
  { slug: 'resource-development', id: 'TA0042', name: 'Resource Development',  shortName: 'Res. Dev.',    barLabel: 'RD' },
  { slug: 'initial-access',       id: 'TA0001', name: 'Initial Access',        shortName: 'Init. Access', barLabel: 'IA' },
  { slug: 'execution',            id: 'TA0002', name: 'Execution',             shortName: 'Execution',    barLabel: 'EX' },
  { slug: 'persistence',          id: 'TA0003', name: 'Persistence',           shortName: 'Persistence',  barLabel: 'PE' },
  { slug: 'privilege-escalation', id: 'TA0004', name: 'Privilege Escalation',  shortName: 'Priv. Esc.',   barLabel: 'PR' },
  { slug: 'defense-evasion',      id: 'TA0005', name: 'Defense Evasion',       shortName: 'Def. Evasion', barLabel: 'DE' },
  { slug: 'credential-access',    id: 'TA0006', name: 'Credential Access',     shortName: 'Cred. Access', barLabel: 'CA' },
  { slug: 'discovery',            id: 'TA0007', name: 'Discovery',             shortName: 'Discovery',    barLabel: 'DI' },
  { slug: 'lateral-movement',     id: 'TA0008', name: 'Lateral Movement',      shortName: 'Lat. Movement', barLabel: 'LM' },
  { slug: 'collection',           id: 'TA0009', name: 'Collection',            shortName: 'Collection',   barLabel: 'CO' },
  { slug: 'command-and-control',  id: 'TA0011', name: 'Command and Control',   shortName: 'C2',           barLabel: 'C2' },
  { slug: 'exfiltration',         id: 'TA0010', name: 'Exfiltration',          shortName: 'Exfiltration', barLabel: 'EF' },
  { slug: 'impact',               id: 'TA0040', name: 'Impact',                shortName: 'Impact',       barLabel: 'IM' },
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
  const isNeobrut = themeStyle === 'neobrutalism';

  const [showEmpty, setShowEmpty] = useState(false);
  const [selectedTactic, setSelectedTactic] = useState<string | null>(null);

  // Build tactic → technique[] map from test data
  const { tacticMap, maxCount, maxTacticTests, stats } = useMemo(() => {
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

    // Convert to sorted TechniqueCell[] per tactic (by count desc, then alphabetically)
    const result = new Map<string, TechniqueCell[]>();
    let maxTTests = 0;
    for (const [slug, techMap] of map) {
      const cells: TechniqueCell[] = [];
      let tacticTestTotal = 0;
      for (const [techniqueId, data] of techMap) {
        cells.push({ techniqueId, count: data.count, testNames: data.testNames });
        tacticTestTotal += data.count;
      }
      cells.sort((a, b) => b.count - a.count || a.techniqueId.localeCompare(b.techniqueId));
      result.set(slug, cells);
      if (tacticTestTotal > maxTTests) maxTTests = tacticTestTotal;
    }

    const coveredTactics = ENTERPRISE_TACTICS.filter(t => (result.get(t.slug)?.length ?? 0) > 0).length;

    return {
      tacticMap: result,
      maxCount: max,
      maxTacticTests: maxTTests,
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
      // Green phosphor shades (hue 142)
      if (intensity > 0.75) return 'oklch(0.70 0.22 142)';
      if (intensity > 0.5)  return 'oklch(0.58 0.18 142)';
      if (intensity > 0.25) return 'oklch(0.45 0.14 142)';
      return 'oklch(0.35 0.10 142)';
    }

    if (isNeobrut) {
      // Hot pink/magenta shades (hue 340, matching --primary)
      if (isDark) {
        if (intensity > 0.75) return 'oklch(0.62 0.24 340)';
        if (intensity > 0.5)  return 'oklch(0.50 0.20 340)';
        if (intensity > 0.25) return 'oklch(0.40 0.16 340)';
        return 'oklch(0.32 0.12 340)';
      }
      // Neobrutalism light
      if (intensity > 0.75) return 'oklch(0.58 0.22 340)';
      if (intensity > 0.5)  return 'oklch(0.68 0.18 340)';
      if (intensity > 0.25) return 'oklch(0.78 0.14 340)';
      return 'oklch(0.88 0.10 340)';
    }

    if (isDark) {
      if (intensity > 0.75) return 'oklch(0.65 0.20 145)';
      if (intensity > 0.5)  return 'oklch(0.52 0.16 145)';
      if (intensity > 0.25) return 'oklch(0.42 0.13 145)';
      return 'oklch(0.32 0.10 145)';
    }

    // Default light mode — green
    if (intensity > 0.75) return 'oklch(0.55 0.18 145)';
    if (intensity > 0.5)  return 'oklch(0.65 0.15 145)';
    if (intensity > 0.25) return 'oklch(0.75 0.12 145)';
    return 'oklch(0.85 0.10 145)';
  }

  function getTextColor(count: number): string {
    if (count === 0) return '';
    const intensity = maxCount > 0 ? count / maxCount : 0;

    if (isHacker) return 'oklch(0.15 0.02 142)';
    if (isNeobrut) {
      if (isDark) return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.92 0.01 340)';
      return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.20 0.02 340)';
    }
    if (isDark) return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.90 0 0)';
    return intensity > 0.5 ? 'oklch(0.98 0 0)' : 'oklch(0.20 0.02 145)';
  }

  /** Bar color — same intensity ramp as getIntensityColor but uses maxTacticTests as denominator */
  function getBarColor(totalTests: number): string {
    if (totalTests === 0) return 'transparent';
    const intensity = maxTacticTests > 0 ? totalTests / maxTacticTests : 0;

    if (isHacker) {
      if (intensity > 0.75) return 'oklch(0.70 0.22 142)';
      if (intensity > 0.5)  return 'oklch(0.58 0.18 142)';
      if (intensity > 0.25) return 'oklch(0.45 0.14 142)';
      return 'oklch(0.35 0.10 142)';
    }

    if (isNeobrut) {
      if (isDark) {
        if (intensity > 0.75) return 'oklch(0.62 0.24 340)';
        if (intensity > 0.5)  return 'oklch(0.50 0.20 340)';
        if (intensity > 0.25) return 'oklch(0.40 0.16 340)';
        return 'oklch(0.32 0.12 340)';
      }
      if (intensity > 0.75) return 'oklch(0.58 0.22 340)';
      if (intensity > 0.5)  return 'oklch(0.68 0.18 340)';
      if (intensity > 0.25) return 'oklch(0.78 0.14 340)';
      return 'oklch(0.88 0.10 340)';
    }

    if (isDark) {
      if (intensity > 0.75) return 'oklch(0.65 0.20 145)';
      if (intensity > 0.5)  return 'oklch(0.52 0.16 145)';
      if (intensity > 0.25) return 'oklch(0.42 0.13 145)';
      return 'oklch(0.32 0.10 145)';
    }

    if (intensity > 0.75) return 'oklch(0.55 0.18 145)';
    if (intensity > 0.5)  return 'oklch(0.65 0.15 145)';
    if (intensity > 0.25) return 'oklch(0.75 0.12 145)';
    return 'oklch(0.85 0.10 145)';
  }

  // ── Empty state ────────────────────────────────────────────────────

  if (stats.testCount === 0) {
    return (
      <div className="rounded-base border-theme border-border bg-card text-card-foreground shadow-theme">
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Grid3X3 className="w-10 h-10 opacity-30" />
          <p className="text-sm">No tests have MITRE ATT&CK tactic data yet.</p>
          <p className="text-xs opacity-60">
            Add <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">TACTICS:</code> to test headers to map tests to the ATT&CK matrix.
          </p>
        </div>
      </div>
    );
  }

  // ── Filter tactics ────────────────────────────────────────────────

  const visibleTactics = ENTERPRISE_TACTICS.filter(
    t => showEmpty || (tacticMap.get(t.slug)?.length ?? 0) > 0
  );

  const maxTechniqueCount = Math.max(
    ...visibleTactics.map(t => tacticMap.get(t.slug)?.length ?? 0),
    1
  );

  // ── Detail panel data ─────────────────────────────────────────────

  const selectedTacticInfo = selectedTactic
    ? ENTERPRISE_TACTICS.find(t => t.slug === selectedTactic) ?? null
    : null;
  const selectedCells = selectedTactic ? (tacticMap.get(selectedTactic) ?? []) : [];
  const selectedTotalTests = selectedCells.reduce((sum, c) => sum + c.count, 0);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="rounded-base border-theme border-border bg-card text-card-foreground shadow-theme">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold">MITRE ATT&CK Coverage</span>
          <div className="flex items-center gap-2">
            <Badge variant="success">{stats.techniqueCount} techniques</Badge>
            <Badge variant="primary">{stats.tacticCount}/14 tactics</Badge>
            <Badge variant="default">{stats.testCount} tests mapped</Badge>
          </div>
          <div className="ml-auto">
            <Switch
              label="Show uncovered tactics"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
            />
          </div>
        </div>
      </div>

      {/* Bar chart + detail panel */}
      <div className="px-4 py-4">
        {/* Bar chart */}
        <div className="flex items-end gap-1 h-48">
          {visibleTactics.map(tactic => {
            const cells = tacticMap.get(tactic.slug) ?? [];
            const techCount = cells.length;
            const totalTests = cells.reduce((sum, c) => sum + c.count, 0);
            const isEmpty = techCount === 0;
            // Use pixel heights — percentage heights don't resolve in flex children
            const maxBarPx = 176; // 192px container - 16px label area
            const barHeightPx = isEmpty ? 4 : Math.max(12, Math.round((techCount / maxTechniqueCount) * maxBarPx));
            const isSelected = selectedTactic === tactic.slug;

            return (
              <div key={tactic.slug} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                <button
                  onClick={() => setSelectedTactic(prev => prev === tactic.slug ? null : tactic.slug)}
                  className="w-full transition-all cursor-pointer hover:opacity-80 rounded-t-sm"
                  style={{
                    height: barHeightPx,
                    backgroundColor: isEmpty ? 'transparent' : getBarColor(totalTests),
                    border: isEmpty
                      ? '1px dashed var(--color-destructive, #ef4444)'
                      : isSelected
                        ? '2px solid var(--color-primary)'
                        : '1px solid transparent',
                    opacity: isEmpty ? 0.4 : 1,
                  }}
                  title={`${tactic.name} — ${techCount} techniques · ${totalTests} tests`}
                />
                <span className={`text-[9px] font-semibold leading-none ${
                  isEmpty ? 'text-destructive' : isSelected ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {tactic.barLabel}
                </span>
              </div>
            );
          })}
        </div>

        {/* Detail panel with grid-template-rows animation */}
        <div
          className="grid transition-[grid-template-rows] duration-200"
          style={{ gridTemplateRows: selectedTactic ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            {selectedTacticInfo && (
              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">
                    {selectedTacticInfo.name}
                    <span className="text-muted-foreground font-normal ml-2">{selectedTacticInfo.id}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {selectedCells.length} techniques · {selectedTotalTests} tests
                  </span>
                </div>
                {selectedCells.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No coverage for this tactic</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCells.map(cell => (
                      <button
                        key={cell.techniqueId}
                        onClick={() => onDrillToTechnique(cell.techniqueId)}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-opacity hover:opacity-80 cursor-pointer"
                        style={{
                          backgroundColor: getIntensityColor(cell.count),
                          color: getTextColor(cell.count),
                        }}
                        title={cell.testNames.slice(0, 3).join(', ') + (cell.count > 3 ? ` +${cell.count - 3} more` : '')}
                      >
                        <span className="font-mono font-semibold">{cell.techniqueId}</span>
                        {TECHNIQUE_NAMES[cell.techniqueId] && (
                          <span className="opacity-80 truncate max-w-[200px]">
                            {TECHNIQUE_NAMES[cell.techniqueId]}
                          </span>
                        )}
                        <span className="font-semibold ml-auto shrink-0">·&nbsp;{cell.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Hint when no tactic is selected */}
        {!selectedTactic && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            Click a tactic bar to explore technique coverage
          </p>
        )}
      </div>
    </div>
  );
}
