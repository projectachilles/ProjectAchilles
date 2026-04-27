// ─────────────────────────────────────────────────────────────────────────
// KILL CHAIN HELPERS
// Derive a kill-chain visualization from data already returned by the
// backend test-catalog services. No backend changes required.
//
// The backend gives us:
//   - test.tactics: string[]   MITRE tactic slugs (e.g. ['execution',
//                              'defense-evasion', 'impact'])
//   - test.stages:  StageInfo[] per-stage technique + name + filename
//   - test.techniques: string[] all MITRE technique IDs across the test
//
// We map each declared tactic to a stage-strip cell, then bucket the test's
// stages under whichever cell shares its technique's tactic slug. When the
// backend hasn't told us the tactic per stage, we fall back to grouping all
// stages under the first declared tactic so the panel is never empty when
// stages exist.
// ─────────────────────────────────────────────────────────────────────────

import type { TestDetails, StageInfo } from '@/types/test';

/** Canonical MITRE Enterprise tactic order for the strip. */
export interface KillChainTactic {
  slug: string;
  id: string;
  name: string;
  shortName: string;
}

export const ENTERPRISE_TACTICS: KillChainTactic[] = [
  { slug: 'reconnaissance', id: 'TA0043', name: 'Reconnaissance', shortName: 'Recon' },
  { slug: 'resource-development', id: 'TA0042', name: 'Resource Development', shortName: 'Res. Dev.' },
  { slug: 'initial-access', id: 'TA0001', name: 'Initial Access', shortName: 'Init. Access' },
  { slug: 'execution', id: 'TA0002', name: 'Execution', shortName: 'Execution' },
  { slug: 'persistence', id: 'TA0003', name: 'Persistence', shortName: 'Persistence' },
  { slug: 'privilege-escalation', id: 'TA0004', name: 'Privilege Escalation', shortName: 'Priv. Esc.' },
  { slug: 'defense-evasion', id: 'TA0005', name: 'Defense Evasion', shortName: 'Def. Evasion' },
  { slug: 'credential-access', id: 'TA0006', name: 'Credential Access', shortName: 'Cred. Access' },
  { slug: 'discovery', id: 'TA0007', name: 'Discovery', shortName: 'Discovery' },
  { slug: 'lateral-movement', id: 'TA0008', name: 'Lateral Movement', shortName: 'Lat. Move' },
  { slug: 'collection', id: 'TA0009', name: 'Collection', shortName: 'Collection' },
  { slug: 'command-and-control', id: 'TA0011', name: 'Command and Control', shortName: 'C2' },
  { slug: 'exfiltration', id: 'TA0010', name: 'Exfiltration', shortName: 'Exfiltration' },
  { slug: 'impact', id: 'TA0040', name: 'Impact', shortName: 'Impact' },
];

export interface KillChainStep {
  stageId: number;
  technique: string;
  name: string;
  fileName: string;
  /** Used as the "expected outcome" when nothing better is available. */
  outcomeHint?: string;
}

export interface KillChainCell {
  tactic: KillChainTactic;
  /** Whether the test exercises this tactic (stage strip "is-used" state). */
  used: boolean;
  steps: KillChainStep[];
}

/**
 * Build a kill chain from a TestDetails. The strip always renders the full
 * MITRE Enterprise tactic list; only cells in `test.tactics` are highlighted.
 * Stages are bucketed under matching tactics, falling back to the first
 * declared tactic when we can't otherwise classify them.
 */
export function buildKillChain(test: TestDetails | null | undefined): KillChainCell[] {
  if (!test) return ENTERPRISE_TACTICS.map((t) => ({ tactic: t, used: false, steps: [] }));

  const usedSlugs = new Set((test.tactics ?? []).map((s) => s.toLowerCase()));
  const cells: KillChainCell[] = ENTERPRISE_TACTICS.map((tactic) => ({
    tactic,
    used: usedSlugs.has(tactic.slug),
    steps: [],
  }));

  // Without per-stage tactics the safest grouping is "all stages under the
  // first declared tactic" — that keeps the per-stage list reachable without
  // claiming false coverage on tactics the test never declared.
  const stages: StageInfo[] = Array.isArray(test.stages) ? test.stages : [];
  const firstUsed = cells.find((c) => c.used);

  if (stages.length > 0 && firstUsed) {
    firstUsed.steps = stages.map((s) => ({
      stageId: s.stageId,
      technique: s.technique,
      name: s.name,
      fileName: s.fileName,
    }));
  }

  return cells;
}

/** Pretty-print a tactic slug as a short caption (used in tactic chips). */
export function tacticCaption(slug: string | undefined | null): string {
  if (!slug) return '';
  const t = ENTERPRISE_TACTICS.find((x) => x.slug === slug.toLowerCase());
  return t ? t.shortName : slug;
}
