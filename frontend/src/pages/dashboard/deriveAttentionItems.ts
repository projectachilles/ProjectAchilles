import type { AttentionItem } from './components/AttentionBanner';

export interface AttentionInputs {
  offlineAgents: number;
  staleAgents: number;
  failedTasks24h: number;
  outdatedAgents: number;
  syncFailed: boolean;
}

/**
 * Derive needs-attention chips from data the dashboard already
 * fetched — no dedicated endpoint. Order matches the design handoff.
 */
export function deriveAttentionItems(inputs: AttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (inputs.offlineAgents > 0) {
    items.push({
      id: 'offline-agents',
      count: inputs.offlineAgents,
      label: 'offline',
      title: `${inputs.offlineAgents} agent(s) offline`,
      to: '/agents',
      severity: 'warning',
    });
  }

  if (inputs.staleAgents > 0) {
    items.push({
      id: 'stale-agents',
      count: inputs.staleAgents,
      label: 'stale · 7d',
      title: `${inputs.staleAgents} agent(s) with no tasks in 7 days`,
      to: '/agents?stale=true',
      severity: 'warning',
    });
  }

  if (inputs.failedTasks24h > 0) {
    items.push({
      id: 'failed-tasks',
      count: inputs.failedTasks24h,
      label: 'tasks failed · 24h',
      title: `${inputs.failedTasks24h} task(s) failed in the last 24h`,
      to: '/tasks',
      severity: 'danger',
    });
  }

  if (inputs.outdatedAgents > 0) {
    items.push({
      id: 'outdated-agents',
      count: inputs.outdatedAgents,
      label: 'outdated',
      title: `${inputs.outdatedAgents} agent(s) running outdated versions`,
      to: '/agents',
      severity: 'warning',
    });
  }

  if (inputs.syncFailed) {
    items.push({
      id: 'sync-failed',
      label: 'library sync failed',
      title: 'Test library sync failed',
      to: '/tests',
      severity: 'danger',
    });
  }

  return items;
}
