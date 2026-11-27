import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bucketResultSql, parseOutcomeResult, taskBucket } from '../taskOutcome.js';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';
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
  if ((c as { errorOnly?: boolean }).errorOnly) return { type: c.type, status: c.status, result: { error: 'Agent went offline during execution' } as unknown as TaskResult };
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

describe('bucketResultSql: the part of a result taskBucket reads', () => {
  // The activity strip reads 30 days of tasks: the whole result (a cyber-hygiene bundle's controls
  // carry names, expected and actual values) would be parsed for every finished one.
  it('gives every golden row the bucket of its whole result', () => {
    const db = createTestDatabase();
    const read = db.prepare(`SELECT ${bucketResultSql('t')} AS result FROM (SELECT ? AS result) t`);
    for (const c of GOLDEN) {
      const task = toTask(c);
      const row = read.get(task.result === null ? null : JSON.stringify(task.result)) as { result: string | null };
      expect([c.name, taskBucket({ ...task, result: parseOutcomeResult(row.result) })]).toEqual([c.name, c.expected]);
    }
  });

  it('leaves out a cyber-hygiene bundle\'s controls, and the detail of every control', () => {
    const db = createTestDatabase();
    const controls = Array.from({ length: 100 }, (_, i) => ({
      control_id: `CH-${i}`, name: `Control ${i}`, exit_code: 126, skipped: false, expected: 'x'.repeat(200), actual: 'y'.repeat(200), details: 'z'.repeat(300),
    }));
    const hygiene = JSON.stringify({ exit_code: 101, stdout: 'o'.repeat(5000), bundle_results: { bundle_category: 'cyber-hygiene', controls } });
    const attack = JSON.stringify({ exit_code: 999, bundle_results: { bundle_category: 'intel-driven', controls: [{ control_id: 'S1', exit_code: 126, skipped: false, details: 'd'.repeat(500) }] } });
    const read = db.prepare(`SELECT ${bucketResultSql('t')} AS result FROM (SELECT ? AS result) t`);

    const h = read.get(hygiene) as { result: string };
    const a = read.get(attack) as { result: string };

    expect(h.result.length).toBeLessThan(200);
    expect(JSON.parse(a.result)).toEqual({ exit_code: 999, edr_terminated: null, bundle_results: { bundle_category: 'intel-driven', controls: [{ control_id: 'S1', exit_code: 126, skipped: 0 }] } });
  });

  it('reads an unparseable result as no result', () => {
    const db = createTestDatabase();
    const row = db.prepare(`SELECT ${bucketResultSql('t')} AS result FROM (SELECT ? AS result) t`).get('{not json') as { result: string | null };
    expect(row.result).toBeNull();
  });
});
