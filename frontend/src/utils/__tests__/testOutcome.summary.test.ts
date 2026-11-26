import { describe, it, expect } from 'vitest';
import type { AgentTask, TaskResult } from '@/types/agent';
import { stageMarks, taskBucket, testOutcome } from '../testOutcome';

// The task list gets light tasks (GET /tasks/grouped?detail=summary): of a
// result only what a list draws. A multi-stage test keeps control_id,
// exit_code and skipped of each stage; a cyber-hygiene bundle keeps two counts
// in place of its controls. Every verdict the list draws must come out the
// same from a light result as from the whole one. A rule that starts reading
// another field fails here.

const stage = (control_id: string, exit_code: number, extra: Record<string, unknown> = {}) => ({
  control_id, exit_code, skipped: false, compliant: exit_code !== 101,
  control_name: `Stage ${control_id}`, severity: 'high', techniques: ['T1486'], expected: 'blocked', actual: 'ran', details: 'x'.repeat(200),
  ...extra,
});

const result = (extra: Record<string, unknown>): TaskResult =>
  ({ exit_code: 101, stdout: 'out', stderr: 'err', execution_duration_ms: 1, started_at: 's', completed_at: 'c', hostname: 'h', ...extra }) as TaskResult;

type Loose = Record<string, unknown>;
const defined = (o: Loose): Loose => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The backend's rule (summarizeTaskResult in backend/src/services/agent/taskResultSummary.ts), restated. */
function lightOf(whole: TaskResult): TaskResult {
  const w = whole as unknown as Loose;
  const light: Loose = defined({
    summary: true, exit_code: w.exit_code, execution_duration_ms: w.execution_duration_ms,
    error: w.error, edr_terminated: w.edr_terminated, compacted_at: w.compacted_at,
  });
  const bundle = w.bundle_results as { bundle_category?: string; controls?: unknown } | undefined;
  if (bundle && typeof bundle === 'object') {
    const out: Loose = defined({ bundle_category: bundle.bundle_category });
    if (Array.isArray(bundle.controls) && bundle.controls.length > 0) {
      const usable = (bundle.controls as Loose[]).filter((c) => c && typeof c === 'object' && typeof c.control_id === 'string' && typeof c.exit_code === 'number');
      if (bundle.bundle_category === 'cyber-hygiene') {
        const evaluated = usable.filter((c) => !c.skipped);
        out.control_counts = {
          evaluated: evaluated.length,
          compliant: evaluated.filter((c) => c.compliant ?? [105, 126, 127].includes(c.exit_code as number)).length,
        };
      } else {
        out.controls = usable.map((c) => defined({ control_id: c.control_id, exit_code: c.exit_code, skipped: c.skipped }));
      }
    }
    light.bundle_results = out;
  }
  return light as unknown as TaskResult;
}

/** The controls the backend's test counts as 7 evaluated, 4 compliant (taskResultSummary.test.ts). An "exit code only" rule would count 3. */
const COUNTED = [
  stage('CH-1', 126, { compliant: true }),
  stage('CH-2', 101, { compliant: false }),
  stage('CH-3', 0, { skipped: true }),
  stage('CH-4', 0, { compliant: true }),
  stage('CH-5', 126, { compliant: undefined }),
  stage('CH-6', 101, { compliant: null }),
  stage('CH-7', 126, { compliant: false }),
  stage('CH-8', 0, { compliant: true }),
];

