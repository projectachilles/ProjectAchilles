// Type definitions for the EDR-killed agent run reconciliation pass
// (services/edr/agent-kill-reconcile.service.ts).

export interface AgentKillPassResult {
  /** Watchdog-failed tasks examined (with a hostname and parseable times). */
  candidates: number;
  /** Tasks turned into Protected results on this pass. */
  reconciled: number;
  /** Already-reconciled tasks that gained another vendor's proof. */
  vendorsAdded: number;
  errors: string[];
}
