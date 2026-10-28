import { describe, it, expect } from 'vitest';
import { deriveAttentionItems } from '../deriveAttentionItems';

const quiet = {
  offlineAgents: 0,
  staleAgents: 0,
  failedTasks24h: 0,
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
      failedTasks24h: 6,
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

  it('marks failed tasks and sync failures as danger, the rest warning', () => {
    const items = deriveAttentionItems({
      offlineAgents: 1,
      staleAgents: 1,
      failedTasks24h: 1,
      outdatedAgents: 1,
      syncFailed: true,
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i.severity]));
    expect(byId).toEqual({
      'offline-agents': 'warning',
      'stale-agents': 'warning',
      'failed-tasks': 'danger',
      'outdated-agents': 'warning',
      'sync-failed': 'danger',
    });
  });

  it('routes stale agents to the stale filter and failures to tasks', () => {
    const items = deriveAttentionItems({ ...quiet, staleAgents: 2, failedTasks24h: 1 });
    expect(items.find((i) => i.id === 'stale-agents')?.to).toBe('/agents?stale=true');
    expect(items.find((i) => i.id === 'failed-tasks')?.to).toBe('/tasks');
  });
});

describe('deriveAttentionItems chip text', () => {
  it('splits each count from its short chip label and keeps the full sentence as the title', () => {
    const items = deriveAttentionItems({
      offlineAgents: 11,
      staleAgents: 9,
      failedTasks24h: 2,
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
