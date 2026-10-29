// Type definitions for the EDR launch-block reconciliation pass
// (services/edr/launch-block-reconcile.service.ts).

export interface LaunchBlockPassResult {
  /** Prevention alerts of launch-block-capable vendors that name an Achilles run or orchestrator. */
  evidenceAlerts: number;
  /** Exit-260 result docs those alerts could prove. */
  candidates: number;
  /** Docs turned into Protected (exit 126) results on this pass. */
  resolved: number;
  errors: string[];
}
