import { describe, it, expect } from 'vitest';
import { classifyTaskOutcome } from '../taskOutcome.js';
import type { TaskResult } from '../../../types/agent.js';

// ── Golden table ──────────────────────────────────────────────────
// Twin of frontend/src/utils/__tests__/testOutcome.test.ts (GOLDEN).
// Same rows, same expectations. Change BOTH tables together.
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

function toTask(c: GoldenCase) {
  const result = {
    exit_code: c.exit, stdout: '', stderr: '', execution_duration_ms: 1,
    started_at: '', completed_at: '', hostname: 'h', os: 'windows', arch: 'amd64',
    ...(c.edrKilled ? { edr_terminated: { vendors: ['defender'], alert_ids: ['a'], killed_at: '', reconciled_at: '' } } : {}),
    ...(c.stages ? { bundle_results: { bundle_category: c.category, controls: c.stages.map(([exit_code, skipped], i) => ({ control_id: `S${i + 1}`, exit_code, skipped: !!skipped })) } } : {}),
  } as unknown as TaskResult;
  return { type: 'execute_test' as const, status: c.status ?? 'completed', result };
}

describe('classifyTaskOutcome golden table', () => {
  it.each(GOLDEN.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(classifyTaskOutcome(toTask(c))).toBe(c.expected);
  });
});

describe('classifyTaskOutcome', () => {
  it('is null for other task types and unfinished runs', () => {
    expect(classifyTaskOutcome({ ...toTask({ name: '', exit: 1, expected: '' }), type: 'execute_command' })).toBeNull();
    expect(classifyTaskOutcome({ type: 'execute_test', status: 'executing', result: null })).toBeNull();
  });
});
