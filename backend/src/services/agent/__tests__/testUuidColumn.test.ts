import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import { initializeTables } from '../database.js';

// The run-recency queries used to filter and group on
// json_extract(payload, '$.test_uuid'), which no index can serve: every call
// parsed the payload of every task, and better-sqlite3 blocks the whole
// backend meanwhile. tasks.test_uuid (kept by triggers) plus two covering
// indexes let both queries run from an index alone.

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { getTestRunRecency, getAgentRunRecency } = await import('../testRunHistory.js');

const TEST_A = '11111111-1111-4111-8111-111111111111';
const TEST_B = '22222222-2222-4222-8222-222222222222';

const payload = (test: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ test_uuid: test, test_name: 'T', binary_name: 't.exe', ...extra });

const testUuidOf = (id: string) =>
  (testDb.prepare('SELECT test_uuid FROM tasks WHERE id = ?').get(id) as { test_uuid: string | null }).test_uuid;

const names = (kind: 'index' | 'trigger') =>
  (testDb.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = 'tasks'`).all(kind) as { name: string }[])
    .map((r) => r.name);

/** Every statement SQLite prepared for `fn`, as EXPLAIN QUERY PLAN text. */
function plansOf(fn: () => void): string[] {
  const plans: string[] = [];
  const realPrepare = testDb.prepare.bind(testDb);
  const spy = vi.spyOn(testDb, 'prepare').mockImplementation(((sql: string) => {
    const stmt = realPrepare(sql);
    const realAll = stmt.all.bind(stmt);
    stmt.all = ((...params: unknown[]) => {
      const rows = realPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
      plans.push(rows.map((r) => r.detail).join('\n'));
      return realAll(...params);
    }) as typeof stmt.all;
    return stmt;
  }) as typeof testDb.prepare);
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return plans;
}

/** The tasks table as it was before `test_uuid` existed. */
function dropTestUuid(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER trg_tasks_test_uuid_insert;
    DROP TRIGGER trg_tasks_test_uuid_update;
    DROP INDEX idx_tasks_test_recency;
    DROP INDEX idx_tasks_agent_recency;
    ALTER TABLE tasks DROP COLUMN test_uuid;
  `);
}

beforeEach(() => {
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'agent-001' });
});

describe('tasks.test_uuid', () => {
  it('is filled from the payload on insert, without the INSERT naming it', () => {
    insertTestTask(testDb, { id: 't1', payload: payload(TEST_A) });
    expect(testUuidOf('t1')).toBe(TEST_A);
  });

  it('follows a payload rewrite (env_vars are stripped after dispatch)', () => {
    insertTestTask(testDb, { id: 't1', payload: payload(TEST_A, { env_vars: { K: 'v' } }) });
    testDb.prepare('UPDATE tasks SET payload = ? WHERE id = ?').run(payload(TEST_B), 't1');
    expect(testUuidOf('t1')).toBe(TEST_B);
  });

  it('stays NULL for tasks that are not test runs', () => {
    insertTestTask(testDb, { id: 'cmd', type: 'execute_command', payload: JSON.stringify({ command: 'id', test_uuid: TEST_A }) });
    expect(testUuidOf('cmd')).toBeNull();
    expect(getTestRunRecency([TEST_A])).toEqual([]);
  });

  it('accepts a payload that is not JSON or has no usable test_uuid, and never matches it', () => {
    insertTestTask(testDb, { id: 'bad', payload: 'not json' });
    insertTestTask(testDb, { id: 'none', payload: '{}' });
    insertTestTask(testDb, { id: 'num', payload: '{"test_uuid": 7}' });
    expect([testUuidOf('bad'), testUuidOf('none'), testUuidOf('num')]).toEqual(['', '', '']);
    expect(getTestRunRecency([TEST_A])).toEqual([]);
    // They are still test tasks of the agent.
    expect(getAgentRunRecency()).toEqual([{ agent_id: 'agent-001', last_run_at: null, queued: true }]);
  });
});

describe('recency queries read an index, not every payload', () => {
  it('getTestRunRecency runs from idx_tasks_test_recency alone', () => {
    insertTestTask(testDb, { id: 't1', payload: payload(TEST_A) });
    for (const org of [undefined, 'org-001']) {
      const plans = plansOf(() => getTestRunRecency([TEST_A, TEST_B], org));
      expect(plans).toHaveLength(1);
      expect(plans[0]).toContain('USING COVERING INDEX idx_tasks_test_recency (type=? AND test_uuid=?)');
      expect(plans[0]).not.toMatch(/SCAN/);
    }
  });

  it('getAgentRunRecency runs from idx_tasks_agent_recency alone, already grouped', () => {
    insertTestTask(testDb, { id: 't1', payload: payload(TEST_A) });
    for (const org of [undefined, 'org-001']) {
      const plans = plansOf(() => getAgentRunRecency(org));
      expect(plans).toHaveLength(1);
      expect(plans[0]).toContain('USING COVERING INDEX idx_tasks_agent_recency (type=?)');
      expect(plans[0]).not.toMatch(/SCAN|TEMP B-TREE/);
    }
  });

  it('no longer parses payloads: a row whose payload was corrupted later still answers', () => {
    insertTestTask(testDb, { id: 't1', status: 'completed', payload: payload(TEST_A) });
    testDb.prepare("UPDATE tasks SET completed_at = '2026-10-20 09:30:00' WHERE id = 't1'").run();
    const sql: string[] = [];
    const realPrepare = testDb.prepare.bind(testDb);
    const spy = vi.spyOn(testDb, 'prepare').mockImplementation(((s: string) => {
      sql.push(s);
      return realPrepare(s);
    }) as typeof testDb.prepare);
    getTestRunRecency([TEST_A]);
    getAgentRunRecency();
    spy.mockRestore();
    expect(sql).toHaveLength(2);
    for (const s of sql) expect(s).not.toMatch(/json_|payload/);
  });
});

