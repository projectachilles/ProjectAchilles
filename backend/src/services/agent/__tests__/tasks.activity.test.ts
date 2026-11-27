import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import { activityBuckets } from '../../analytics/activityBuckets.js';

// The Tasks activity strip (getTaskActivity) and a day selected on it (listTasksGrouped's
// created_from / created_to): the same tasks, by creation time, in the caller's time zone.

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});
vi.mock('../test-catalog.service.js', () => ({ getTestMetadata: () => null }));
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => '/mock-home' };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getAzureCredentials() { return null; }
  },
}));

const { listTasksGrouped } = await import('../tasks.service.js');
const { getTaskActivity, TASK_ACTIVITY_DAYS } = await import('../taskActivity.service.js');

const ALL = { kind: 'all' } as const;
const TZ = 'America/Santo_Domingo';
/** 27 Nov 2026, 12:00 in Santo Domingo (UTC-4). */
const NOW = Date.parse('2026-11-27T16:00:00.000Z');
const testPayload = (name: string) => JSON.stringify({ test_uuid: 't', test_name: name, binary_name: 't.exe', execution_timeout: 300 });

function agent(n: number, org = 'default'): string {
  const id = `agent-${n}`;
  if (!testDb.prepare('SELECT 1 FROM agents WHERE id = ?').get(id)) insertTestAgent(testDb, { id, hostname: `HOST-${n}`, org_id: org });
  return id;
}
interface Seed { id: string; created: string; agentNo?: number; org?: string; type?: string; status?: string; exit?: number | null; name?: string; batch?: string }
function seed({ id, created, agentNo = 1, org = 'default', type = 'execute_test', status = 'completed', exit = 101, name = 'Solo test', batch }: Seed) {
  insertTestTask(testDb, {
    id, agent_id: agent(agentNo, org), org_id: org, type, status, created_at: created, batch_id: batch ?? `b-${id}`,
    payload: type === 'execute_command' ? JSON.stringify({ command: name }) : testPayload(name),
  });
  if (exit !== null) {
    testDb.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(JSON.stringify({
      exit_code: exit, stdout: 'x'.repeat(10), stderr: '', execution_duration_ms: 1, started_at: '', completed_at: '', hostname: `HOST-${agentNo}`, os: 'windows', arch: 'amd64',
    }), id);
  }
}
/** created_at as SQLite writes it: datetime('now'), UTC, whole seconds. */
const utc = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ');

beforeEach(() => {
  testDb = createTestDatabase();
});

describe('getTaskActivity', () => {
  it('counts the last 30 days, a bucket per local day, oldest first', () => {
    const result = getTaskActivity({}, TZ, NOW);
    const expected = activityBuckets(NOW - TASK_ACTIVITY_DAYS * 86_400_000, NOW, TZ).buckets;

    expect(TASK_ACTIVITY_DAYS).toBe(30);
    expect(result.interval).toBe('day');
    expect(result.timeZone).toBe(TZ);
    expect(result.buckets.map((b) => [b.from, b.to])).toEqual(expected.map((b) => [new Date(b.from).toISOString(), new Date(b.to).toISOString()]));
    // Local midnight is 04:00 UTC.
    expect(result.buckets[result.buckets.length - 1].from).toBe('2026-11-27T04:00:00.000Z');
    expect(result.buckets.every((b) => b.protected + b.unprotected + b.noVerdict + b.inProgress + b.completed + b.failed === 0)).toBe(true);
  });

  it('counts each task by the run timeline\'s buckets', () => {
    const day = '2026-11-26T15:00:00.000Z';
    seed({ id: 'p', created: utc(day), exit: 126 });
    seed({ id: 'u', created: utc(day), exit: 101 });
    seed({ id: 'n', created: utc(day), exit: 999 });
    seed({ id: 'r', created: utc(day), status: 'executing', exit: null });
    seed({ id: 'c', created: utc(day), type: 'execute_command', exit: 0, name: 'whoami' });
    seed({ id: 'f', created: utc(day), type: 'execute_command', exit: 1, name: 'whoami' });
    seed({ id: 'w', created: utc(day), status: 'failed', exit: -1 });

    const bucket = getTaskActivity({}, TZ, NOW).buckets.find((b) => b.from === '2026-11-26T04:00:00.000Z')!;

    expect(bucket).toMatchObject({ protected: 1, unprotected: 1, noVerdict: 2, inProgress: 1, completed: 1, failed: 1 });
  });

  it('counts a run the EDR stopped by killing the agent as protected, as the run timeline does', () => {
    // A failed task: its result is read too (the EDR reconciliation pass writes edr_terminated into it).
    seed({ id: 'killed', created: '2026-11-26 15:00:00', status: 'failed', exit: null });
    testDb.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(JSON.stringify({
      exit_code: -1, stdout: '', stderr: '', error: 'Agent went offline during execution',
      edr_terminated: { vendors: ['defender'], alert_ids: ['a'], killed_at: '', reconciled_at: '' },
    }), 'killed');

    const bucket = getTaskActivity({}, TZ, NOW).buckets.find((b) => b.from === '2026-11-26T04:00:00.000Z')!;

    expect(bucket).toMatchObject({ protected: 1, noVerdict: 0 });
  });

  it('puts a task created at local midnight in that day only', () => {
    seed({ id: 'before', created: '2026-11-26 03:59:59' });
    seed({ id: 'at', created: '2026-11-26 04:00:00' });

    const buckets = getTaskActivity({}, TZ, NOW).buckets;
    const total = (from: string) => {
      const b = buckets.find((x) => x.from === from)!;
      return b.protected + b.unprotected + b.noVerdict + b.inProgress + b.completed + b.failed;
    };

    expect(total('2026-11-25T04:00:00.000Z')).toBe(1);
    expect(total('2026-11-26T04:00:00.000Z')).toBe(1);
  });

  it('counts only the caller\'s organization', () => {
    seed({ id: 'mine', created: '2026-11-26 15:00:00', org: 'org-a', agentNo: 1 });
    seed({ id: 'theirs', created: '2026-11-26 15:00:00', org: 'org-b', agentNo: 2 });

    const total = (org?: string) => getTaskActivity({ org_id: org }, TZ, NOW).buckets.reduce((n, b) => n + b.unprotected, 0);

    expect(total('org-a')).toBe(1);
    expect(total('org-b')).toBe(1);
    expect(total(undefined)).toBe(2);
  });

  it('follows the type pills and the search box, as the list does', () => {
    seed({ id: 'test', created: '2026-11-26 15:00:00', name: 'Ransomware', agentNo: 1 });
    seed({ id: 'cmd', created: '2026-11-26 15:00:00', type: 'execute_command', exit: 0, name: 'whoami', agentNo: 2 });

    const totals = (filters: Parameters<typeof getTaskActivity>[0]) =>
      getTaskActivity(filters, TZ, NOW).buckets.reduce((n, b) => n + b.unprotected + b.completed, 0);

    expect(totals({ types: ['execute_test'] })).toBe(1);
    expect(totals({ types: ['execute_command'] })).toBe(1);
    expect(totals({ search: 'Ransom' })).toBe(1);
    expect(totals({ search: 'HOST-2' })).toBe(1);
    // The same tasks the list would show with those filters.
    expect(listTasksGrouped({ search: 'Ransom' }, ALL).total).toBe(1);
  });

  it('leaves out what is older than the first day, and newer than now', () => {
    seed({ id: 'old', created: '2026-10-01 12:00:00' });
    seed({ id: 'future', created: '2026-11-28 12:00:00' });

    expect(getTaskActivity({}, TZ, NOW).buckets.reduce((n, b) => n + b.unprotected, 0)).toBe(0);
  });

  it('reads the tasks again for every question, so the page sees its own retry or cancel at once', () => {
    seed({ id: 'one', created: '2026-11-26 15:00:00' });
    expect(getTaskActivity({}, TZ, NOW).buckets.reduce((n, b) => n + b.unprotected, 0)).toBe(1);
    seed({ id: 'two', created: '2026-11-26 15:00:01' });

    expect(getTaskActivity({}, TZ, NOW + 1_000).buckets.reduce((n, b) => n + b.unprotected, 0)).toBe(2);
  });
});

