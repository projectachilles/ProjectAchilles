import { describe, it, expect } from 'vitest';
import { buildActorReadiness, buildAttackMatrix, buildCadence } from '../dashboardViews';
import type { ExecutionActivityResponse } from '@/services/api/analytics';
import type { AgentMetrics, Schedule } from '@/types/agent';
import type { TestMetadata } from '@/types/test';

function makeTest(o: Partial<TestMetadata>): TestMetadata {
  return { uuid: crypto.randomUUID(), name: 't', techniques: [], isMultiStage: false, stages: [], ...o };
}
const NOW = Date.parse('2026-10-20T12:00:00Z');
const day = (date: string, p = 0, u = 0, i = 0) => ({ date, protected: p, unprotected: u, inconclusive: i });
const metrics = {
  total: 10,
  task_activity_24h: { completed: 5, failed: 1, total: 7, success_rate: 83, in_progress: 1 },
} as AgentMetrics;
const sched = (o: Partial<Schedule>) => ({ name: null, test_name: 'Test', agent_ids: ['a'], next_run_at: null, ...o }) as Schedule;

describe('buildCadence', () => {
  it('computes bars, last run days-ago, tasks and next schedule', () => {
    const activity: ExecutionActivityResponse = {
      days: [day('2026-10-19', 3, 1, 0), day('2026-10-20')],
      lastExecutionAt: '2026-10-17T11:00:00Z',
      executions7d: 4,
      protectedPct7d: 75,
      endpointsTested7d: 2,
    };
    const v = buildCadence(activity, metrics, [
      sched({ next_run_at: '2026-10-23T09:00:00Z', name: 'Late' }),
      sched({ next_run_at: '2026-10-21T09:00:00Z', agent_ids: ['a', 'b'] }),
      sched({ next_run_at: null }),
    ], 10, NOW);
    expect(v.lastRunDaysAgo).toBe(3);
    expect(v.protectedPct7d).toBe(75);
    expect(v.taskActivity).toEqual({
      label: 'Tasks · 24h',
      parts: [
        { text: '5 done', tone: 'accent' },
        { text: '1 failed', tone: 'danger' },
        { text: '1 running', tone: 'warning' },
      ],
    });
    expect(v.nextScheduled).toEqual({ when: '2026-10-21T09:00:00Z', label: 'Test', endpoints: 2 });
    expect(v.schedulesAvailable).toBe(true);
    expect(v.agentsTotal).toBe(10);
  });

  it('zero runs and null lastExecutionAt gives a never-run state without NaN', () => {
    const v = buildCadence(
      { days: [day('2026-10-19'), day('2026-10-20')], lastExecutionAt: null, executions7d: 0, protectedPct7d: null, endpointsTested7d: 0 },
      null, [], 0, NOW,
    );
    expect(v.lastRunDaysAgo).toBeNull();
    expect(v.lastRunAt).toBeNull();
    expect(v.protectedPct7d).toBeNull();
    expect(v.taskActivity).toBeNull();
    expect(JSON.stringify(v)).not.toContain('NaN');
  });

  it('null schedules (unavailable) is not "nothing scheduled"; none dated gives nextScheduled null', () => {
    const a: ExecutionActivityResponse = { days: [], lastExecutionAt: null, executions7d: 0, protectedPct7d: null, endpointsTested7d: 0 };
    const unavailable = buildCadence(a, metrics, null, 1, NOW);
    expect(unavailable.nextScheduled).toBeNull();
    expect(unavailable.schedulesAvailable).toBe(false);
    const none = buildCadence(a, metrics, [sched({})], 1, NOW);
    expect(none.nextScheduled).toBeNull();
    expect(none.schedulesAvailable).toBe(true);
    expect(buildCadence(a, metrics, [], 1, NOW).schedulesAvailable).toBe(true);
  });

  it('ignores schedules whose next run is already in the past', () => {
    const a: ExecutionActivityResponse = { days: [], lastExecutionAt: null, executions7d: 0, protectedPct7d: null, endpointsTested7d: 0 };
    const v = buildCadence(a, metrics, [
      sched({ next_run_at: '2026-10-19T09:00:00Z', name: 'Overdue' }),
      sched({ next_run_at: '2026-10-22T09:00:00Z', name: 'Upcoming' }),
    ], 1, NOW);
    expect(v.nextScheduled?.label).toBe('Upcoming');
    expect(buildCadence(a, metrics, [sched({ next_run_at: '2026-10-19T09:00:00Z' })], 1, NOW).nextScheduled).toBeNull();
  });

  it('reports days since an old run when the window is empty', () => {
    const v = buildCadence(
      { days: [day('2026-10-20')], lastExecutionAt: '2026-08-01T00:00:00Z', executions7d: 0, protectedPct7d: null, endpointsTested7d: 0 },
      metrics, null, 1, NOW,
    );
    expect(v.lastRunDaysAgo).toBe(80);
  });
});

