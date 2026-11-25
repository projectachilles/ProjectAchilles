import { describe, it, expect } from 'vitest';
import { stageMarks, taskBucket, MAX_STAGE_MARKS } from '../testOutcome';
import type { AgentTask } from '@/types/agent';

type Slim = Pick<AgentTask, 'type' | 'status' | 'result'>;
type Controls = NonNullable<NonNullable<AgentTask['result']>['bundle_results']>['controls'];

const base = { exit_code: 101, stdout: '', stderr: '', started_at: '', completed_at: '', execution_duration_ms: 1, hostname: 'h' };
const task = (overrides: Partial<Slim> = {}): Slim => ({ type: 'execute_test', status: 'completed', result: base, ...overrides });
const bundle = (controls: Controls, extra: { bundle_category?: string } = {}): Slim =>
  task({ result: { ...base, bundle_results: { ...extra, controls } } });

describe('stageMarks', () => {
  it('gives one mark per stage: not blocked, blocked, skipped', () => {
    expect(
      stageMarks(bundle([
        { control_id: 'T1105', exit_code: 101 },
        { control_id: 'T1572', exit_code: 126 },
        { control_id: 'T1005', exit_code: 0, skipped: true },
      ])),
    ).toEqual([
      { controlId: 'T1105', tone: 'danger', label: 'not blocked' },
      { controlId: 'T1572', tone: 'accent', label: 'blocked' },
      { controlId: 'T1005', tone: 'hollow', label: 'skipped' },
    ]);
  });

  it('names a stage that produced no verdict by what its exit code means', () => {
    expect(stageMarks(bundle([{ control_id: 'S1', exit_code: 999 }]))![0]).toEqual({
      controlId: 'S1', tone: 'warning', label: 'test error, prerequisites not met',
    });
  });

  it('falls back to the exit code for one it does not know', () => {
    expect(stageMarks(bundle([{ control_id: 'S1', exit_code: 42 }]))![0]).toEqual({ controlId: 'S1', tone: 'muted', label: 'exit 42' });
  });

  it('has no marks for a test without stages', () => {
    expect(stageMarks(task())).toBeNull();
  });

  it('has no marks for a cyber-hygiene bundle: its controls are not attack stages', () => {
    expect(stageMarks(bundle([{ control_id: 'CH-DEF-001', exit_code: 126 }], { bundle_category: 'cyber-hygiene' }))).toBeNull();
  });

  it('has no marks past the limit, so a pill never holds a wall of squares', () => {
    const many = Array.from({ length: MAX_STAGE_MARKS + 1 }, (_, i) => ({ control_id: `S${i}`, exit_code: 101 }));
    expect(stageMarks(bundle(many))).toBeNull();
    expect(stageMarks(bundle(many.slice(0, MAX_STAGE_MARKS)))).toHaveLength(MAX_STAGE_MARKS);
  });

  it('survives stage data that is not a list', () => {
    expect(stageMarks(task({ result: { ...base, bundle_results: { controls: 'x' as never } } }))).toBeNull();
  });

  it('drops a malformed stage and keeps the rest', () => {
    expect(stageMarks(bundle([{ control_id: 'S1' } as never, { control_id: 'S2', exit_code: 101 }]))).toEqual([
      { controlId: 'S2', tone: 'danger', label: 'not blocked' },
    ]);
  });

  it('has no marks while the run is in progress or for another task type', () => {
    expect(stageMarks(task({ status: 'executing', result: undefined }))).toBeNull();
    expect(stageMarks({ ...bundle([{ control_id: 'S1', exit_code: 101 }]), type: 'execute_command' })).toBeNull();
  });
});

describe('taskBucket', () => {
  it.each(['pending', 'assigned', 'downloading', 'executing'] as const)('%s is in progress', (status) => {
    expect(taskBucket(task({ status, result: undefined }))).toBe('in-progress');
  });

  it('sorts a finished test by its outcome', () => {
    expect(taskBucket(task({ result: { ...base, exit_code: 126 } }))).toBe('protected');
    expect(taskBucket(task({ result: { ...base, exit_code: 101 } }))).toBe('unprotected');
  });

  it.each([260, 999, 0])('a test that exited %i has no verdict', (exit_code) => {
    expect(taskBucket(task({ result: { ...base, exit_code } }))).toBe('no-verdict');
  });

  it('a run that did not finish has no verdict, unless the EDR stopped it', () => {
    expect(taskBucket(task({ status: 'failed', result: { ...base, exit_code: -1 } }))).toBe('no-verdict');
    expect(
      taskBucket(task({ status: 'failed', result: { ...base, exit_code: -1, edr_terminated: { vendors: ['defender'], alert_ids: ['a'] } } })),
    ).toBe('protected');
  });

  it('a test that expired before it ran has no verdict', () => {
    expect(taskBucket(task({ status: 'expired', result: undefined }))).toBe('no-verdict');
  });

  it('other task types count by lifecycle', () => {
    expect(taskBucket(task({ type: 'execute_command', result: { ...base, exit_code: 0 } }))).toBe('completed');
    expect(taskBucket(task({ type: 'execute_command', status: 'failed' }))).toBe('failed');
    expect(taskBucket(task({ type: 'update_agent', status: 'expired', result: undefined }))).toBe('failed');
  });
});
