import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import { initializeTables } from '../database.js';
import { backfillScheduleRuns } from '../scheduleRunBackfill.js';

// Tasks created before tasks.schedule_run existed carry no link to their
// schedule. Once, when the column is added, a past task is attributed to a
// schedule's run when it matches a per-machine schedule exactly: organization,
// creator, test, agent, and created between the schedule's creation and its
// last run. It is inference, kept narrow; anything that does not match, or
// matches two schedules, is left alone.

const TEST = 'test-uuid-pii';
const payload = (testUuid = TEST) => JSON.stringify({ test_uuid: testUuid, test_name: 'T', binary_name: 't.exe', execution_timeout: 300 });

let db: Database.Database;

interface Sched {
  id?: string; org?: string; creator?: string; test?: string; agents?: string[]; config?: Record<string, unknown>;
  tz?: string; created?: string; lastRun?: string | null; status?: string; type?: string;
}
function schedule({
  id = 'sch1', org = 'org-001', creator = 'user-1', test = TEST, agents = ['agent-001', 'agent-002', 'agent-003'],
  config = { date: '2026-11-18', time: '10:00', randomize_mode: 'per_machine' }, tz = 'UTC',
  created = '2026-11-17 12:00:00', lastRun = '2026-11-18T20:00:00.000Z', status = 'completed', type = 'once',
}: Sched = {}) {
  db.prepare(`
    INSERT INTO schedules (id, agent_ids, org_id, test_uuid, test_name, binary_name, schedule_type, schedule_config, timezone, last_run_at, status, created_by, created_at)
    VALUES (?, ?, ?, ?, 'T', 't.exe', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, JSON.stringify(agents), org, test, type, JSON.stringify(config), tz, lastRun, status, creator, created);
}

interface TaskSeed {
  id: string; agent?: string; org?: string; creator?: string; test?: string; created?: string; type?: string;
  notice?: string | null; original?: string | null; run?: string | null;
}
function task({ id, agent = 'agent-001', org = 'org-001', creator = 'user-1', test = TEST, created = '2026-11-18 14:00:00', type = 'execute_test', notice = null, original = null, run = null }: TaskSeed) {
  insertTestTask(db, { id, agent_id: agent, org_id: org, created_by: creator, created_at: created, type, batch_id: `batch-${id}`, payload: payload(test) });
  db.prepare('UPDATE tasks SET notice_id = ?, original_task_id = ?, schedule_run = ? WHERE id = ?').run(notice, original, run, id);
}
const runOf = (id: string) => (db.prepare('SELECT schedule_run FROM tasks WHERE id = ?').get(id) as { schedule_run: string | null }).schedule_run;

beforeEach(() => {
  db = createTestDatabase();
  for (const n of [1, 2, 3, 4]) insertTestAgent(db, { id: `agent-00${n}`, hostname: `host-${n}` });
});

describe('backfillScheduleRuns', () => {
  it('attributes the tasks a per-machine schedule created, one run per local day', () => {
    schedule();
    task({ id: 't1', agent: 'agent-001', created: '2026-11-18 13:10:00' });
    task({ id: 't2', agent: 'agent-002', created: '2026-11-18 15:48:00' });

    const out = backfillScheduleRuns(db);

    expect(out).toEqual({ attributed: 2, ambiguous: 0, retries: 0 });
    expect(runOf('t1')).toBe('sch1:2026-11-18');
    expect(runOf('t2')).toBe('sch1:2026-11-18');
  });

  it('uses the local date in the timezone of the schedule', () => {
    schedule({ tz: 'America/New_York', lastRun: '2026-11-18T23:00:00.000Z' });
    task({ id: 'late', created: '2026-11-18 02:30:00' }); // still the 17th in New York

    backfillScheduleRuns(db);

    expect(runOf('late')).toBe('sch1:2026-11-17');
  });

  it('gives a daily schedule one run per day', () => {
    schedule({ type: 'daily', config: { time: '10:00', randomize_mode: 'per_machine' }, status: 'active', created: '2026-11-10 08:00:00', lastRun: '2026-11-18T20:00:00.000Z' });
    task({ id: 'mon', created: '2026-11-16 11:00:00' });
    task({ id: 'tue', created: '2026-11-17 16:00:00' });

    backfillScheduleRuns(db);

    expect(runOf('mon')).toBe('sch1:2026-11-16');
    expect(runOf('tue')).toBe('sch1:2026-11-17');
  });

  it('still attributes the tasks of a schedule that was deleted afterwards', () => {
    schedule({ status: 'deleted' });
    task({ id: 't1' });
    backfillScheduleRuns(db);
    expect(runOf('t1')).toBe('sch1:2026-11-18');
  });

  it.each([
    ['announced by a notice (it already groups by that)', { notice: 'n1' }],
    ['created by someone else', { creator: 'user-2' }],
    ['for an agent the schedule does not cover', { agent: 'agent-004' }],
    ['of another test', { test: 'test-uuid-other' }],
    ['of another organization', { org: 'org-002' }],
    ['created before the schedule existed', { created: '2026-11-17 11:00:00' }],
    ['created after the schedule last ran', { created: '2026-11-18 20:05:00' }],
    ['that is not a security test', { type: 'execute_command' }],
    ['already stamped', { run: 'other:2026-11-18' }],
  ] as const)('leaves alone a task %s', (_why, overrides) => {
    schedule();
    task({ id: 'no', ...overrides });

    const out = backfillScheduleRuns(db);

    expect(out.attributed).toBe(0);
    expect(runOf('no')).toBe('run' in overrides ? 'other:2026-11-18' : null);
  });

  it('allows a minute of slack at both ends of the window', () => {
    schedule();
    task({ id: 'early', agent: 'agent-001', created: '2026-11-17 11:59:30' });
    task({ id: 'late', agent: 'agent-002', created: '2026-11-18 20:00:40' });
    expect(backfillScheduleRuns(db).attributed).toBe(2);
  });

  it.each([
    ['fires the whole fleet at one time', { config: { date: '2026-11-18', time: '10:00' } }],
    ['randomizes one time for the whole fleet', { config: { date: '2026-11-18', time: '10:00', randomize_mode: 'fleet' } }],
    ['never fired', { lastRun: null }],
    ['has a configuration that cannot be read', { config: 'not json' as never }],
  ] as const)('attributes nothing to a schedule that %s', (_why, overrides) => {
    schedule(overrides as Sched);
    if ((overrides as { config?: unknown }).config === 'not json') db.prepare("UPDATE schedules SET schedule_config = '{broken' WHERE id = 'sch1'").run();
    task({ id: 't1' });
    expect(backfillScheduleRuns(db).attributed).toBe(0);
    expect(runOf('t1')).toBeNull();
  });

  it('leaves a task that matches two schedules, and says how many', () => {
    schedule({ id: 'sch1' });
    schedule({ id: 'sch2' });
    task({ id: 'either' });
    task({ id: 'only1', agent: 'agent-002' });
    db.prepare("UPDATE schedules SET agent_ids = ? WHERE id = 'sch2'").run(JSON.stringify(['agent-001']));

    const out = backfillScheduleRuns(db);

    expect(out).toEqual({ attributed: 1, ambiguous: 1, retries: 0 });
    expect(runOf('either')).toBeNull();
    expect(runOf('only1')).toBe('sch1:2026-11-18');
  });

  it('gives a retry the run of its original, whenever it was created and whatever announced it', () => {
    schedule();
    task({ id: 'orig' });
    task({ id: 'retry', created: '2026-11-19 09:00:00', original: 'orig', notice: 'n9' });
    task({ id: 'stray-retry', created: '2026-11-19 09:00:00', original: 'not-attributed' });

    const out = backfillScheduleRuns(db);

    expect(out).toEqual({ attributed: 1, ambiguous: 0, retries: 1 });
    expect(runOf('retry')).toBe('sch1:2026-11-18');
    expect(runOf('stray-retry')).toBeNull();
  });

  it('does nothing, without error, on a database with no schedules', () => {
    task({ id: 't1' });
    expect(backfillScheduleRuns(db)).toEqual({ attributed: 0, ambiguous: 0, retries: 0 });
  });
});

describe('the attribution runs once, when the column is added', () => {
  it('runs on a database that did not have the column', () => {
    // Put the database back to how it was before this column existed.
    db.exec('DROP INDEX idx_tasks_schedule_run; ALTER TABLE tasks DROP COLUMN schedule_run;');
    schedule();
    insertTestTask(db, { id: 't1', agent_id: 'agent-001', org_id: 'org-001', created_by: 'user-1', created_at: '2026-11-18 14:00:00', batch_id: 'b1', payload: payload() });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTables(db);

    expect(runOf('t1')).toBe('sch1:2026-11-18');
    expect(log.mock.calls.flat().join('\n')).toContain('[Schedule-Run-Backfill] attributed=1 ambiguous=0 retries=0');
    log.mockRestore();
  });

  it('never runs again: a later start-up leaves a matching task alone', () => {
    schedule({ type: 'daily', config: { time: '10:00', randomize_mode: 'per_machine' }, status: 'active' });
    task({ id: 'manual-later' }); // e.g. a test started by hand inside a recurring schedule's window

    initializeTables(db);
    initializeTables(db);

    expect(runOf('manual-later')).toBeNull();
  });
});
