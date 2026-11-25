import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

const { mockExistsSync, mockReadFileSync, mockStatSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockReadFileSync: vi.fn(),
  mockStatSync: vi.fn().mockReturnValue({ size: 1024 }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = { existsSync: mockExistsSync, readFileSync: mockReadFileSync, statSync: mockStatSync };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

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

// The task list groups by RUN: a batch, or the batches of one announced run
// (one pre-execution notice) of one test. A randomized or scheduled run makes
// one single-task batch per agent, hours apart, all under one notice; listed
// by batch, the same name filled dozens of rows and several pages.

const ALL = { kind: 'all' } as const;
const at = (minute: number) => `2026-10-23 10:${String(minute).padStart(2, '0')}:00`;
const payloadFor = (testUuid: string) => JSON.stringify({ test_uuid: testUuid, test_name: `Test ${testUuid}`, binary_name: 't.exe', execution_timeout: 300 });

function insertNotice(id: string) {
  testDb.prepare(`
    INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, release_at, pickup_deadline)
    VALUES (?, 'run', 'sent', 'run_now', 'UTC', 'u', '2026-10-23T09:00:00.000Z', '2026-10-23T09:05:00.000Z', '2026-10-24T09:05:00.000Z')
  `).run(id);
}

function agent(n: number): string {
  const id = `agent-${String(n).padStart(3, '0')}`;
  if (!testDb.prepare('SELECT 1 FROM agents WHERE id = ?').get(id)) insertTestAgent(testDb, { id, hostname: `host-${String(n).padStart(3, '0')}` });
  return id;
}

interface Seed { id: string; batch: string; agentNo: number; notice?: string | null; test?: string; created?: string; status?: string; result?: string | null }
function seed({ id, batch, agentNo, notice = null, test = 'test-a', created = at(0), status = 'completed', result = null }: Seed) {
  insertTestTask(testDb, { id, agent_id: agent(agentNo), batch_id: batch, created_at: created, status, payload: payloadFor(test) });
  testDb.prepare('UPDATE tasks SET notice_id = ?, result = ? WHERE id = ?').run(notice, result, id);
}

const ids = (g: { tasks: Array<{ id: string }> }) => g.tasks.map((t) => t.id).sort();

describe('listTasksGrouped groups by announced run', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it('makes one group of the single-task batches of one announced run of one test', () => {
    insertNotice('n1');
    seed({ id: 't1', batch: 'b1', agentNo: 1, notice: 'n1', created: at(1) });
    seed({ id: 't2', batch: 'b2', agentNo: 2, notice: 'n1', created: at(20) });
    seed({ id: 't3', batch: 'b3', agentNo: 3, notice: 'n1', created: at(45) });

    const out = listTasksGrouped({}, ALL);

    expect(out.total).toBe(1);
    expect(out.groups).toHaveLength(1);
    const run = out.groups[0];
    expect(ids(run)).toEqual(['t1', 't2', 't3']);
    expect(run.agent_count).toBe(3);
    expect(run.run_id.startsWith('n:n1|')).toBe(true);
    expect([...run.batch_ids].sort()).toEqual(['b1', 'b2', 'b3']);
    expect(run.batch_id).toBe('b3'); // the batch of the run's newest task
    expect(run.created_at).toBe(at(45));
    expect(Object.keys(run.notices ?? {})).toEqual(['n1']);
  });

  it('keeps two tests of one notice apart: an entry has one name', () => {
    insertNotice('n1');
    seed({ id: 'a1', batch: 'b1', agentNo: 1, notice: 'n1', test: 'test-a' });
    seed({ id: 'b1', batch: 'b2', agentNo: 1, notice: 'n1', test: 'test-b' });

    const out = listTasksGrouped({}, ALL);

    expect(out.total).toBe(2);
    expect(out.groups.map(ids)).toEqual(expect.arrayContaining([['a1'], ['b1']]));
    expect(new Set(out.groups.map((g) => g.run_id)).size).toBe(2);
  });

  it('never merges batches without a notice, even for the same test at the same second', () => {
    seed({ id: 't1', batch: 'b1', agentNo: 1 });
    seed({ id: 't2', batch: 'b2', agentNo: 2 });

    const out = listTasksGrouped({}, ALL);

    expect(out.total).toBe(2);
    for (const g of out.groups) {
      expect(g.run_id).toBe(`b:${g.batch_id}`);
      expect(g.batch_ids).toEqual([g.batch_id]);
      expect(g.tasks).toHaveLength(1);
    }
  });

  it('pages by run: a run larger than the page comes whole and counts once', () => {
    insertNotice('n1');
    for (let i = 1; i <= 30; i++) seed({ id: `r${i}`, batch: `rb${i}`, agentNo: i, notice: 'n1', created: at(i) });
    seed({ id: 'p1', batch: 'pb1', agentNo: 1, created: at(50) });
    seed({ id: 'p2', batch: 'pb2', agentNo: 2, created: at(51) });

    const out = listTasksGrouped({ limit: 25 }, ALL);

    expect(out.total).toBe(3);
    expect(out.groups).toHaveLength(3);
    expect(out.groups.map((g) => g.tasks.length)).toEqual([1, 1, 30]);
    expect(out.groups[2].agent_count).toBe(30);

    const second = listTasksGrouped({ limit: 1, offset: 2 }, ALL);
    expect(second.groups).toHaveLength(1);
    expect(second.groups[0].tasks).toHaveLength(30);
  });

  it('orders runs by their newest task', () => {
    insertNotice('n1');
    seed({ id: 'r1', batch: 'rb1', agentNo: 1, notice: 'n1', created: at(1) });
    seed({ id: 'plain', batch: 'pb1', agentNo: 3, created: at(10) });
    seed({ id: 'r2', batch: 'rb2', agentNo: 2, notice: 'n1', created: at(30) });

    const out = listTasksGrouped({}, ALL);

    expect(out.groups.map(ids)).toEqual([['r1', 'r2'], ['plain']]);
  });

  it('lists a merged run whole when a status filter matches one of its tasks', () => {
    insertNotice('n1');
    seed({ id: 'ok', batch: 'b1', agentNo: 1, notice: 'n1' });
    seed({ id: 'bad', batch: 'b2', agentNo: 2, notice: 'n1', status: 'failed' });
    seed({ id: 'other', batch: 'b3', agentNo: 3 });

    const out = listTasksGrouped({ status: 'failed' }, ALL);

    expect(out.total).toBe(1);
    expect(ids(out.groups[0])).toEqual(['bad', 'ok']);
    expect(out.groups[0].status_counts).toEqual({ completed: 1, failed: 1 });
  });

  it('with a breakdown filter lists only the matching tasks of a merged run, and still describes the whole run', () => {
    insertNotice('n1');
    const recent = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const res = (exit_code: number) => JSON.stringify({ exit_code, stdout: '', stderr: '', execution_duration_ms: 1 });
    seed({ id: 'blocked', batch: 'b1', agentNo: 1, notice: 'n1', created: recent, result: res(126) });
    seed({ id: 'ran', batch: 'b2', agentNo: 2, notice: 'n1', created: recent, result: res(101) });
    testDb.prepare('UPDATE tasks SET completed_at = ?').run(recent);

    const out = listTasksGrouped({ breakdown: 'exit:126' }, ALL);

    expect(out.total).toBe(1);
    expect(ids(out.groups[0])).toEqual(['blocked']);
    expect(out.groups[0].agent_count).toBe(2);
    expect(out.groups[0].status_counts).toEqual({ completed: 2 });
  });

  it('splits a batch whose retry was announced by its own notice: each run keeps its own task', () => {
    insertNotice('n1');
    insertNotice('n2');
    seed({ id: 'first', batch: 'b1', agentNo: 1, notice: 'n1', created: at(1) });
    seed({ id: 'retry', batch: 'b1', agentNo: 1, notice: 'n2', created: at(30) });

    const out = listTasksGrouped({}, ALL);

    expect(out.total).toBe(2);
    expect(out.groups.map(ids)).toEqual([['retry'], ['first']]);
    expect(out.groups.map((g) => g.batch_ids)).toEqual([['b1'], ['b1']]);
    expect(new Set(out.groups.map((g) => g.run_id)).size).toBe(2);
  });

  it('never puts two organizations in one run, even under one notice', () => {
    // A notice written before notices were per-organization could announce tasks of several organizations.
    insertNotice('n1');
    seed({ id: 'mine', batch: 'b1', agentNo: 1, notice: 'n1' });
    seed({ id: 'theirs', batch: 'b2', agentNo: 2, notice: 'n1' });
    testDb.prepare("UPDATE tasks SET org_id = 'org-002' WHERE id = 'theirs'").run();

    const mine = listTasksGrouped({ org_id: 'org-001' }, { kind: 'org', orgId: 'org-001' });
    expect(mine.total).toBe(1);
    expect(mine.groups.map(ids)).toEqual([['mine']]);
    expect(mine.groups[0].agent_count).toBe(1);

    const everyone = listTasksGrouped({}, ALL);
    expect(everyone.total).toBe(2);
    expect(everyone.groups.map(ids)).toEqual(expect.arrayContaining([['mine'], ['theirs']]));
  });

  it('lists a merged run whole when only one of its agents or hostnames matches the filter', () => {
    insertNotice('n1');
    seed({ id: 't1', batch: 'b1', agentNo: 1, notice: 'n1' });
    seed({ id: 't2', batch: 'b2', agentNo: 2, notice: 'n1' });
    seed({ id: 'other', batch: 'b3', agentNo: 3 });

    const byAgent = listTasksGrouped({ agent_id: 'agent-002' }, ALL);
    expect(byAgent.total).toBe(1);
    expect(ids(byAgent.groups[0])).toEqual(['t1', 't2']);

    const bySearch = listTasksGrouped({ search: 'host-001' }, ALL);
    expect(bySearch.total).toBe(1);
    expect(ids(bySearch.groups[0])).toEqual(['t1', 't2']);
  });

  it('gives a task without a batch a run of its own instead of failing the whole list', () => {
    seed({ id: 'loose', batch: 'tmp', agentNo: 1 });
    seed({ id: 'normal', batch: 'b1', agentNo: 2, created: at(5) });
    testDb.prepare("UPDATE tasks SET batch_id = NULL WHERE id = 'loose'").run();

    const out = listTasksGrouped({}, ALL);

    expect(out.total).toBe(2);
    expect(out.groups.map(ids)).toEqual([['normal'], ['loose']]);
    expect(out.groups[1].run_id).toBe('b:loose');
  });

  it('reports the total on a page past the end', () => {
    seed({ id: 't1', batch: 'b1', agentNo: 1 });
    seed({ id: 't2', batch: 'b2', agentNo: 2 });

    const out = listTasksGrouped({ limit: 25, offset: 50 }, ALL);

    expect(out.groups).toEqual([]);
    expect(out.total).toBe(2);
  });

  it('keeps a multi-agent batch with a notice as one group', () => {
    insertNotice('n1');
    seed({ id: 't1', batch: 'b1', agentNo: 1, notice: 'n1' });
    seed({ id: 't2', batch: 'b1', agentNo: 2, notice: 'n1' });

    const out = listTasksGrouped({}, ALL);

    expect(out.total).toBe(1);
    expect(out.groups[0].batch_id).toBe('b1');
    expect(out.groups[0].batch_ids).toEqual(['b1']);
    expect(out.groups[0].agent_count).toBe(2);
  });
});
