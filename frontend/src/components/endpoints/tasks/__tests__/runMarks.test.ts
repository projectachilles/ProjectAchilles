import { describe, it, expect } from 'vitest';
import type { AgentTask } from '@/types/agent';
import type { TaskGroup } from '@/types/agent';
import {
  BUCKET_META,
  BUCKET_ORDER,
  bucketSegments,
  compareWorstFirst,
  findRun,
  railTone,
  runForm,
  runIdOf,
  runTimeLabel,
  taskMarkTone,
} from '../runMarks';
import { clockTime } from '../taskFormat';

function task(id: string, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    agent_id: `agent-${id}`,
    agent_hostname: `HOST-${id}`,
    type: 'execute_test',
    priority: 5,
    status: 'completed',
    payload: { test_uuid: 'u', test_name: 'LockBit Chain', binary_name: 't.exe', execution_timeout: 300 },
    result: {
      exit_code: 126, stdout: '', stderr: '', execution_duration_ms: 700,
      started_at: '2026-10-28T12:00:00Z', completed_at: '2026-10-28T12:01:00Z', hostname: `HOST-${id}`,
    },
    notes: null,
    notes_history: [],
    created_at: '2026-10-28 12:00:00',
    assigned_at: null,
    completed_at: '2026-10-28 12:01:00',
    batch_id: 'batch-1',
    ...overrides,
  };
}
const withExit = (id: string, exit_code: number, more: Partial<AgentTask> = {}) =>
  task(id, { ...more, result: { ...task(id).result!, exit_code } });

const prot = withExit('p', 126);
const unprot = withExit('u', 101);
const unprot2 = withExit('u2', 101);
const running = task('r', { status: 'executing', result: null });

describe('runForm', () => {
  it('switches at 8 and 80 tasks', () => {
    expect([1, 8, 9, 80, 81, 1000].map(runForm)).toEqual(['named', 'named', 'squares', 'squares', 'bar', 'bar']);
  });
});

describe('BUCKET_ORDER', () => {
  it('puts unprotected first: red always leads', () => {
    expect(BUCKET_ORDER[0]).toBe('unprotected');
  });

  it('ranks every bucket exactly once', () => {
    expect([...BUCKET_ORDER].sort()).toEqual(Object.keys(BUCKET_META).sort());
  });
});

describe('bucketSegments', () => {
  it('counts tasks per bucket, in BUCKET_ORDER, leaving empty buckets out', () => {
    const segments = bucketSegments([prot, unprot, unprot2, running]);
    expect(segments[0]).toEqual({ key: 'unprotected', label: 'unprotected', tone: 'danger', count: 2 });
    expect(segments.slice(1)).toEqual(
      BUCKET_ORDER.filter((b) => b === 'in-progress' || b === 'protected').map((b) => ({
        key: b, label: BUCKET_META[b].label, tone: BUCKET_META[b].tone, count: 1,
      })),
    );
  });

  it('is empty for no tasks', () => {
    expect(bucketSegments([])).toEqual([]);
  });
});

describe('compareWorstFirst', () => {
  it('orders by bucket, then by hostname', () => {
    const protA = withExit('protA', 126, { agent_hostname: 'HOST-a' });
    const protB = withExit('protB', 126, { agent_hostname: 'HOST-b' });
    const unprotA = withExit('unprotA', 101, { agent_hostname: 'HOST-z' });
    expect([protB, unprotA, protA].sort(compareWorstFirst).map((t) => t.id)).toEqual(['unprotA', 'protA', 'protB']);
  });

  it('puts a task without a hostname last within its bucket', () => {
    const named = withExit('named', 126, { agent_hostname: 'HOST-z' });
    const noHost = withExit('nohost', 126, { agent_hostname: undefined });
    expect([noHost, named].sort(compareWorstFirst).map((t) => t.id)).toEqual(['named', 'nohost']);
  });

  it('gives two tasks of one host a stable order (a retry)', () => {
    const first = withExit('a1', 126, { agent_hostname: 'HOST-a' });
    const retry = withExit('a2', 126, { agent_hostname: 'HOST-a' });
    expect([retry, first].sort(compareWorstFirst).map((t) => t.id)).toEqual(['a1', 'a2']);
  });
});