describe('listTasksGrouped with a stretch of creation time', () => {
  const DAY = { created_from: '2026-11-26T04:00:00.000Z', created_to: '2026-11-27T03:59:59.999Z' };

  it('lists the tasks created in it, both ends included', () => {
    seed({ id: 'before', created: '2026-11-26 03:59:59' });
    seed({ id: 'first', created: '2026-11-26 04:00:00' });
    seed({ id: 'last', created: '2026-11-27 03:59:59' });
    seed({ id: 'after', created: '2026-11-27 04:00:00' });

    const result = listTasksGrouped(DAY, ALL);

    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id)).sort()).toEqual(['first', 'last']);
    expect(result.total).toBe(2);
  });

  it('lists only that day\'s tasks of a run that spans two days', () => {
    seed({ id: 'late', created: '2026-11-26 23:00:00', batch: 'run-1', agentNo: 1 });
    seed({ id: 'next-day', created: '2026-11-27 05:00:00', batch: 'run-1', agentNo: 2 });

    const result = listTasksGrouped(DAY, ALL);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].tasks.map((t) => t.id)).toEqual(['late']);
  });

  it('counts the type pills within it', () => {
    seed({ id: 'in', created: '2026-11-26 15:00:00' });
    seed({ id: 'out', created: '2026-11-20 15:00:00' });
    seed({ id: 'cmd', created: '2026-11-26 16:00:00', type: 'execute_command', exit: 0, name: 'whoami' });

    expect(listTasksGrouped(DAY, ALL).type_counts).toEqual({ execute_test: 1, execute_command: 1 });
  });

  it('takes one end alone', () => {
    seed({ id: 'old', created: '2026-11-20 15:00:00' });
    seed({ id: 'new', created: '2026-11-26 15:00:00' });

    expect(listTasksGrouped({ created_from: DAY.created_from }, ALL).total).toBe(1);
    expect(listTasksGrouped({ created_to: DAY.created_from }, ALL).total).toBe(1);
  });

  it('agrees with the strip: a bucket\'s two instants list what the bar counted', () => {
    seed({ id: 'a', created: '2026-11-26 04:00:00', exit: 126 });
    seed({ id: 'b', created: '2026-11-26 21:30:00', exit: 101, agentNo: 2 });
    seed({ id: 'c', created: '2026-11-27 03:59:59', type: 'execute_command', exit: 0, name: 'whoami', agentNo: 3 });
    seed({ id: 'd', created: '2026-11-27 04:00:00', agentNo: 4 });
    const bucket = getTaskActivity({}, TZ, NOW).buckets.find((b) => b.from === DAY.created_from)!;
    const counted = bucket.protected + bucket.unprotected + bucket.noVerdict + bucket.inProgress + bucket.completed + bucket.failed;

    const listed = listTasksGrouped({ created_from: bucket.from, created_to: bucket.to }, ALL).groups.flatMap((g) => g.tasks);

    expect(counted).toBe(3);
    expect(listed).toHaveLength(counted);
  });
});
