import type { AttentionItem } from './components/AttentionBanner';

export interface AttentionInputs {
  offlineAgents: number;
  staleAgents: number;
  failedTasks24h: number;
  outdatedAgents: number;
  syncFailed: boolean;
}

/**
 * Derive needs-attention banner items from data the dashboard already
 * fetched — no dedicated endpoint. Order matches the design handoff.
 */
export function deriveAttentionItems(inputs: AttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (inputs.offlineAgents > 0) {
    items.push({
      id: 'offline-agents',
      label: `${inputs.offlineAgents} agent(s) offline`,
      to: '/agents',
      severity: 'warning',
    });
  }

  if (inputs.staleAgents > 0) {
    items.push({
      id: 'stale-agents',
      label: `${inputs.staleAgents} stale agent(s) — no tasks in 7 days`,
      to: '/agents?stale=true',
      severity: 'warning',
    });
  }

  if (inputs.failedTasks24h > 0) {
    items.push({
      id: 'failed-tasks',
      label: `${inputs.failedTasks24h} task(s) failed in the last 24h`,
      to: '/tasks',
      severity: 'danger',
    });
  }

  if (inputs.outdatedAgents > 0) {
    items.push({
      id: 'outdated-agents',
      label: `${inputs.outdatedAgents} agent(s) running outdated versions`,
      to: '/agents',
      severity: 'warning',
    });
  }

  if (inputs.syncFailed) {
    items.push({
      id: 'sync-failed',
      label: 'test library sync failed',
      to: '/tests',
      severity: 'danger',
    });
  }

  return items;
}
