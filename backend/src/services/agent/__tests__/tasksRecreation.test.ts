import { describe, it, expect, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeTables } from '../database.js';

// migrateExecuteCommandType recreates the tasks table (new table, copy every
// row, drop the old one, rename) to widen its CHECK. It used to decide with a
// test insert that always failed on a foreign key, so it ran on EVERY start,
// and it ran as separate statements: two processes starting together could
// interleave and lose the table, and a failure after the drop lost the rows.

const open = (file = ':memory:') => {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};

/** How many times a call recreates the tasks table. */
function countRecreations(db: Database.Database, run: () => void): number {
  let count = 0;
  const exec = db.exec.bind(db);
  const spy = vi.spyOn(db, 'exec').mockImplementation(((sql: string) => {
    if (/CREATE TABLE tasks_new\b/.test(sql)) count += 1;
    return exec(sql);
  }) as never);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return count;
}

/** Puts back the tasks table of a release before 'execute_command' existed, with one row. */
function makeLegacy(db: Database.Database) {
  db.prepare(`INSERT OR IGNORE INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at, enrolled_by)
    VALUES ('a', 'o', 'h', 'linux', 'amd64', '1', 'x', 'active', 't', 'u')`).run();
  db.pragma('foreign_keys = OFF');
  db.exec(`
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
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by) VALUES ('kept', 'a', 'o', 'execute_test', '{}', 'u');
  `);
  db.pragma('foreign_keys = ON');
}

