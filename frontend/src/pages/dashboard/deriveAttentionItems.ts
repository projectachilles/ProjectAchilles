import type { AttentionItem } from './components/AttentionBanner';

export interface AttentionInputs {
  offlineAgents: number;
  staleAgents: number;
  /** Runs that didn't finish (not EDR stops) plus failed commands/updates. */
  failedTasks: number;
  /** The window failedTasks covers: 7d with outcome metrics, else the legacy 24h count. */
  failedTasksWindow: '7d' | '24h';
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

  if (inputs.failedTasks > 0) {
    const window = inputs.failedTasksWindow;
    items.push({
      id: 'failed-tasks',
      count: inputs.failedTasks,
      label: `tasks failed · ${window}`,
      title: `${inputs.failedTasks} task(s) failed in the last ${window === '7d' ? '7 days' : '24h'}`,
      to: '/tasks',
      // Amber like "run failed" on the Tasks page: red is for Unprotected results.
      severity: 'warning',
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
