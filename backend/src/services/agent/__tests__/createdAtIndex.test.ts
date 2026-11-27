import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase } from '../../../__tests__/helpers/db.js';
import { initializeTables } from '../database.js';

// The Tasks activity strip counts 30 days of tasks by creation time, and a day selected on it
// narrows the grouped list by creation time. Without an index both read every task row.

const indexes = (db: Database.Database) =>
  (db.prepare(`PRAGMA index_list(tasks)`).all() as { name: string }[]).map((i) => i.name);

const plan = (db: Database.Database, sql: string, ...params: unknown[]) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join('\n');

describe('tasks created_at index', () => {
  it('exists on a fresh database', () => {
    expect(indexes(createTestDatabase())).toContain('idx_tasks_created');
  });

  it('serves a range of creation times', () => {
    const detail = plan(
      createTestDatabase(),
      `SELECT t.type, t.status, t.created_at FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
       WHERE t.created_at >= ? AND t.created_at <= ?`,
      '2026-10-28T04:00:00.000Z', '2026-11-28T03:59:59.999Z',
    );
    expect(detail).toContain('idx_tasks_created');
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
    expect(indexes(db)).toContain('idx_tasks_created');
  });
});
