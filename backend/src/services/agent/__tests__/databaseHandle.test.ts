import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

// getDatabase() opens ~/.projectachilles/agents.db, a path database.ts works
// out when it is imported. HOME points at a temporary folder before that, so
// these tests open their own file and never the real one.
const fakeHome = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/pa-database-handle-home-${process.pid}`;
  process.env.HOME = dir;
  return dir;
});

import Database from 'better-sqlite3';
import fs from 'node:fs';
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

beforeEach(() => {
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
  });

  it('sets the database up in full once the cause is gone', async () => {
    breakStartUp();
    const { getDatabase } = await load();
    expect(() => getDatabase()).toThrow();
    repair();

    const db = getDatabase();

    // api_keys is created after the step that failed.
    expect(tableNames(db)).toContain('api_keys');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(getDatabase()).toBe(db);
  });

  it('closes the connection it could not set up', async () => {
    breakStartUp();
    const { getDatabase } = await load();
    const close = vi.spyOn(Database.prototype, 'close');

    expect(() => getDatabase()).toThrow();

    expect(close).toHaveBeenCalledTimes(1);
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
