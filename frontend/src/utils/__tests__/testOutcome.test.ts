import { describe, it, expect } from 'vitest';
import { testOutcome } from '../testOutcome';
import type { AgentTask } from '@/types/agent';

type Partial = Pick<AgentTask, 'type' | 'status' | 'result'>;
const run = (exit_code: number, extra: Record<string, unknown> = {}): Partial => ({
  type: 'execute_test',
  status: 'completed',
  result: { exit_code, stdout: '', stderr: '', started_at: '', completed_at: '', execution_duration_ms: 1, hostname: 'h', ...extra },
});

describe('testOutcome', () => {
  it.each([
    [126, 'protected', 'Protected'],
    [105, 'protected', 'Protected'],
    [127, 'protected', 'Protected'],
    [101, 'unprotected', 'Unprotected'],
    [260, 'not-run', 'Not run'],
    [999, 'test-error', 'Test error'],
    [1, 'test-error', 'Test error'],
    [259, 'inconclusive', 'Inconclusive'],
    [0, 'inconclusive', 'Inconclusive'],
    [42, 'inconclusive', 'Inconclusive'],
  ])('exit %i is %s', (code, kind, label) => {
    expect(testOutcome(run(code))).toMatchObject({ kind, label });
  });

  it('treats an abandoned run (watchdog exit -1, status failed) as Run failed, with the reason', () => {
    const o = testOutcome({ ...run(-1, { error: 'Agent went offline during execution' }), status: 'failed' });
    expect(o).toMatchObject({ kind: 'run-failed', label: 'Run failed' });
    expect(o?.title).toContain('Agent went offline');
  });

  it('only colours Unprotected red; runs that never happened are warnings', () => {
    expect(testOutcome(run(101))?.tone).toBe('danger');
    for (const code of [260, 999]) expect(testOutcome(run(code))?.tone).toBe('warning');
    expect(testOutcome({ ...run(-1), status: 'failed' })?.tone).toBe('warning');
  });

  it('is null for commands and for tests still in progress', () => {
    expect(testOutcome({ ...run(1), type: 'execute_command' })).toBeNull();
    expect(testOutcome({ type: 'execute_test', status: 'executing', result: null })).toBeNull();
  });

  it('a bundle is Protected when any stage was blocked, naming the stage', () => {
    const o = testOutcome(run(999, { bundle_results: { bundle_category: 'intel-driven', controls: [
      { control_id: 'S1', exit_code: 101 }, { control_id: 'S2', exit_code: 126 }, { control_id: 'S3', exit_code: 999 },
    ] } }));
    expect(o).toMatchObject({ kind: 'protected' });
    expect(o?.title).toContain('stage 2 (S2)');
  });

  it('a bundle with no blocked stage but one that ran is Unprotected', () => {
    const o = testOutcome(run(1, { bundle_results: { bundle_category: 'intel-driven', controls: [
      { control_id: 'S1', exit_code: 101 }, { control_id: 'S2', exit_code: 0, skipped: true },
    ] } }));
    expect(o).toMatchObject({ kind: 'unprotected' });
  });

  it('a cyber-hygiene bundle follows its overall exit code and reports compliance', () => {
    const o = testOutcome(run(126, { bundle_results: { bundle_category: 'cyber-hygiene', controls: [
      { control_id: 'C1', exit_code: 126, compliant: true }, { control_id: 'C2', exit_code: 101, compliant: false },
    ] } }));
    expect(o).toMatchObject({ kind: 'protected' });
    expect(o?.title).toContain('1 of 2 controls compliant');
  });
});
