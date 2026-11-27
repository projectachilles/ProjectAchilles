import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { taskBucket } from '../taskOutcome.js';
import type { TaskResult, TaskStatus, TaskType } from '../../../types/agent.js';

// The golden table is shared with the frontend's taskBucket (testOutcome.ts): one file, two readers.
interface BucketCase {
  name: string;
  type: TaskType;
  status: TaskStatus;
  exit?: number;
  edrKilled?: boolean;
  category?: string;
  stages?: Array<[number, boolean?]>;
  expected: string;
}
const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN: BucketCase[] = JSON.parse(readFileSync(resolve(here, 'fixtures/taskBucketGolden.json'), 'utf8')).cases;

function toTask(c: BucketCase): { type: TaskType; status: TaskStatus; result: TaskResult | null } {
  if (c.exit === undefined && !c.edrKilled) return { type: c.type, status: c.status, result: null };
  const result = {
    exit_code: c.exit ?? -1, stdout: '', stderr: '', execution_duration_ms: 1,
    started_at: '', completed_at: '', hostname: 'h', os: 'windows', arch: 'amd64',
    ...(c.edrKilled ? { edr_terminated: { vendors: ['defender'], alert_ids: ['a'], killed_at: '', reconciled_at: '' } } : {}),
    ...(c.stages ? { bundle_results: { bundle_category: c.category, controls: c.stages.map(([exit_code, skipped], i) => ({ control_id: `S${i + 1}`, exit_code, skipped: !!skipped })) } } : {}),
  } as unknown as TaskResult;
  return { type: c.type, status: c.status, result };
}

describe('taskBucket golden table', () => {
  it('has rows for every bucket', () => {
    expect(new Set(GOLDEN.map((c) => c.expected))).toEqual(new Set(['in-progress', 'protected', 'unprotected', 'no-verdict', 'completed', 'failed']));
  });

  it.each(GOLDEN.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(taskBucket(toTask(c))).toBe(c.expected);
  });
});