const CASES: [string, Partial<AgentTask>][] = [
  ['a test without stages, not blocked', { result: result({ exit_code: 101 }) }],
  ['a test without stages, blocked', { result: result({ exit_code: 126 }) }],
  ['a test that did not run', { result: result({ exit_code: 260 }) }],
  ['a chain blocked at its second stage', { result: result({ exit_code: 126, bundle_results: { bundle_category: 'intel-driven', controls: [stage('S1', 101), stage('S2', 126), stage('S3', 0, { skipped: true })] } }) }],
  ['a chain nothing blocked', { result: result({ bundle_results: { bundle_category: 'intel-driven', controls: [stage('S1', 101), stage('S2', 101)] } }) }],
  ['a chain whose stages errored', { result: result({ exit_code: 999, bundle_results: { bundle_category: 'intel-driven', controls: [stage('S1', 999), stage('S2', 1)] } }) }],
  ['a cyber-hygiene bundle', { result: result({ exit_code: 101, bundle_results: { bundle_category: 'cyber-hygiene', controls: [stage('CH-1', 126), stage('CH-2', 101), stage('CH-3', 0, { skipped: true }), stage('CH-4', 0, { compliant: true })] } }) }],
  ['a cyber-hygiene bundle with every kind of control', { result: result({ exit_code: 101, bundle_results: { bundle_category: 'cyber-hygiene', controls: COUNTED } }) }],
  ['a cyber-hygiene bundle with no usable control', { result: result({ exit_code: 126, bundle_results: { bundle_category: 'cyber-hygiene', controls: [{ control_id: 'no-code' }, null] } }) }],
  ['a cyber-hygiene bundle with an empty list of controls', { result: result({ exit_code: 126, bundle_results: { bundle_category: 'cyber-hygiene', controls: [] } }) }],
  ['a chain with an entry no verdict can use', { result: result({ bundle_results: { bundle_category: 'intel-driven', controls: [null, { control_id: 'x' }, stage('S1', 126)] } }) }],
  ['a run the watchdog failed', { status: 'failed', result: result({ exit_code: -1, error: 'Agent went offline during execution' }) }],
  ['a run an EDR stopped', { status: 'failed', result: result({ exit_code: -1, edr_terminated: { vendors: ['defender'], alert_ids: ['a'] } }) }],
  ['a command that failed', { type: 'execute_command', result: result({ exit_code: 2 }) }],
  ['a command that worked', { type: 'execute_command', result: result({ exit_code: 0 }) }],
];

describe('verdicts from a light result', () => {
  it.each(CASES)('%s: same outcome, stage marks and bucket as from the whole result', (_name, overrides) => {
    const whole = { type: 'execute_test', status: 'completed', ...overrides } as Pick<AgentTask, 'type' | 'status' | 'result'>;
    const light = { ...whole, result: lightOf(whole.result!) };

    expect(testOutcome(light)).toEqual(testOutcome(whole));
    expect(stageMarks(light)).toEqual(stageMarks(whole));
    expect(taskBucket(light)).toEqual(taskBucket(whole));
  });

  it('has cases that produce stage marks and both verdicts, so the comparison is not of nothing', () => {
    const outcomes = CASES.map(([, o]) => testOutcome({ type: 'execute_test', status: 'completed', ...o } as AgentTask)?.kind);
    expect(outcomes).toEqual(expect.arrayContaining(['protected', 'unprotected']));
    expect(CASES.some(([, o]) => stageMarks({ type: 'execute_test', status: 'completed', ...o } as AgentTask) !== null)).toBe(true);
  });

  it('reads the counts of a cyber-hygiene bundle: the same sentence as from its controls', () => {
    const whole = { type: 'execute_test', status: 'completed', result: result({ exit_code: 101, bundle_results: { bundle_category: 'cyber-hygiene', controls: COUNTED } }) } as AgentTask;
    const light = { ...whole, result: { summary: true, exit_code: 101, execution_duration_ms: 1, bundle_results: { bundle_category: 'cyber-hygiene', control_counts: { evaluated: 7, compliant: 4 } } } } as AgentTask;

    expect(testOutcome(whole)!.title).toMatch(/^4 of 7 controls compliant\./);
    expect(testOutcome(light)).toEqual(testOutcome(whole));
    expect(lightOf(whole.result!)).toEqual(light.result);
  });

  it('draws no stage marks for a light cyber-hygiene bundle', () => {
    const light = { type: 'execute_test', status: 'completed', result: { summary: true, exit_code: 126, bundle_results: { bundle_category: 'cyber-hygiene', control_counts: { evaluated: 2, compliant: 2 } } } } as AgentTask;
    expect(stageMarks(light)).toBeNull();
  });

  it('reads counts only from a light result: a whole result is judged as before', () => {
    const counts = { evaluated: 3, compliant: 2 };
    const whole = { type: 'execute_test', status: 'completed', result: result({ exit_code: 126, bundle_results: { bundle_category: 'cyber-hygiene', control_counts: counts } }) } as AgentTask;
    expect(testOutcome(whole)!.title).toBe('Exit 126: execution prevented.');
    expect(testOutcome({ ...whole, result: { ...whole.result!, summary: true } })!.title).toMatch(/^2 of 3 controls compliant\./);
  });

  it('ignores counts that are not numbers', () => {
    for (const control_counts of [{ evaluated: '3', compliant: 2 }, { evaluated: 3 }, 'nope', null]) {
      const light = { type: 'execute_test', status: 'completed', result: { summary: true, exit_code: 126, bundle_results: { bundle_category: 'cyber-hygiene', control_counts } } } as unknown as AgentTask;
      expect(testOutcome(light)!.title).toBe('Exit 126: execution prevented.');
    }
  });
});

