import { describe, it, expect } from 'vitest';
import { summarizeTask, summarizeTaskPayload, summarizeTaskResult } from '../taskResultSummary.js';
import type { Task, TaskPayload, TaskResult } from '../../../types/agent.js';

const control = (id: string, extra: Record<string, unknown> = {}) => ({
  control_id: id,
  control_name: `Control ${id}`,
  validator: 'validator',
  exit_code: 126,
  compliant: true,
  severity: 'high',
  category: 'c',
  subcategory: 's',
  techniques: ['T1059'],
  tactics: ['execution'],
  expected: 'expected '.repeat(40),
  actual: 'actual '.repeat(40),
  details: 'details '.repeat(40),
  skipped: false,
  error_message: '',
  ...extra,
});

const full = (overrides: Record<string, unknown> = {}): TaskResult =>
  ({
    task_id: 't1',
    test_uuid: 'u1',
    exit_code: 101,
    stdout: 'out '.repeat(1000),
    stderr: 'err '.repeat(100),
    started_at: '2026-11-25T10:00:00.000Z',
    completed_at: '2026-11-25T10:00:09.000Z',
    execution_duration_ms: 9000,
    binary_sha256: 'abc',
    hostname: 'host-1',
    os: 'windows',
    arch: 'amd64',
    ...overrides,
  }) as unknown as TaskResult;

const bundle = (category: string, controls: unknown) => ({
  schema_version: '1', bundle_id: 'u1', bundle_name: 'Bundle', bundle_category: category, bundle_subcategory: 's',
  execution_id: 'e', started_at: 's', completed_at: 'c', total_controls: 3, passed_controls: 1, failed_controls: 1,
  endpoint_context: { hostname: 'host-1' }, controls,
});