describe('buildActorReadiness', () => {
  it('no actors in data or library gives empty rows and the empty flag', () => {
    const v = buildActorReadiness([], [makeTest({ category: 'cyber-hygiene' })]);
    expect(v.rows).toEqual([]);
    expect(v.empty).toBe(true);
    expect(v.untestedActors).toEqual([]);
  });

  it('sorts by score asc then pairs desc, keeps every actor, counts exposed and untested', () => {
    const cov = Array.from({ length: 9 }, (_, i) => ({
      threatActor: `A${i}`, coverage: i < 2 ? 50 : 70 + i * 3, testCount: 1, protectedCount: 1, totalExecutions: 5, pairCount: i === 1 ? 20 : 5,
    }));
    const tests = [
      makeTest({ category: 'intel-driven', threatActor: 'A0' }),
      makeTest({ category: 'intel-driven', threatActor: 'Zed' }),
      makeTest({ category: 'intel-driven', threatActor: 'Alpha' }),
      makeTest({ category: 'cyber-hygiene', threatActor: 'Other' }),
    ];
    const v = buildActorReadiness(cov, tests, 'the last 30d');
    expect(v.rows).toHaveLength(9);
    expect(v.rows[0].threatActor).toBe('A1');
    expect(v.rows[1].threatActor).toBe('A0');
    expect(v.rows[0].exposed).toBe(true);
    expect(v.rows[0].daysAgo).toBeNull();
    expect(v.rows[0].stale).toBe(false);
    expect(v.totalActors).toBe(9);
    // 50,50,76,79,82,... -> exposed: 50,50,76,79
    expect(v.exposedCount).toBe(4);
    expect(v.untestedActors).toEqual(['Alpha', 'Zed']);
    expect(v.rangeLabel).toBe('the last 30d');
    expect(v.empty).toBe(false);
  });
});