describe('railTone', () => {
  const expired = task('x', { status: 'expired', result: null }); // never ran: a grey mark
  const testError = withExit('e', 999); // an amber mark

  it('is info while anything is in progress', () => {
    expect(railTone([prot, unprot, running])).toBe('info');
  });

  it('is the worst colour among the run\'s marks: red, then amber, then grey, then green', () => {
    expect(railTone([prot, unprot, testError, expired])).toBe('danger');
    expect(railTone([prot, testError, expired])).toBe('warning');
    expect(railTone([prot, expired])).toBe('muted');
    expect(railTone([prot])).toBe('accent');
  });

  it('matches the mark of a run with one task: a grey mark has a grey dot, not an amber one', () => {
    expect(railTone([expired])).toBe(taskMarkTone(expired));
    expect(railTone([expired])).toBe('muted');
  });

  it('is muted for an empty run', () => {
    expect(railTone([])).toBe('muted');
  });
});

describe('runs', () => {
  const group = (overrides: Partial<TaskGroup>): TaskGroup => ({
    batch_id: 'b1', type: 'execute_test', payload: prot.payload, created_at: '2026-10-28 12:00:00', created_by: 'u',
    agent_count: 1, status_counts: {}, tasks: [prot], ...overrides,
  });

  it('identifies a run by its run id, or by its batch when the server sends none (serverless, older backend)', () => {
    expect(runIdOf(group({ run_id: 'n:n1|execute_test|u' }))).toBe('n:n1|execute_test|u');
    expect(runIdOf(group({}))).toBe('b1');
  });

  it('finds a run by that id even when two runs share a batch', () => {
    const first = group({ run_id: 'n:n1|execute_test|u' });
    const retry = group({ run_id: 'n:n2|execute_test|u' });
    expect(findRun([first, retry], 'n:n2|execute_test|u')).toBe(retry);
    expect(findRun([first, retry], 'nope')).toBeUndefined();
  });

  it('shows one time for a run created in one go', () => {
    expect(runTimeLabel(group({}))).toBe(clockTime('2026-10-28 12:00:00'));
  });

  it('shows the first and last time for a run of several batches spread over time', () => {
    const tasks = [task('a', { created_at: '2026-10-28 13:10:00', batch_id: 'b1' }), task('b', { created_at: '2026-10-28 15:48:11', batch_id: 'b2' })];
    const label = runTimeLabel(group({ run_id: 'n:n1|execute_test|u', batch_ids: ['b2', 'b1'], created_at: '2026-10-28 15:48:11', tasks }));
    expect(label).toBe(`${clockTime('2026-10-28 13:10:00')} – ${clockTime('2026-10-28 15:48:11')}`);
  });

  it('keeps one time for a batch whose retry came later', () => {
    const tasks = [task('a', { created_at: '2026-10-28 12:00:00' }), task('a2', { created_at: '2026-10-28 12:30:00' })];
    expect(runTimeLabel(group({ batch_ids: ['b1'], tasks }))).toBe(clockTime('2026-10-28 12:00:00'));
  });
});

describe('taskMarkTone', () => {
  it('is the tone of the test outcome, the same colour as the detail badge', () => {
    expect(taskMarkTone(prot)).toBe('accent');
    expect(taskMarkTone(unprot)).toBe('danger');
    expect(taskMarkTone(withExit('e', 999))).toBe('warning'); // test error
    expect(taskMarkTone(withExit('i', 0))).toBe('muted'); // inconclusive: grey, not amber
  });

  it('is blue while the task is in progress', () => {
    expect(taskMarkTone(running)).toBe('info');
  });

  it('is grey for a test that expired before it ran', () => {
    expect(taskMarkTone(task('x', { status: 'expired', result: null }))).toBe('muted');
  });

  it('follows the lifecycle for other task types', () => {
    expect(taskMarkTone(withExit('c0', 0, { type: 'execute_command' }))).toBe('accent');
    expect(taskMarkTone(withExit('c1', 1, { type: 'execute_command' }))).toBe('danger');
  });
});
