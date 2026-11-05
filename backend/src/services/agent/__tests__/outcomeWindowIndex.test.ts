import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';
import { initializeTables } from '../database.js';
import { outcomeWindowSql, outcomeResultSql } from '../../outcomes/taskOutcome.js';

// The Tasks page's 7-day scans (agent metrics breakdown + the grouped-list
// breakdown filter) select finished tasks by status and completed_at. Without
// an index on both they read every task row on each 10 s poll.

const indexes = (db: Database.Database) =>
  (db.prepare(`PRAGMA index_list(tasks)`).all() as { name: string }[]).map((i) => i.name);

const plan = (db: Database.Database, sql: string, ...params: unknown[]) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join('\n');

describe('tasks outcome-window index', () => {
  it('exists on a fresh database', () => {
    const db = createTestDatabase();
    expect(indexes(db)).toContain('idx_tasks_outcome_window');
  });

  it('serves the 7-day metrics scan', () => {
    const db = createTestDatabase();
    const detail = plan(db, `SELECT type, status, ${outcomeResultSql()} AS result FROM tasks WHERE ${outcomeWindowSql()}`);
    expect(detail).toContain('idx_tasks_outcome_window');
  });

  it('serves the breakdown filter candidate scan', () => {
    const db = createTestDatabase();
    const detail = plan(
      db,
      `SELECT t.id FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
       WHERE t.type = 'execute_test' AND ${outcomeWindowSql('t')}`,
    );
    expect(detail).toContain('idx_tasks_outcome_window');
  });

  it('survives the legacy tasks table recreation', () => {
    const db = createTestDatabase();
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
    `);
    db.pragma('foreign_keys = ON');
    initializeTables(db);
    expect(indexes(db)).toContain('idx_tasks_outcome_window');
  });
});
