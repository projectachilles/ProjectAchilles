import type { TestMetadata } from '@/types/test';
import type { TacticCoverage } from './components/MitreCoverageBars';
import type { SeverityMix } from './components/SeverityDonut';
import type { CategoryRow } from './components/CategoryBreakdownCard';

/** Enterprise tactics in kill-chain order; the dashboard bars show the 12 from initial-access on. */
const ENTERPRISE_TACTICS = [
  { slug: 'reconnaissance', code: 'RE', name: 'Reconnaissance', shown: false },
  { slug: 'resource-development', code: 'RD', name: 'Resource Development', shown: false },
  { slug: 'initial-access', code: 'IA', name: 'Initial Access', shown: true },
  { slug: 'execution', code: 'EX', name: 'Execution', shown: true },
  { slug: 'persistence', code: 'PE', name: 'Persistence', shown: true },
  { slug: 'privilege-escalation', code: 'PR', name: 'Privilege Escalation', shown: true },
  { slug: 'defense-evasion', code: 'DE', name: 'Defense Evasion', shown: true },
  { slug: 'credential-access', code: 'CA', name: 'Credential Access', shown: true },
  { slug: 'discovery', code: 'DI', name: 'Discovery', shown: true },
  { slug: 'lateral-movement', code: 'LM', name: 'Lateral Movement', shown: true },
  { slug: 'collection', code: 'CO', name: 'Collection', shown: true },
  { slug: 'command-and-control', code: 'C2', name: 'Command and Control', shown: true },
  { slug: 'exfiltration', code: 'EF', name: 'Exfiltration', shown: true },
  { slug: 'impact', code: 'IM', name: 'Impact', shown: true },
] as const;

export interface MitreCoverage {
  tactics: TacticCoverage[];
  totalTechniques: number;
  coveredTactics: number;
  totalTactics: number;
  mappedTests: number;
}

export interface TestStats {
  total: number;
  criticalHigh: number;
  severityMix: SeverityMix;
  categories: CategoryRow[];
  avgScore: number;
  scoredTests: number;
  mitre: MitreCoverage;
}

export function computeTestStats(tests: TestMetadata[]): TestStats {
  // Severity — untagged tests count as info (bucketed with low for the donut)
  const severityCounts: Record<string, number> = {};
  for (const t of tests) {
    const sev = (t.severity || 'info').toLowerCase();
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
  }
  const criticalHigh = (severityCounts.critical || 0) + (severityCounts.high || 0);
  const severityMix: SeverityMix = {
    high: criticalHigh,
    medium: severityCounts.medium || 0,
    low: (severityCounts.low || 0) + (severityCounts.info || 0),
  };

  // Categories
  const categoryCounts = new Map<string, number>();
  for (const t of tests) {
    if (!t.category) continue;
    categoryCounts.set(t.category, (categoryCounts.get(t.category) || 0) + 1);
  }
  const categories: CategoryRow[] = [...categoryCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Scores
  const scores = tests.map((t) => t.score).filter((s): s is number => s != null && s > 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // MITRE coverage — distinct techniques per tactic (tactics are kebab slugs)
  const perTactic = new Map<string, Set<string>>();
  for (const tactic of ENTERPRISE_TACTICS) perTactic.set(tactic.slug, new Set());
  const allTechniques = new Set<string>();
  const mappedTests = new Set<string>();

  for (const test of tests) {
    if (!test.tactics?.length || !test.techniques?.length) continue;
    mappedTests.add(test.uuid);
    for (const tactic of test.tactics) {
      const set = perTactic.get(tactic.toLowerCase());
      if (!set) continue;
      for (const tech of test.techniques) {
        set.add(tech);
        allTechniques.add(tech);
      }
    }
  }

  const coveredTactics = ENTERPRISE_TACTICS.filter(
    (t) => (perTactic.get(t.slug)?.size ?? 0) > 0,
  ).length;

  return {
    total: tests.length,
    criticalHigh,
    severityMix,
    categories,
    avgScore,
    scoredTests: scores.length,
    mitre: {
      tactics: ENTERPRISE_TACTICS.filter((t) => t.shown).map((t) => ({
        code: t.code,
        name: t.name,
        count: perTactic.get(t.slug)?.size ?? 0,
      })),
      totalTechniques: allTechniques.size,
      coveredTactics,
      totalTactics: ENTERPRISE_TACTICS.length,
      mappedTests: mappedTests.size,
    },
  };
}