describe('buildAttackMatrix', () => {
  const o = (technique: string, p = 0, d = 0, u = 0) => ({ technique, protected: p, detected: d, unprotected: u, lastTestedAt: '2026-10-20T00:00:00Z' });
  const stateFor = (p: number, d: number, u: number) =>
    buildAttackMatrix([o('T1059', p, d, u)], []).columns.find((c) => c.slug === 'execution')!.cells[0].state;

  it('pins the share band edges', () => {
    expect(stateFor(19, 0, 1)).toBe('stopped'); // exactly 0.95
    expect(stateFor(18, 0, 2)).toBe('partial'); // 0.90
    expect(stateFor(4, 0, 1)).toBe('partial'); // exactly 0.80
    expect(stateFor(7999, 0, 2001)).toBe('through'); // 0.7999
    expect(stateFor(3, 1, 1)).toBe('partial'); // detected counts as stopped: 0.80
    expect(stateFor(0, 0, 2)).toBe('through');
    expect(stateFor(5, 0, 0)).toBe('stopped');
  });

  it('places sub-techniques under parent tactics; unknown IDs count in totals but in no column', () => {
    const v = buildAttackMatrix([o('T1059.001', 1), o('T9999', 0, 0, 2)], []);
    const exec = v.columns.find((c) => c.slug === 'execution')!;
    expect(exec.cells[0]).toMatchObject({ technique: 'T1059.001', state: 'stopped', protected: 1 });
    expect(v.columns.some((c) => c.cells.some((x) => x.technique === 'T9999'))).toBe(false);
    expect(v.totals.techniques).toBe(2);
    expect(v.totals.through).toBe(1);
    expect(v.empty).toBe(false);
  });

  it('orders through, partial, stopped, notRun then ID; labels carry counts; weakest tactic', () => {
    const v = buildAttackMatrix(
      [o('T1059', 5), o('T1059.001', 3, 2, 1), o('T1059.003', 1, 0, 1), o('T1059.005', 1, 0, 1)],
      [makeTest({ techniques: ['T1059.007'], stages: [{ stageId: 1, technique: 'T1059.008', name: 's', fileName: 'f' }] })],
    );
    const exec = v.columns.find((c) => c.slug === 'execution')!;
    expect(exec.cells.map((c) => `${c.technique}:${c.state}`)).toEqual([
      'T1059.003:through', 'T1059.005:through', 'T1059.001:partial', 'T1059:stopped',
      'T1059.007:notRun', 'T1059.008:notRun',
    ]);
    expect(exec.cells[2].label).toBe('T1059.001 · 3 blocked · 2 detected only · 1 got through of 6 test × endpoint results');
    expect(exec.cells[4].label).toBe('T1059.007 · in library, not run in this range');
    expect(exec.throughCount).toBe(2);
    expect(exec.stoppedCount).toBe(1);
    expect(exec.testedCount).toBe(4);
    expect(v.weakestTactic?.slug).toBe('execution');
    expect(v.totals).toMatchObject({ through: 2, partial: 1, stopped: 1, notRun: 2, techniques: 6 });
  });

  it('normalises technique IDs (trim + upper case) when merging outcomes and library techniques', () => {
    const v = buildAttackMatrix(
      [o('T1059', 2), o(' t1059 ', 1, 0, 1)],
      [makeTest({ techniques: ['t1059', ' T1059.001'], stages: [{ stageId: 1, technique: 't1059.001 ', name: 's', fileName: 'f' }] })],
    );
    const exec = v.columns.find((c) => c.slug === 'execution')!;
    expect(exec.cells.map((c) => `${c.technique}:${c.state}`)).toEqual(['T1059:through', 'T1059.001:notRun']);
    expect(exec.cells[0]).toMatchObject({ protected: 3, unprotected: 1 });
    expect(v.totals.techniques).toBe(2);
  });

  it('no through cells gives weakestTactic null; nothing at all is empty', () => {
    expect(buildAttackMatrix([o('T1059', 1)], []).weakestTactic).toBeNull();
    const e = buildAttackMatrix([], []);
    expect(e.empty).toBe(true);
    expect(e.columns.length).toBeGreaterThan(0);
  });
});

describe('buildCadence run activity with 7-day outcomes', () => {
  it('reports runs with and without a verdict', () => {
    const v = buildCadence(
      { days: [], lastExecutionAt: null, executions7d: 0, protectedPct7d: null, endpointsTested7d: 0 },
      {
        ...metrics,
        task_outcomes_7d: {
          tests: { protected: 3, edr_stopped: 2, unprotected: 1, not_run: 1, run_failed: 0, test_error: 2, inconclusive: 0 },
          other: { total: 4, failed: 1 },
        },
      },
      [], 0, NOW,
    );
    expect(v.taskActivity).toEqual({
      label: 'Runs · 7d',
      parts: [
        { text: '4 with a verdict', tone: 'accent' },
        { text: '3 no verdict', tone: 'warning' },
        { text: '1 running', tone: 'info' },
      ],
    });
  });
});
