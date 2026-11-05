import type { StageInfo } from '@/types/test';
import type { TestFleetStage } from '@/services/api/analytics';
import type { StagePillData } from './StageChain';

/**
 * Match fleet rows to stages by technique (`ControlID` is the stage technique
 * in ES). Stages sharing a technique get the same data plus `sharedWith`;
 * rows matching no current stage are returned as `earlier`.
 */
export function mapFleetToPills(
  stages: StageInfo[],
  fleet: TestFleetStage[],
): { pills: Record<number, StagePillData>; earlier: TestFleetStage[] } {
  const pills: Record<number, StagePillData> = {};
  const matched = new Set<string>();
  for (const row of fleet) {
    const hits = stages.filter((s) => s.technique === row.controlId);
    if (hits.length === 0) continue;
    matched.add(row.controlId);
    for (const s of hits) {
      const others = hits.filter((o) => o.stageId !== s.stageId).map((o) => o.stageId);
      pills[s.stageId] = {
        blocked: row.blocked, detected: row.detected, through: row.through,
        ...(others.length > 0 ? { sharedWith: others } : {}),
      };
    }
  }
  return { pills, earlier: fleet.filter((r) => !matched.has(r.controlId)) };
}
