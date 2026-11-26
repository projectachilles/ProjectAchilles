import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// database.ts works out ~/.projectachilles from os.homedir() when it is
// imported. The home folder it sees is one that does not exist, so nothing
// here can read or write the real data folder. The os module is replaced, not
// the HOME variable: a worker thread has its own copy of the environment,
// which os.homedir() does not read.
const fakeHome = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/pa-check-recreations-home-${process.pid}`);
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => fakeHome;
  return { ...actual, homedir, default: { ...actual, homedir } };
});

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeTables } from '../database.js';

// Widening a CHECK means recreating the table (new table, copy every row, drop
// the old one, rename). Three of these decided with a test insert and treated
// any error as "out of date", SQLITE_BUSY included (agents twice, agent_versions,
// api_keys), and three ran as separate statements (agents, agent_versions,
// agent_events). All now decide from the table's definition and run in one
// transaction that takes the write lock first, like the tasks table (see
// tasksRecreation.test.ts).

type Table = 'agents' | 'agent_versions' | 'api_keys' | 'agent_events';

interface Case {
  title: string;
  table: Table;
  /** Removed from today's definition to get the one of an older release. */
  remove: string;
  /** Inserts a row only today's CHECK accepts. */
  insertNewValue: (db: Database.Database) => void;
}

const CASES: Case[] = [
  {
    title: "agents, from before 'darwin'",
    table: 'agents',
    remove: ", 'darwin'",
    insertNewValue: (db) =>
      db.prepare(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, enrolled_at)
        VALUES ('new', 'o', 'mac', 'darwin', 'arm64', '1', 'x', 't')`).run(),
  },
  {
    title: "agents, from before 'uninstalled'",
    table: 'agents',
    remove: ", 'uninstalled'",
    insertNewValue: (db) =>
      db.prepare(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at)
        VALUES ('new', 'o', 'gone', 'linux', 'amd64', '1', 'x', 'uninstalled', 't')`).run(),
  },
  {
    title: "agent_versions, from before 'darwin'",
    table: 'agent_versions',
    remove: ", 'darwin'",
    insertNewValue: (db) =>
      db.prepare(`INSERT INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size)
        VALUES ('9.9.9', 'darwin', 'arm64', '/b', 'sha', 1)`).run(),
  },
  {
    title: "api_keys, from before 'admin'",
    table: 'api_keys',
    remove: ",'admin'",
    insertNewValue: (db) =>
      db.prepare(`INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by)
        VALUES ('new', 'n', 'h-new', 'pa_99999999', 'admin', 'u')`).run(),
  },
  {
    title: "agent_events, from before 'key_rotation_cancelled'",
    table: 'agent_events',
    remove: "'key_rotation_cancelled',",
    insertNewValue: (db) =>
      db.prepare(`INSERT INTO agent_events (agent_id, event_type) VALUES ('a', 'key_rotation_cancelled')`).run(),
  },
];

const open = (file = ':memory:') => {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};

/** One row in every table that gets recreated, with a value in every column added since the first release. */
function seed(db: Database.Database) {
  db.prepare(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at, enrolled_by,
      api_key_rotated_at, pending_api_key_hash, pending_api_key_encrypted, key_rotation_initiated_at)
    VALUES ('a', 'o', 'h', 'linux', 'amd64', '1', 'x', 'active', 't', 'u', 'rotated', 'pending-hash', 'pending-enc', 'initiated')`).run();
  db.prepare(`INSERT INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size, signed, binary_signature, signer_subject, signer_fingerprint)
    VALUES ('1.0.0', 'linux', 'amd64', '/b', 'sha', 10, 1, 'sig', 'subject', 'fingerprint')`).run();
  db.prepare(`INSERT INTO api_keys (id, name, token_hash, key_prefix, scope, created_by, org_id)
    VALUES ('k', 'n', 'h', 'pa_12345678', 'read-write', 'u', 'o')`).run();
  db.prepare(`INSERT INTO agent_events (agent_id, event_type, details) VALUES ('a', 'enrolled', '{"k":1}')`).run();
  // A task of the agent: with foreign keys on, the agents table could not be dropped.
  db.prepare(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by) VALUES ('t', 'a', 'o', 'execute_test', '{}', 'u')`).run();
}

const definition = (db: Database.Database, table: string) =>
  (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string }).sql;

/**
 * Gives the table the definition of an older release: every column it has
 * today, its rows, and a CHECK that lacks one value.
 */
function makeLegacy(db: Database.Database, c: Case) {
  const current = definition(db, c.table);
  const legacySql = current
    .replace(new RegExp(`CREATE TABLE "?${c.table}"?`), `CREATE TABLE ${c.table}_old_shape`)
    .replace(c.remove, '');
  expect(legacySql).not.toContain(c.remove);
  const names = (db.prepare(`PRAGMA table_info(${c.table})`).all() as { name: string }[]).map((col) => col.name).join(', ');
  db.pragma('foreign_keys = OFF');
  db.exec(`${legacySql};
    INSERT INTO ${c.table}_old_shape (${names}) SELECT ${names} FROM ${c.table};
    DROP TABLE ${c.table};
    ALTER TABLE ${c.table}_old_shape RENAME TO ${c.table};`);
  db.pragma('foreign_keys = ON');
}

const acceptsNewValue = (db: Database.Database, c: Case) => {
  try {
    db.exec('SAVEPOINT try_new_value');
    c.insertNewValue(db);
    db.exec('ROLLBACK TO try_new_value; RELEASE try_new_value');
    return true;
  } catch {
    db.exec('ROLLBACK TO try_new_value; RELEASE try_new_value');
    return false;
  }
};

const rowsOf = (db: Database.Database, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();

const shapeOf = (db: Database.Database, table: string) => ({
  columns: (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[])
    .map((col) => `${col.name} ${col.type} notnull=${col.notnull} default=${col.dflt_value} pk=${col.pk}`)
    .sort(),
  indexes: (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'").all(table) as { name: string }[])
    .map((r) => r.name)
    .sort(),
});

const tablesLike = (db: Database.Database, pattern: string) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name").all(pattern) as { name: string }[]).map((r) => r.name);

/** The `…_new` tables a call starts to build, in order. */
function recreationsStarted(db: Database.Database, run: () => void): string[] {
  const started: string[] = [];
  const exec = db.exec.bind(db);
  const spy = vi.spyOn(db, 'exec').mockImplementation(((sql: string) => {
    for (const m of sql.matchAll(/CREATE TABLE (\w+_new)\b/g)) started.push(m[1]);
    return exec(sql);
  }) as never);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return started;
}

/** True for the query a table's migration decides with. */
const isDecision = (sql: string, table: string) =>
  sql.includes('SELECT sql FROM sqlite_master') && sql.includes(`name = '${table}'`);

let dir: string | undefined;
const opened: Database.Database[] = [];
const dbFile = () => {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'check-recreations-'));
  return path.join(dir, 'agents.db');
};
const openFile = () => {
  const db = open(dbFile());
  opened.push(db);
  return db;
};
afterEach(() => {
  vi.restoreAllMocks();
  while (opened.length) opened.pop()!.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
beforeAll(() => {
  // Without this no test may run: database.ts would point at the real data folder.
  expect(os.homedir()).toBe(fakeHome);
});
afterAll(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('no table is recreated when its definition is up to date', () => {
  it('on a fresh database', () => {
    const db = open();
    expect(recreationsStarted(db, () => initializeTables(db))).toEqual([]);
  });

  it('on later starts, with rows in every table', () => {
    const db = open();
    initializeTables(db);
    seed(db);
    expect(recreationsStarted(db, () => initializeTables(db))).toEqual([]);
    expect(recreationsStarted(db, () => initializeTables(db))).toEqual([]);
  });
});

describe.each(CASES)('$title', (c) => {
  it('is recreated once, keeping every row, column and index, and then not again', () => {
    const db = open();
    initializeTables(db);
    seed(db);
    const before = { shape: shapeOf(db, c.table), rows: rowsOf(db, c.table) };
    makeLegacy(db, c);
    expect(acceptsNewValue(db, c)).toBe(false);

    expect(recreationsStarted(db, () => initializeTables(db))).toEqual([`${c.table}_new`]);

    expect(rowsOf(db, c.table)).toEqual(before.rows);
    expect(shapeOf(db, c.table)).toEqual(before.shape);
    expect(acceptsNewValue(db, c)).toBe(true);
    expect(tablesLike(db, `${c.table}%`)).toEqual([c.table]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(recreationsStarted(db, () => initializeTables(db))).toEqual([]);
  });

  it('leaves the table and its rows as they were when the recreation fails after the old table is dropped', () => {
    const db = open();
    initializeTables(db);
    seed(db);
    const rows = rowsOf(db, c.table);
    makeLegacy(db, c);
    // A view on the table makes the final rename fail: by then the old table is already dropped.
    db.exec(`CREATE VIEW watching AS SELECT * FROM ${c.table}`);

    expect(() => initializeTables(db)).toThrow();

    expect(tablesLike(db, `${c.table}%`)).toEqual([c.table]);
    expect(rowsOf(db, c.table)).toEqual(rows);
    expect(acceptsNewValue(db, c)).toBe(false);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('is not recreated again by a second process that decided to before the first had finished', () => {
    const first = openFile();
    initializeTables(first);
    seed(first);
    const rows = rowsOf(first, c.table);
    makeLegacy(first, c);
    const second = openFile();

    // The second process has just read the old definition. Before it gets the
    // lock, the first does the whole job.
    const prepare = second.prepare.bind(second);
    let decisions = 0;
    vi.spyOn(second, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (!isDecision(sql, c.table)) return stmt;
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

    const startedBySecond = recreationsStarted(second, () => initializeTables(second));

    expect(decisions).toBe(2); // once before the lock, once holding it
    expect(startedBySecond).toEqual([]);
    expect(rowsOf(second, c.table)).toEqual(rows);
    expect(acceptsNewValue(second, c)).toBe(true);
  });

  it('holds the write lock from its decision on, so another process cannot write in between', () => {
    const first = openFile();
    initializeTables(first);
    seed(first);
    makeLegacy(first, c);
    const other = openFile();
    other.pragma('busy_timeout = 0');

    // The other process writes at the worst moment: right after this one has
    // decided, inside its transaction. Without the lock that write commits and
    // the recreation ends with SQLITE_BUSY_SNAPSHOT.
    const prepare = first.prepare.bind(first);
    let decisions = 0;
    let otherWrite: string | null = null;
    vi.spyOn(first, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (!isDecision(sql, c.table)) return stmt;
      decisions += 1;
      if (decisions !== 2) return stmt;
      return {
        get: (...args: unknown[]) => {
          const row = stmt.get(...args);
          try {
            other.prepare("UPDATE schedules SET name = 'renamed' WHERE id = 'none'").run();
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
    expect(acceptsNewValue(first, c)).toBe(true);
  });

  it(`keeps a ${c.table}_new table left by an interrupted upgrade, and says so`, () => {
    const db = open();
    initializeTables(db);
    db.exec(`CREATE TABLE ${c.table}_new (id TEXT PRIMARY KEY); INSERT INTO ${c.table}_new (id) VALUES ('only-copy')`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    initializeTables(db);

    expect(rowsOf(db, `${c.table}_new`)).toEqual([{ id: 'only-copy' }]);
    expect(warn.mock.calls.flat().join(' ')).toMatch(new RegExp(`${c.table}_new.*1 row`));
  });
});

describe('a start while another process holds the write lock', () => {
  it('does not start recreating a table that is up to date', () => {
    const holder = openFile();
    initializeTables(holder);
    seed(holder);
    const starting = openFile();
    starting.pragma('busy_timeout = 0');

    // A long write is in progress when the process starts, and ends as soon as
    // the starting process has run into it once.
    holder.exec('BEGIN IMMEDIATE');
    let held = true;
    const release = () => {
      if (held) holder.exec('ROLLBACK');
      held = false;
    };
    const exec = starting.exec.bind(starting);
    const started: string[] = [];
    vi.spyOn(starting, 'exec').mockImplementation(((sql: string) => {
      for (const m of sql.matchAll(/CREATE TABLE (\w+_new)\b/g)) started.push(m[1]);
      try {
        return exec(sql);
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_BUSY') release();
        throw err;
      }
    }) as never);

    try {
      initializeTables(starting);
    } catch {
      // A start that cannot write fails; what matters is what it left behind.
    }
    release();

    expect(started).toEqual([]);
    expect(tablesLike(starting, '%\\_new').filter((name) => name.endsWith('_new'))).toEqual([]);
    expect(starting.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(rowsOf(starting, 'agents')).toHaveLength(1);
  });
});

describe('the backup made before the agents table is recreated', () => {
  const agentsUninstalled = CASES[1];

  it('is a copy of the database being changed, beside it, taken before the change', () => {
    const db = openFile();
    initializeTables(db);
    seed(db);
    makeLegacy(db, agentsUninstalled);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTables(db);

    const backup = `${dbFile()}.bak`;
    expect(fs.existsSync(backup)).toBe(true);
    const copy = new Database(backup, { readonly: true });
    opened.push(copy);
    expect(copy.prepare('SELECT id, pending_api_key_hash FROM agents').all()).toEqual([{ id: 'a', pending_api_key_hash: 'pending-hash' }]);
    expect(definition(copy, 'agents')).not.toContain("'uninstalled'");
    expect(fs.existsSync(path.join(fakeHome, '.projectachilles'))).toBe(false);
  });

  it('replaces an earlier backup', () => {
    const db = openFile();
    initializeTables(db);
    seed(db);
    makeLegacy(db, agentsUninstalled);
    fs.writeFileSync(`${dbFile()}.bak`, 'left from an earlier upgrade');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTables(db);

    const copy = new Database(`${dbFile()}.bak`, { readonly: true });
    opened.push(copy);
    expect(copy.prepare('SELECT id FROM agents').all()).toEqual([{ id: 'a' }]);
  });

  it('stays the copy from before the change when a second process decided to recreate the table too', () => {
    const first = openFile();
    initializeTables(first);
    seed(first);
    makeLegacy(first, agentsUninstalled);
    const second = openFile();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // The second process reads the old definition, then the first does the
    // whole job, backup included. A copy the second takes now is of the
    // database after the change.
    const prepare = second.prepare.bind(second);
    let decisions = 0;
    vi.spyOn(second, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (!isDecision(sql, 'agents')) return stmt;
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

    initializeTables(second);

    const copy = new Database(`${dbFile()}.bak`, { readonly: true });
    opened.push(copy);
    expect(definition(copy, 'agents')).not.toContain("'uninstalled'");
    // Nothing temporary is left beside the database.
    expect(fs.readdirSync(dir!).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  // Two modes: the copy is not simply created private, nor with the umask's default.
  it.each([0o600, 0o640])('has the permissions of the database file (%o), whatever the umask', (mode) => {
    const db = openFile();
    initializeTables(db);
    seed(db);
    makeLegacy(db, agentsUninstalled);
    fs.chmodSync(dbFile(), mode);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTables(db);

    expect(fs.statSync(`${dbFile()}.bak`).mode & 0o777).toBe(mode);
  });

  it('clears away what a process killed during an earlier copy left behind', () => {
    const db = openFile();
    initializeTables(db);
    seed(db);
    makeLegacy(db, agentsUninstalled);
    fs.writeFileSync(`${dbFile()}.bak.tmp`, 'half a copy');
    fs.writeFileSync(`${dbFile()}.bak.tmp-journal`, 'its journal');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    initializeTables(db);

    expect(fs.readdirSync(dir!).filter((name) => name.includes('.tmp'))).toEqual([]);
    const copy = new Database(`${dbFile()}.bak`, { readonly: true });
    opened.push(copy);
    expect(copy.prepare('SELECT id FROM agents').all()).toEqual([{ id: 'a' }]);
  });

  it.each([
    ['the copy cannot be written', '.bak.tmp'],
    ['the copy cannot be put in place', '.bak'],
  ])('does not stop the recreation when %s', (_what, suffix) => {
    const db = openFile();
    initializeTables(db);
    seed(db);
    makeLegacy(db, agentsUninstalled);
    // A folder where the file should go.
    fs.mkdirSync(`${dbFile()}${suffix}`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => initializeTables(db)).not.toThrow();

    expect(acceptsNewValue(db, agentsUninstalled)).toBe(true);
    expect(rowsOf(db, 'agents')).toHaveLength(1);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/could not back up/);
    expect(fs.readdirSync(dir!).filter((name) => name.endsWith('.tmp') && fs.statSync(path.join(dir!, name)).isFile())).toEqual([]);
  });

  it('is made once, by the process that recreates the table', () => {
    const first = openFile();
    initializeTables(first);
    seed(first);
    makeLegacy(first, agentsUninstalled);
    const second = openFile();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const prepare = second.prepare.bind(second);
    let decisions = 0;
    vi.spyOn(second, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (!isDecision(sql, 'agents')) return stmt;
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

    initializeTables(second);

    expect(log.mock.calls.flat().filter((line) => String(line).includes('backed up'))).toHaveLength(1);
  });

  it('is not attempted for an in-memory database, and no start that recreates nothing makes one', () => {
    const memory = open();
    initializeTables(memory);
    seed(memory);
    makeLegacy(memory, agentsUninstalled);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const strays = [':memory:.bak', ':memory:.bak.tmp'];
    try {
      initializeTables(memory);
      expect(strays.filter((name) => fs.existsSync(name))).toEqual([]);
    } finally {
      for (const name of strays) fs.rmSync(name, { force: true });
    }
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/back/i);

    const db = openFile();
    initializeTables(db);
    seed(db);
    initializeTables(db);
    expect(fs.existsSync(`${dbFile()}.bak`)).toBe(false);
  });
});

describe('a column another process adds between the check and the ALTER', () => {
  // [table, column, which read of the table's columns the second process is at]
  it.each([
    ['run_notices', 'last_attempt_at', 1],
    ['heartbeat_history', 'total_memory_mb', 1],
    ['tasks', 'notes', 1],
    ['tasks', 'last_ingest_attempt_at', 2],
    ['agents', 'key_rotation_initiated_at', 1],
    ['schedules', 'agent_next_runs', 1],
    ['agent_versions', 'signer_fingerprint', 1],
  ] as const)('%s.%s does not stop the start', (table, column, nthRead) => {
    const first = openFile();
    initializeTables(first);
    first.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    const second = openFile();
    const columns = (db: Database.Database) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((col) => col.name);
    expect(columns(second)).not.toContain(column);

    // The second process has just read the table's columns and found this one
    // missing. Before it adds the column, the first process does.
    const prepare = second.prepare.bind(second);
    let reads = 0;
    vi.spyOn(second, 'prepare').mockImplementation(((sql: string) => {
      const stmt = prepare(sql);
      if (sql !== `PRAGMA table_info(${table})`) return stmt;
      reads += 1;
      if (reads !== nthRead) return stmt;
      return {
        all: (...args: unknown[]) => {
          const rows = stmt.all(...args);
          initializeTables(first);
          return rows;
        },
      } as never;
    }) as never);

    expect(() => initializeTables(second)).not.toThrow();

    vi.restoreAllMocks();
    expect(reads).toBeGreaterThanOrEqual(nthRead);
    expect(columns(second)).toContain(column);
  });
});

describe('every column a start adds', () => {
  it('may be added first by another process starting at the same moment', () => {
    // A new database: its tables are created with their first columns, and
    // every later column is added by an ALTER. Whenever this process is about
    // to add one, the other process adds it first.
    const other = openFile();
    const starting = openFile();
    const raced: string[] = [];
    const addFirst = (sql: string) => {
      const m = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql);
      // Inside a transaction this process holds the write lock: no other can add anything.
      if (!m || starting.inTransaction) return;
      raced.push(`${m[1]}.${m[2]}`);
      other.exec(sql);
    };
    const exec = starting.exec.bind(starting);
    const prepare = starting.prepare.bind(starting);
    vi.spyOn(starting, 'exec').mockImplementation(((sql: string) => {
      addFirst(sql);
      return exec(sql);
    }) as never);
    vi.spyOn(starting, 'prepare').mockImplementation(((sql: string) => {
      addFirst(sql);
      return prepare(sql);
    }) as never);

    expect(() => initializeTables(starting)).not.toThrow();

    vi.restoreAllMocks();
    expect(raced).toContain('tasks.test_uuid');
    expect(raced.length).toBeGreaterThan(25);
    // The database is the one a start alone produces.
    const columnsOf = (db: Database.Database) =>
      (db.prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY 1, 2").all() as { t: string; c: string }[])
        .map((r) => `${r.t}.${r.c}`);
    const alone = open();
    initializeTables(alone);
    expect(columnsOf(starting)).toEqual(columnsOf(alone));
  });
});
