import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

// getDatabase() opens ~/.projectachilles/agents.db, a path database.ts works
// out from os.homedir() when it is imported. The home folder it sees is a
// temporary one, so these tests open their own file and never the real one.
// The os module is replaced, not the HOME variable: a worker thread has its
// own copy of the environment, which os.homedir() does not read.
const fakeHome = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/pa-database-handle-home-${process.pid}`);
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => fakeHome;
  return { ...actual, homedir, default: { ...actual, homedir } };
});

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.join(fakeHome, '.projectachilles');
const dbFile = path.join(dataDir, 'agents.db');

const load = () => import('../database.js');

/** A database whose start-up cannot finish: an index is created on a column this table lacks. */
function breakStartUp() {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbFile);
  db.exec('CREATE TABLE cli_auth_codes (not_the_real_columns TEXT)');
  db.close();
}
function repair() {
  const db = new Database(dbFile);
  db.exec('DROP TABLE cli_auth_codes');
  db.close();
}
const tableNames = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);

/** Moves the clock getDatabase() reads. */
function later(ms: number) {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + ms);
}

beforeEach(() => {
  // Without this no test may run: getDatabase() would open the real database.
  expect(os.homedir()).toBe(fakeHome);
  fs.rmSync(fakeHome, { recursive: true, force: true });
  vi.resetModules();
});
afterEach(async () => {
  vi.restoreAllMocks();
  (await load()).closeDatabase();
});
afterAll(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('getDatabase() when setting up the schema fails', () => {
  it('fails again on the next call instead of handing out the half set-up database', async () => {
    breakStartUp();
    const { getDatabase } = await load();

    expect(() => getDatabase()).toThrow(/user_code/);
    expect(() => getDatabase()).toThrow(/user_code/);
    later(60_000);
    expect(() => getDatabase()).toThrow(/user_code/);
  });

  it('closes the connection it could not set up', async () => {
    breakStartUp();
    const { getDatabase } = await load();
    const close = vi.spyOn(Database.prototype, 'close');

    expect(() => getDatabase()).toThrow();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not set up again for 5 seconds: calls in between get the same error at once', async () => {
    breakStartUp();
    const { getDatabase } = await load();
    expect(() => getDatabase()).toThrow(/user_code/);
    repair();
    const opened = vi.spyOn(fs, 'mkdirSync');

    // The cause is gone, but it is too soon to look: the database is not opened.
    later(4_000);
    expect(() => getDatabase()).toThrow(/user_code/);
    expect(opened).not.toHaveBeenCalled();
  });

  it('sets the database up in full once the cause is gone', async () => {
    breakStartUp();
    const { getDatabase } = await load();
    expect(() => getDatabase()).toThrow();
    repair();
    later(5_000);

    const db = getDatabase();

    // api_keys is created after the step that failed.
    expect(tableNames(db)).toContain('api_keys');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(getDatabase()).toBe(db);
  });

  it('forgets the failure when the database is closed', async () => {
    breakStartUp();
    const { getDatabase, closeDatabase } = await load();
    expect(() => getDatabase()).toThrow();
    repair();

    closeDatabase();

    expect(tableNames(getDatabase())).toContain('api_keys');
  });
});

describe('getDatabase() on a database that sets up', () => {
  it('returns the same connection every time', async () => {
    const { getDatabase } = await load();
    const db = getDatabase();
    expect(tableNames(db)).toContain('agents');
    expect(getDatabase()).toBe(db);
  });
});
