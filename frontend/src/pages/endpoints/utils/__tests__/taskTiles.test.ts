import { describe, it, expect } from 'vitest';
import { taskTiles } from '../taskTiles';
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
