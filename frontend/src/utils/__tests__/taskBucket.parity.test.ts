import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { taskBucket } from '../testOutcome';
import type { AgentTask } from '@/types/agent';

// The backend counts the Tasks activity strip by its own taskBucket (taskOutcome.ts). This reads the
// one golden table both are held to, so a colour on the strip means what it means on the run marks.
interface BucketCase {
  name: string;
  type: AgentTask['type'];
  status: AgentTask['status'];
  exit?: number;
  edrKilled?: boolean;
  category?: string;
  stages?: Array<[number, boolean?]>;
  expected: string;
}
const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN: BucketCase[] = JSON.parse(
  readFileSync(resolve(here, '../../../../backend/src/services/outcomes/__tests__/fixtures/taskBucketGolden.json'), 'utf8'),
).cases;

function toTask(c: BucketCase): Pick<AgentTask, 'type' | 'status' | 'result'> {
  if ((c as { errorOnly?: boolean }).errorOnly) return { type: c.type, status: c.status, result: { error: 'Agent went offline during execution' } } as unknown as Pick<AgentTask, 'type' | 'status' | 'result'>;
  if (c.exit === undefined && !c.edrKilled) return { type: c.type, status: c.status, result: null } as Pick<AgentTask, 'type' | 'status' | 'result'>;
  return {
    type: c.type,
    status: c.status,
    result: {
      exit_code: c.exit ?? -1, stdout: '', stderr: '', execution_duration_ms: 1, started_at: '', completed_at: '', hostname: 'h',
      ...(c.edrKilled ? { edr_terminated: { vendors: ['defender'], alert_ids: ['a'] } } : {}),
      ...(c.stages ? { bundle_results: { bundle_category: c.category, controls: c.stages.map(([exit_code, skipped], i) => ({ control_id: `S${i + 1}`, exit_code, skipped: !!skipped })) } } : {}),
    },
  } as unknown as Pick<AgentTask, 'type' | 'status' | 'result'>;
}

describe('taskBucket: the same answers as the backend\'s', () => {
  it('reads the shared table', () => {
    expect(GOLDEN.length).toBeGreaterThan(20);
  });

  it.each(GOLDEN.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(taskBucket(toTask(c))).toBe(c.expected);
  });
});
