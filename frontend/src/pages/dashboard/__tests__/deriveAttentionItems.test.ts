import { describe, it, expect } from 'vitest';
import { deriveAttentionItems } from '../deriveAttentionItems';

const quiet = {
  offlineAgents: 0,
  staleAgents: 0,
  failedTasks: 0,
  failedTasksWindow: '24h' as const,
  outdatedAgents: 0,
  syncFailed: false,
};

describe('deriveAttentionItems', () => {
  it('returns nothing when the fleet is healthy', () => {
    expect(deriveAttentionItems(quiet)).toEqual([]);
  });

  it('produces one item per problem, in handoff order', () => {
    const items = deriveAttentionItems({
      offlineAgents: 2,
      staleAgents: 1,
      failedTasks: 6,
  failedTasksWindow: '24h' as const,
      outdatedAgents: 3,
      syncFailed: true,
    });
    expect(items.map((i) => i.id)).toEqual([
      'offline-agents',
      'stale-agents',
      'failed-tasks',
      'outdated-agents',
      'sync-failed',
    ]);
  });

  it('marks sync failures as danger; failed tasks are amber like run failed on the Tasks page', () => {
    const items = deriveAttentionItems({
      offlineAgents: 1,
      staleAgents: 1,
      failedTasks: 1,
  failedTasksWindow: '24h' as const,
      outdatedAgents: 1,
      syncFailed: true,
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i.severity]));
    expect(byId).toEqual({
      'offline-agents': 'warning',
      'stale-agents': 'warning',
      'failed-tasks': 'warning',
      'outdated-agents': 'warning',
      'sync-failed': 'danger',
    });
  });

  it('routes stale agents to the stale filter and failures to tasks', () => {
    const items = deriveAttentionItems({ ...quiet, staleAgents: 2, failedTasks: 1 });
    expect(items.find((i) => i.id === 'stale-agents')?.to).toBe('/agents?stale=true');
    expect(items.find((i) => i.id === 'failed-tasks')?.to).toBe('/tasks');
  });
});

describe('deriveAttentionItems chip text', () => {
  it('splits each count from its short chip label and keeps the full sentence as the title', () => {
    const items = deriveAttentionItems({
      offlineAgents: 11,
      staleAgents: 9,
      failedTasks: 2,
  failedTasksWindow: '24h' as const,
      outdatedAgents: 9,
      syncFailed: true,
    });
    expect(items.map(({ id, count, label, title }) => ({ id, count, label, title }))).toEqual([
      { id: 'offline-agents', count: 11, label: 'offline', title: '11 agent(s) offline' },
      { id: 'stale-agents', count: 9, label: 'stale · 7d', title: '9 agent(s) with no tasks in 7 days' },
      { id: 'failed-tasks', count: 2, label: 'tasks failed · 24h', title: '2 task(s) failed in the last 24h' },
      { id: 'outdated-agents', count: 9, label: 'outdated', title: '9 agent(s) running outdated versions' },
      { id: 'sync-failed', count: undefined, label: 'library sync failed', title: 'Test library sync failed' },
    ]);
  });
});

describe('deriveAttentionItems failed-tasks window', () => {
  it('says 7d when the backend reports 7-day outcome counts', () => {
    const [item] = deriveAttentionItems({ ...quiet, failedTasks: 3, failedTasksWindow: '7d' });
    expect(item).toMatchObject({ id: 'failed-tasks', count: 3, label: 'tasks failed · 7d', title: '3 task(s) failed in the last 7 days' });
  });
});
