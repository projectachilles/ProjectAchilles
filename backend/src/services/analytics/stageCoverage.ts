/**
 * Stage coverage: how much of each attack chain was caught, stage by stage.
 * The Defense Score counts a chain as protected once any stage is caught;
 * this shows what that hides (chains that rest on a single stage) without
 * changing the score. Pure: the chains come from ElasticsearchService.
 */
import type { StageCoverageGroup, StageCoverageResponse } from '../../types/analytics.js';

/** One chain's latest run, as stage counts. */
export interface ChainStageCounts {
  /** '' when unknown: the chain is counted but not listed. */
  bundleName: string;
  /** The pair's any-stage verdict (what the Defense Score counts). */
  protected: boolean;
  /** Stages with a conclusive result. */
  ran: number;
  blocked: number;
  /** Stages an EDR alert named itself, not blocked. */
  detected: number;
  /** Stages reported as Skipped: the orchestrator stopped before them. */
  skipped: number;
}

type GroupKey = 'singleStage' | 'depthNotTested' | 'layered' | 'noneCaught';

function groupOf(c: ChainStageCounts): GroupKey {
  const caught = c.blocked + c.detected;
  if (caught === 0) return 'noneCaught';
  if (caught >= 2) return 'layered';
  // Exactly one stage caught. Skipped stages mean the run stopped there, so
  // nothing says whether a later stage would have been caught too.
  return c.skipped > 0 ? 'depthNotTested' : 'singleStage';
}

export function summarizeStageCoverage(chains: ChainStageCounts[]): StageCoverageResponse {
  const groups: Record<GroupKey, { count: number; names: Set<string> }> = {
    singleStage: { count: 0, names: new Set() },
    depthNotTested: { count: 0, names: new Set() },
    layered: { count: 0, names: new Set() },
    noneCaught: { count: 0, names: new Set() },
  };
  let chainsProtected = 0;
  let stagesRan = 0;
  let blocked = 0;
  let detected = 0;
  let through = 0;
  for (const c of chains) {
    if (c.protected) chainsProtected++;
    stagesRan += c.ran;
    blocked += c.blocked;
    detected += c.detected;
    through += Math.max(0, c.ran - c.blocked - c.detected);
    const g = groups[groupOf(c)];
    g.count++;
    if (c.bundleName) g.names.add(c.bundleName);
  }
  const group = (key: GroupKey): StageCoverageGroup => ({
    count: groups[key].count,
    bundleNames: [...groups[key].names].sort((a, b) => a.localeCompare(b)),
  });
  return {
    chains: chains.length,
    chainsProtected,
    stagesRan,
    blocked,
    detected,
    through,
    coverage: stagesRan === 0 ? null : Math.round(((blocked + detected) / stagesRan) * 10000) / 100,
    singleStage: group('singleStage'),
    depthNotTested: group('depthNotTested'),
    layered: group('layered'),
    noneCaught: group('noneCaught'),
  };
}