const taskIds = (db: Database.Database) => (db.prepare('SELECT id FROM tasks ORDER BY id').all() as { id: string }[]).map((r) => r.id);
const acceptsCommand = (db: Database.Database) => {
  try {
    db.prepare(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by) VALUES ('cmd', 'a', 'o', 'execute_command', '{}', 'u')`).run();
    db.prepare(`DELETE FROM tasks WHERE id = 'cmd'`).run();
    return true;
  } catch {
    return false;
  }
};

describe('the tasks table is recreated only when its CHECK is out of date', () => {
  it('is not recreated on a fresh database', () => {
    const db = open();
    expect(countRecreations(db, () => initializeTables(db))).toBe(0);
  });

  it('is not recreated on later starts', () => {
    const db = open();
    initializeTables(db);
    expect(countRecreations(db, () => initializeTables(db))).toBe(0);
    expect(countRecreations(db, () => initializeTables(db))).toBe(0);
  });

  it('is recreated once for a table that predates execute_command, keeping its rows', () => {
    const db = open();
    initializeTables(db);
    makeLegacy(db);
    expect(acceptsCommand(db)).toBe(false);

    expect(countRecreations(db, () => initializeTables(db))).toBe(1);

    expect(taskIds(db)).toEqual(['kept']);
    expect(acceptsCommand(db)).toBe(true);
    expect(countRecreations(db, () => initializeTables(db))).toBe(0);
  });

  it('leaves foreign keys on afterwards, whether or not it recreated the table', () => {
    const db = open();
    initializeTables(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    makeLegacy(db);
    initializeTables(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('a recreation is all or nothing', () => {
  it('leaves the tasks table and its rows as they were when it fails after the old table is dropped', () => {
    const db = open();
    initializeTables(db);
    makeLegacy(db);
    // A view on tasks makes the final rename fail: by then the old table is already dropped.
    db.exec('CREATE VIEW task_ids AS SELECT id FROM tasks');

    expect(() => initializeTables(db)).toThrow();

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'tasks%'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['tasks']);
    expect(taskIds(db)).toEqual(['kept']);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('two processes starting on one database', () => {
  let dir: string | undefined;
  const dbs: Database.Database[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    while (dbs.length) dbs.pop()!.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const openFile = () => {
    dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-recreation-'));
    const db = open(path.join(dir, 'agents.db'));
    dbs.push(db);
    return db;
  };

  /** True for the query the migration decides with. */
  const isDecision = (sql: string) => sql.includes('FROM sqlite_master') && sql.includes("name = 'tasks'");

  it('the second does not recreate the table again after the first has, even if it decided to before', () => {
    const first = openFile();
    initializeTables(first);
    makeLegacy(first);
    const second = openFile();

    // The second process has just read the old CHECK and decided to recreate
    // the table. Before it gets the lock, the first does the whole job.
    const prepare = second.prepare.bind(second);
    let decisions = 0;
    vi.spyOn(second, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (!isDecision(sql)) return stmt;
      decisions += 1;
      if (decisions !== 1) return stmt;
      return {
        get: (...args: unknown[]) => {
          const row = stmt.get(...args);
          initializeTables(first);
          return row;
        },
      } as never;
    }) as never);

    const recreatedBySecond = countRecreations(second, () => initializeTables(second));

    expect(decisions).toBe(2); // once before the lock, once holding it
    expect(recreatedBySecond).toBe(0);
    expect(taskIds(second)).toEqual(['kept']);
    expect(acceptsCommand(second)).toBe(true);
  });

  it('holds the write lock from the start, so another process cannot write between its decision and its work', () => {
    const first = openFile();
    initializeTables(first);
    makeLegacy(first);
    const other = openFile();
    other.pragma('busy_timeout = 0');

    // The other process tries to write at the worst moment: right after this
    // one has decided, inside its transaction. Without the lock that write
    // would commit and end the recreation with SQLITE_BUSY_SNAPSHOT.
    const prepare = first.prepare.bind(first);
    let decisions = 0;
    let otherWrite: string | null = null;
    vi.spyOn(first, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (!isDecision(sql)) return stmt;
      decisions += 1;
      if (decisions !== 2) return stmt;
      return {
        get: (...args: unknown[]) => {
          const row = stmt.get(...args);
          try {
            other.prepare("UPDATE agents SET hostname = 'renamed' WHERE id = 'a'").run();
            otherWrite = 'committed';
          } catch (err) {
            otherWrite = (err as { code?: string }).code ?? 'failed';
          }
          return row;
        },
      } as never;
    }) as never);

    expect(() => initializeTables(first)).not.toThrow();

    expect(otherWrite).toBe('SQLITE_BUSY');
    expect(taskIds(first)).toEqual(['kept']);
    expect(acceptsCommand(first)).toBe(true);
  });
});

describe('a table that really is out of date', () => {
  const describeTasks = (db: Database.Database) => ({
    columns: (db.prepare('PRAGMA table_info(tasks)').all() as { name: string; type: string; notnull: number; dflt_value: string | null }[])
      .map((c) => `${c.name} ${c.type} notnull=${c.notnull} default=${c.dflt_value}`)
      .sort(),
    indexes: (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).sort(),
    triggers: (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'tasks'").all() as { name: string }[]).map((r) => r.name).sort(),
  });

  it('keeps every column, index and trigger the current table has (a column missing from optionalCols fails here)', () => {
    const db = open();
    initializeTables(db);
    const before = describeTasks(db);
    db.prepare(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at, enrolled_by)
      VALUES ('a', 'o', 'h', 'linux', 'amd64', '1', 'x', 'active', 't', 'u')`).run();
    db.prepare(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by, batch_id) VALUES ('kept', 'a', 'o', 'execute_test', '{"test_uuid":"u"}', 'u', 'b')`).run();

    // The same table as today, with every column it has now, but the CHECK of an old release.
    const current = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string }).sql;
    const legacySql = current.replace(/CREATE TABLE "?tasks"?/, 'CREATE TABLE tasks_old_shape').replace(", 'execute_command'", '');
    expect(legacySql).not.toContain('execute_command');
    const names = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name).join(', ');
    db.pragma('foreign_keys = OFF');
    db.exec(`${legacySql}; INSERT INTO tasks_old_shape (${names}) SELECT ${names} FROM tasks; DROP TABLE tasks; ALTER TABLE tasks_old_shape RENAME TO tasks;`);
    db.pragma('foreign_keys = ON');
    expect(acceptsCommand(db)).toBe(false);

    expect(countRecreations(db, () => initializeTables(db))).toBe(1);

    expect(describeTasks(db)).toEqual(before);
    expect(taskIds(db)).toEqual(['kept']);
    expect(acceptsCommand(db)).toBe(true);
  });

  it('is recognised whatever the spelling of its definition', () => {
    for (const [typeColumn, tableConstraint] of [
      [`type text not null check(type in ('execute_test', 'update_agent', 'uninstall'))`, ''],
      // The CHECK as a table constraint, quoted and spread over lines.
      [`"type" TEXT NOT NULL`, `,\n          CHECK ("type" IN ('execute_test',\n            'update_agent', 'uninstall'))`],
      // No CHECK at all.
      [`type TEXT NOT NULL`, ''],
    ]) {
      const db = open();
      initializeTables(db);
      db.pragma('foreign_keys = OFF');
      db.exec(`
        DROP TABLE tasks;
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, org_id TEXT NOT NULL,
          ${typeColumn},
          priority INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending',
          payload TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
          assigned_at TEXT, completed_at TEXT, ttl INTEGER NOT NULL DEFAULT 604800, created_by TEXT${tableConstraint}
        );
      `);
      db.pragma('foreign_keys = ON');

      expect(countRecreations(db, () => initializeTables(db))).toBe(1);
      expect(countRecreations(db, () => initializeTables(db))).toBe(0);
    }
  });
});

describe('a tasks_new table left by an interrupted upgrade of an earlier release', () => {
  it('is kept, and the server says so: it may hold the only copy of the tasks', () => {
    const db = open();
    initializeTables(db);
    db.exec('CREATE TABLE tasks_new (id TEXT PRIMARY KEY); INSERT INTO tasks_new (id) VALUES (\'only-copy\')');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    initializeTables(db);

    expect((db.prepare('SELECT id FROM tasks_new').all() as { id: string }[]).map((r) => r.id)).toEqual(['only-copy']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/tasks_new.*1 row/);
    warn.mockRestore();
  });

  it('says nothing on a database without one', () => {
    const db = open();
    initializeTables(db);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initializeTables(db);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('tasks_new');
    warn.mockRestore();
  });
});