describe('summarizeTaskResult', () => {
  it('is null for a task without a result', () => {
    expect(summarizeTaskResult(null)).toBeNull();
  });

  it('is exactly what a list draws of a plain result', () => {
    expect(summarizeTaskResult(full())).toEqual({ summary: true, exit_code: 101, execution_duration_ms: 9000 });
  });

  it('keeps the error, the EDR stop and the retention stamp when the result has them', () => {
    const kill = { vendors: ['defender'], alert_ids: ['a1'] };
    const result = full({ exit_code: -1, error: 'Agent went offline during execution', edr_terminated: kill, compacted_at: '2026-11-25T11:00:00.000Z' });
    expect(summarizeTaskResult(result)).toEqual({
      summary: true, exit_code: -1, execution_duration_ms: 9000,
      error: 'Agent went offline during execution', edr_terminated: kill, compacted_at: '2026-11-25T11:00:00.000Z',
    });
  });

  it('keeps the stages of a multi-stage test, in order, with what decides a verdict', () => {
    const result = full({ bundle_results: bundle('intel-driven', [control('S2', { exit_code: 101, compliant: false }), control('S1'), control('S3', { skipped: true, exit_code: 0 })]) });
    expect(summarizeTaskResult(result)!.bundle_results).toEqual({
      bundle_category: 'intel-driven',
      controls: [
        { control_id: 'S2', exit_code: 101, skipped: false },
        { control_id: 'S1', exit_code: 126, skipped: false },
        { control_id: 'S3', exit_code: 0, skipped: true },
      ],
    });
  });

  it('counts the controls of a cyber-hygiene bundle instead of sending them', () => {
    const controls = [
      control('CH-1'), // compliant by its flag
      control('CH-2', { exit_code: 101, compliant: false }),
      control('CH-3', { skipped: true, exit_code: 0 }), // not counted
      control('CH-4', { exit_code: 0, compliant: true }), // its flag decides, not its exit code
      control('CH-5', { exit_code: 126, compliant: undefined }), // no flag: a protected exit code counts
      control('CH-6', { exit_code: 101, compliant: null }),
      control('CH-7', { exit_code: 126, compliant: false }), // an explicit false stays false
    ];
    const result = full({ bundle_results: bundle('cyber-hygiene', controls) });
    expect(summarizeTaskResult(result)!.bundle_results).toEqual({
      bundle_category: 'cyber-hygiene',
      control_counts: { evaluated: 6, compliant: 3 },
    });
  });

  it('does not invent a field a stage does not have', () => {
    const result = full({ bundle_results: { bundle_category: 'intel-driven', controls: [{ control_id: 'S1', exit_code: 101 }] } });
    expect(summarizeTaskResult(result)!.bundle_results!.controls).toEqual([{ control_id: 'S1', exit_code: 101 }]);
  });

  it('ignores entries a verdict could not use, as the page does', () => {
    const odd = [null, 'text', 7, { control_id: 'no-code' }, { exit_code: 101 }, control('S1')];
    expect(summarizeTaskResult(full({ bundle_results: bundle('intel-driven', odd) }))!.bundle_results!.controls).toEqual([
      { control_id: 'S1', exit_code: 126, skipped: false },
    ]);
    expect(summarizeTaskResult(full({ bundle_results: bundle('cyber-hygiene', odd) }))!.bundle_results!.control_counts).toEqual({ evaluated: 1, compliant: 1 });
  });

  it('sends neither stages nor counts for a bundle without controls', () => {
    for (const controls of [undefined, null, 'nope', { control_id: 'S1' }, []]) {
      for (const category of ['cyber-hygiene', 'intel-driven']) {
        expect(summarizeTaskResult(full({ bundle_results: bundle(category, controls) }))!.bundle_results).toEqual({ bundle_category: category });
      }
    }
  });

  it('copes with a bundle that is not an object, and with one without a category', () => {
    expect(summarizeTaskResult(full({ bundle_results: 'nope' }))).not.toHaveProperty('bundle_results');
    expect(summarizeTaskResult(full({ bundle_results: { controls: [control('S1')] } }))!.bundle_results).toEqual({
      controls: [{ control_id: 'S1', exit_code: 126, skipped: false }],
    });
  });

  it('does not change the result it was given', () => {
    const result = full({ bundle_results: bundle('cyber-hygiene', [control('S1')]) });
    const before = JSON.stringify(result);
    summarizeTaskResult(result);
    expect(JSON.stringify(result)).toBe(before);
  });
});

describe('summarizeTaskPayload', () => {
  const payload = {
    test_uuid: 'u1', test_name: 'LockBit Chain', binary_name: 'u1.exe', binary_sha256: 'abc', binary_size: 10, execution_timeout: 300,
    arguments: ['-x'], metadata: { category: 'intel-driven', techniques: ['T1486'], tactics: ['impact'] }, test_version: { commit: 'c' },
  } as unknown as TaskPayload;

  it('keeps the names a list shows and drops the rest', () => {
    expect(summarizeTaskPayload(payload)).toEqual({ test_uuid: 'u1', test_name: 'LockBit Chain', binary_name: 'u1.exe', execution_timeout: 300 });
  });

  it('keeps the command of a command task: a run is named by it', () => {
    expect(summarizeTaskPayload({ ...payload, command: 'sc query AchillesAgent' })).toMatchObject({ command: 'sc query AchillesAgent' });
  });

  it('never carries environment variables', () => {
    expect(summarizeTaskPayload({ ...payload, env_vars: { SECRET: 'x' } })).not.toHaveProperty('env_vars');
  });
});

describe('summarizeTask', () => {
  it('leaves every other field of the task as it is', () => {
    const task = { id: 't1', agent_id: 'a', status: 'completed', notes: 'n', batch_id: 'b', payload: { test_uuid: 'u1', test_name: 'T', metadata: {} }, result: full() } as unknown as Task;
    const light = summarizeTask(task);
    expect(light).toEqual({ ...task, payload: { test_uuid: 'u1', test_name: 'T' }, result: { summary: true, exit_code: 101, execution_duration_ms: 9000 } });
  });
});
