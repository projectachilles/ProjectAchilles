import { describe, it, expect } from 'vitest';
import { classifyFailure, failureClassLabel } from '../taskFailureClassifier';
import type { AgentTask, TaskResult } from '@/types/agent';

function buildTask(overrides: { status?: AgentTask['status']; result?: Partial<TaskResult> | null } = {}): Pick<AgentTask, 'status' | 'result'> {
  const status = overrides.status ?? 'failed';
  const baseResult: TaskResult = {
    exit_code: -1,
    stdout: '',
    stderr: '',
    started_at: '',
    completed_at: '',
    execution_duration_ms: 0,
    hostname: '',
  };
  const result: TaskResult | null =
    overrides.result === null
      ? null
      : overrides.result === undefined
        ? baseResult
        : { ...baseResult, ...overrides.result };
  return { status, result };
}

describe('classifyFailure', () => {
  it('returns null for non-failed tasks', () => {
    expect(classifyFailure(buildTask({ status: 'completed' }))).toBeNull();
    expect(classifyFailure(buildTask({ status: 'pending' }))).toBeNull();
    expect(classifyFailure(buildTask({ status: 'expired' }))).toBeNull();
  });

  it('classifies the canonical Windows EDR-block as edr_blocked', () => {
    // Real string from tpsgl production task 60b6b1f8 (May 2026).
    const stderr = 'start binary: fork/exec C:\\F0\\tasks\\task-60b6b1f8-db4e-4300-9252-fa7258d4305f-2868866111\\078f1409-9f7b-4492-bb35-3fd596e85ce0.exe: Access is denied.';
    expect(classifyFailure(buildTask({ result: { stderr } }))).toBe('edr_blocked');
  });

  it('classifies edr_blocked when the marker is in result.error rather than stderr', () => {
    const error = 'start binary: fork/exec /tmp/F0/tasks/abc.exe: Access is denied.';
    expect(classifyFailure(buildTask({ result: { error } }))).toBe('edr_blocked');
  });

  it('classifies agent_offline failures', () => {
    expect(classifyFailure(buildTask({
      result: { stderr: 'Agent went offline during execution', error: 'Agent went offline during execution' },
    }))).toBe('agent_offline');
  });

  it('classifies execution_timeout failures', () => {
    expect(classifyFailure(buildTask({
      result: { stderr: 'Task exceeded maximum allowed execution time. The agent may have a stuck process.' },
    }))).toBe('execution_timeout');
  });

  it('classifies binary_integrity failures (SHA mismatch)', () => {
    expect(classifyFailure(buildTask({
      result: { stderr: 'SHA256 mismatch: expected abc, got def' },
    }))).toBe('binary_integrity');
  });

  it('classifies binary_integrity failures (download)', () => {
    expect(classifyFailure(buildTask({
      result: { stderr: 'download binary: context deadline exceeded' },
    }))).toBe('binary_integrity');
  });

  it('falls back to generic_failure when nothing matches', () => {
    expect(classifyFailure(buildTask({
      result: { stderr: 'unexpected error occurred' },
    }))).toBe('generic_failure');
  });

  it('treats a failed task with null result as generic_failure (not crash)', () => {
    expect(classifyFailure(buildTask({ result: null }))).toBe('generic_failure');
  });

  it('does NOT classify generic fork/exec failures (without "Access is denied") as edr_blocked', () => {
    // ENOENT-style — file genuinely missing, not blocked.
    expect(classifyFailure(buildTask({
      result: { stderr: 'fork/exec /missing/path: no such file or directory' },
    }))).toBe('generic_failure');
  });

  it('prefers edr_blocked over agent_offline when both markers are present', () => {
    // Defensive: if a future server message somehow combines the two,
    // the more actionable EDR signal wins.
    expect(classifyFailure(buildTask({
      result: { stderr: 'fork/exec X: Access is denied.\nAgent went offline during execution' },
    }))).toBe('edr_blocked');
  });

  it('exposes a label for every failure class', () => {
    const expectedClasses = ['edr_blocked', 'agent_offline', 'execution_timeout', 'binary_integrity', 'generic_failure'] as const;
    for (const cls of expectedClasses) {
      expect(failureClassLabel[cls]).toBeDefined();
      expect(failureClassLabel[cls].length).toBeGreaterThan(0);
    }
  });
});
