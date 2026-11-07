import { describe, it, expect } from 'vitest';
import { taskTiles, breakdownGroups } from '../taskTiles';
import type { AgentMetrics } from '@/types/agent';

const base: AgentMetrics = {
  total: 0, online: 0, offline: 0, by_os: {}, by_status: {}, pending_tasks: 0,
  task_activity_24h: { completed: 0, failed: 0, total: 0, success_rate: 0, in_progress: 2 },
  by_version: {},
} as AgentMetrics;

const withOutcomes = (tests: Partial<NonNullable<AgentMetrics['task_outcomes_7d']>['tests']>, other = { total: 0, failed: 0 }): AgentMetrics => ({
  ...base,
  task_outcomes_7d: {
    tests: { protected: 0, edr_stopped: 0, unprotected: 0, not_run: 0, run_failed: 0, test_error: 0, inconclusive: 0, ...tests },
    other,
  },
});

describe('taskTiles', () => {
  it('counts 7-day test runs by outcome, with the no-verdict breakdown', () => {
    const { window, tiles } = taskTiles(withOutcomes(
      { protected: 14, edr_stopped: 2, unprotected: 5, not_run: 3, run_failed: 1, test_error: 2 },
      { total: 48, failed: 4 },
    ));
    expect(window).toBe('last 7 days');
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Protected', '14'], ['Unprotected', '5'], ['No verdict', '6'], ['In progress', '2'],
    ]);
    expect(tiles[0].sub).toBe('incl. 2 stopped by EDR');
    expect(tiles[1].cls).toBe('text-danger');
    expect(tiles[2].sub).toBe('3 not run · 1 run failed · 2 test error');
    expect(tiles[3].sub).toBe('+ 48 other tasks · 4 failed');
  });

  it('shows — (never 0%) when no test ran in the window', () => {
    const { tiles } = taskTiles(withOutcomes({}));
    expect(tiles.slice(0, 3).map((t) => t.value)).toEqual(['—', '—', '—']);
    expect(tiles[0].sub).toBe('no test runs in 7 days');
    expect(tiles.some((t) => t.value.includes('%'))).toBe(false);
  });

  it('only colours Unprotected red, and only when there is one', () => {
    const { tiles } = taskTiles(withOutcomes({ protected: 3 }));
    expect(tiles[1]).toMatchObject({ value: '0', cls: '' });
  });

  it('falls back to the 24h lifecycle tiles without outcome metrics (serverless)', () => {
    const { window, tiles } = taskTiles({ ...base, task_activity_24h: { completed: 3, failed: 1, total: 4, success_rate: 75, in_progress: 0 } });
    expect(window).toBe('last 24 hours');
    expect(tiles.map((t) => t.value)).toEqual(['3', '1', '0', '75%']);
    expect(taskTiles(base).tiles[3].value).toBe('—');
  });
});

describe('breakdownGroups', () => {
  const rows = [
    { key: 'a', outcome: 'protected' as const, code: 126, name: 'Quarantined', count: 30 },
    { key: 'b', outcome: 'protected' as const, code: 105, name: 'Blocked', count: 8 },
    { key: 'c', outcome: 'inconclusive' as const, code: null, name: 'Unclear', count: 2 },
    { key: 'stage:101', outcome: 'unprotected' as const, code: 101, name: 'Unprotected · stage ran', count: 5 },
    { key: 'exit:101', outcome: 'unprotected' as const, code: 101, name: 'Unprotected', count: 3 },
    { key: 'd', outcome: 'not-run' as const, code: null, name: 'Agent offline', count: 6 },
    { key: 'e', outcome: 'test-error' as const, code: 999, name: 'Test error', count: 8 },
  ];
  const o = { ...withOutcomes({ protected: 38, not_run: 6, test_error: 8, inconclusive: 2 }).task_outcomes_7d!, breakdown: rows };

  it('protected is one untitled group', () => {
    const g = breakdownGroups(o, 'protected')!;
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ title: null, total: 38 });
    expect(g[0].rows.map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('no verdict is ordered, drops empty groups, totals match', () => {
    const g = breakdownGroups(o, 'no-verdict')!;
    expect(g.map((x) => [x.title, x.total])).toEqual([['Not run', 6], ['Test error', 8], ['Inconclusive', 2]]);
  });

  it('unprotected is one untitled group of the 101 rows', () => {
    const g = breakdownGroups(o, 'unprotected')!;
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ title: null, total: 8 });
    expect(g[0].rows.map((r) => r.key)).toEqual(['stage:101', 'exit:101']);
  });

  it('is null without a breakdown', () => {
    expect(breakdownGroups({ ...o, breakdown: undefined }, 'protected')).toBeNull();
  });

  it('gives tiles ids', () => {
    expect(taskTiles(withOutcomes({})).tiles.map((t) => t.id)).toEqual(['protected', 'unprotected', 'no-verdict', 'in-progress']);
    expect(taskTiles(base).tiles.map((t) => t.id)).toEqual(['completed', 'failed', 'in-progress', 'success-rate']);
  });
});