describe('tasks.test_uuid migration', () => {
  it('adds the column, backfills existing rows and gives the same answers as before', () => {
    dropTestUuid(testDb);
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
    insertTestTask(testDb, { id: 'a1', status: 'completed', payload: payload(TEST_A) });
    insertTestTask(testDb, { id: 'a2', agent_id: 'agent-002', status: 'pending', payload: payload(TEST_A) });
    insertTestTask(testDb, { id: 'b1', status: 'completed', payload: payload(TEST_B) });
    insertTestTask(testDb, { id: 'bad', status: 'completed', payload: 'not json' });
    insertTestTask(testDb, { id: 'cmd', type: 'execute_command', payload: '{"command":"id"}' });
    testDb.prepare("UPDATE tasks SET completed_at = '2026-10-20 09:30:00' WHERE status = 'completed'").run();

    // What the pre-column query returned for this data.
    const before = testDb.prepare(`
      SELECT agent_id, json_extract(payload, '$.test_uuid') AS test_uuid,
             MAX(CASE WHEN status = 'completed' OR (status = 'failed' AND es_ingested = 1) THEN completed_at END) AS last_run_at,
             MAX(CASE WHEN status IN ('pending', 'assigned', 'downloading', 'executing') THEN 1 ELSE 0 END) AS queued
      FROM tasks
      WHERE type = 'execute_test' AND json_valid(payload)
        AND json_extract(payload, '$.test_uuid') IN (?, ?)
      GROUP BY agent_id, json_extract(payload, '$.test_uuid')
    `).all(TEST_A, TEST_B) as Array<{ agent_id: string; test_uuid: string; last_run_at: string | null; queued: number }>;
    expect(before).toHaveLength(3);

    initializeTables(testDb);

    expect(['a1', 'a2', 'b1', 'bad', 'cmd'].map(testUuidOf)).toEqual([TEST_A, TEST_A, TEST_B, '', null]);
    const key = (r: { agent_id: string; test_uuid: string }) => `${r.agent_id}|${r.test_uuid}`;
    const after = getTestRunRecency([TEST_A, TEST_B]).sort((x, y) => key(x).localeCompare(key(y)));
    expect(after).toEqual(
      before
        .sort((x, y) => key(x).localeCompare(key(y)))
        .map((r) => ({
          agent_id: r.agent_id,
          test_uuid: r.test_uuid,
          last_run_at: r.last_run_at ? `${r.last_run_at.replace(' ', 'T')}Z` : null,
          queued: r.queued === 1,
        })),
    );
  });

  it('is idempotent: a second start changes nothing', () => {
    insertTestTask(testDb, { id: 't1', payload: payload(TEST_A) });
    initializeTables(testDb);
    initializeTables(testDb);
    expect(testUuidOf('t1')).toBe(TEST_A);
  });

  it('survives the legacy tasks table recreation, with its triggers and indexes', () => {
    // Rebuild tasks with the pre-execute_command CHECK, keeping test_uuid, so
    // migrateExecuteCommandType recreates the table (DROP TABLE drops the
    // triggers and indexes with it).
    testDb.pragma('foreign_keys = OFF');
    testDb.exec(`
      DROP TABLE tasks;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('execute_test', 'update_agent', 'uninstall')),
        priority INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'downloading', 'executing', 'completed', 'failed', 'expired')),
        payload TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        assigned_at TEXT,
        completed_at TEXT,
        ttl INTEGER NOT NULL DEFAULT 604800,
        created_by TEXT,
        es_ingested INTEGER NOT NULL DEFAULT 0,
        test_uuid TEXT DEFAULT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
      INSERT INTO tasks (id, agent_id, org_id, type, payload, test_uuid)
      VALUES ('old', 'agent-001', 'org-001', 'execute_test', '${payload(TEST_A)}', '${TEST_A}');
    `);
    testDb.pragma('foreign_keys = ON');
    expect(names('trigger')).toEqual([]);

    initializeTables(testDb);

    // The CHECK was widened, so the table really was recreated.
    expect(() => insertTestTask(testDb, { id: 'cmd', type: 'execute_command', payload: '{}' })).not.toThrow();
    expect(testUuidOf('old')).toBe(TEST_A);
    expect(names('trigger')).toEqual(
      expect.arrayContaining(['trg_tasks_test_uuid_insert', 'trg_tasks_test_uuid_update']),
    );
    expect(names('index')).toEqual(
      expect.arrayContaining(['idx_tasks_test_recency', 'idx_tasks_agent_recency']),
    );
    insertTestTask(testDb, { id: 'new', payload: payload(TEST_B) });
    expect(testUuidOf('new')).toBe(TEST_B);
  });
});
