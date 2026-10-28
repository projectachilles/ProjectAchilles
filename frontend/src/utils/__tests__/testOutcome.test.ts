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

  it('an EDR-killed run (reconciled watchdog failure) is Protected, like campaigns and Analytics', () => {
    const o = testOutcome({
      ...run(-1, { error: 'Agent went offline during execution', edr_terminated: { vendors: ['crowdstrike', 'defender'], alert_ids: ['a1'] } }),
      status: 'failed',
    });
    expect(o).toMatchObject({ kind: 'protected', label: 'Protected', tone: 'accent' });
    expect(o?.title).toBe('Stopped by CrowdStrike and Defender: the EDR terminated the agent and the test. Stages not reported.');
  });

  it('only colours Unprotected red; runs that never happened are warnings', () => {
    expect(testOutcome(run(101))?.tone).toBe('danger');
    for (const code of [260, 999]) expect(testOutcome(run(code))?.tone).toBe('warning');
    expect(testOutcome({ ...run(-1), status: 'failed' })?.tone).toBe('warning');
  });

  it('says what the outcome is based on: the exit code, the stages, or an EDR kill', () => {
    expect(testOutcome(run(126))?.basis).toBe('exit');
    expect(testOutcome(run(999, { bundle_results: { bundle_category: 'intel-driven', controls: [
      { control_id: 'S1', exit_code: 101 }, { control_id: 'S2', exit_code: 999 },
    ] } }))?.basis).toBe('stages');
    // a bundle with no blocked or unblocked stage falls back to its final exit
    expect(testOutcome(run(999, { bundle_results: { bundle_category: 'intel-driven', controls: [
      { control_id: 'S1', exit_code: 999 },
    ] } }))?.basis).toBe('exit');
    expect(testOutcome({ ...run(-1, { edr_terminated: { vendors: ['defender'], alert_ids: [] } }), status: 'failed' })?.basis).toBe('edr');
    expect(testOutcome({ ...run(-1), status: 'failed' })?.basis).toBe('exit');
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

// ── Golden table ──────────────────────────────────────────────────
// Twin of backend/src/services/outcomes/__tests__/taskOutcome.test.ts (GOLDEN),
// which drives the Tasks page tiles. Same rows, same expectations. Change BOTH
// tables together.
interface GoldenCase {
  name: string;
  status?: 'completed' | 'failed';
  exit: number;
  edrKilled?: boolean;
  category?: string;
  stages?: Array<[number, boolean?]>; // [exit_code, skipped]
  expected: string;
}

const GOLDEN: GoldenCase[] = [
  { name: 'exit 126 → protected', exit: 126, expected: 'protected' },
  { name: 'exit 105 → protected', exit: 105, expected: 'protected' },
  { name: 'exit 127 → protected', exit: 127, expected: 'protected' },
  { name: 'exit 101 → unprotected', exit: 101, expected: 'unprotected' },
  { name: 'exit 260 → not-run', exit: 260, expected: 'not-run' },
  { name: 'exit 999 → test-error', exit: 999, expected: 'test-error' },
  { name: 'exit 1 → test-error', exit: 1, expected: 'test-error' },
  { name: 'exit 259 → inconclusive', exit: 259, expected: 'inconclusive' },
  { name: 'exit 0 → inconclusive', exit: 0, expected: 'inconclusive' },
  { name: 'unknown exit → inconclusive', exit: 42, expected: 'inconclusive' },
  { name: 'watchdog failure → run-failed', status: 'failed', exit: -1, expected: 'run-failed' },
  { name: 'EDR-killed watchdog failure → protected', status: 'failed', exit: -1, edrKilled: true, expected: 'protected' },
  { name: 'bundle with a blocked stage → protected', exit: 999, category: 'intel-driven', stages: [[101], [126], [999]], expected: 'protected' },
  { name: 'bundle, no block, one ran → unprotected', exit: 1, category: 'intel-driven', stages: [[101], [0, true]], expected: 'unprotected' },
  { name: 'bundle, skipped blocked stage does not count', exit: 999, category: 'intel-driven', stages: [[126, true], [999]], expected: 'test-error' },
  { name: 'cyber-hygiene follows the overall exit', exit: 101, category: 'cyber-hygiene', stages: [[126], [101]], expected: 'unprotected' },
];

function toTask(c: GoldenCase): Partial {
  return {
    type: 'execute_test',
    status: c.status ?? 'completed',
    result: {
      exit_code: c.exit, stdout: '', stderr: '', execution_duration_ms: 1, started_at: '', completed_at: '', hostname: 'h',
      ...(c.edrKilled ? { edr_terminated: { vendors: ['defender'], alert_ids: ['a'] } } : {}),
      ...(c.stages ? { bundle_results: { bundle_category: c.category, controls: c.stages.map(([exit_code, skipped], i) => ({ control_id: `S${i + 1}`, exit_code, skipped: !!skipped })) } } : {}),
    },
  };
}

describe('testOutcome golden table (shared with the backend tiles)', () => {
  it.each(GOLDEN.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(testOutcome(toTask(c))?.kind).toBe(c.expected);
  });
});
