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

  it('the second does not recreate the table again after the first has, even if it decided to before', () => {
    const first = openFile();
    initializeTables(first);
    makeLegacy(first);
    const second = openFile();

    // The second process has already seen the old CHECK and is about to start
    // (it has just turned foreign keys off) when the first does the whole job.
    const pragma = second.pragma.bind(second);
    let firstRan = false;
    vi.spyOn(second, 'pragma').mockImplementation(((source: string, options?: unknown) => {
      if (source === 'foreign_keys = OFF' && !firstRan) {
        firstRan = true;
        initializeTables(first);
      }
      return pragma(source, options as never);
    }) as never);

    const recreatedBySecond = countRecreations(second, () => initializeTables(second));

    expect(firstRan).toBe(true);
    expect(recreatedBySecond).toBe(0);
    expect(taskIds(second)).toEqual(['kept']);
    expect(acceptsCommand(second)).toBe(true);
  });
});
