import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DATA_DIR = path.join(os.homedir(), '.projectachilles');
const DB_PATH = path.join(DATA_DIR, 'agents.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables(db);

  return db;
}

function initializeTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      agent_version TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'decommissioned')),
      last_heartbeat TEXT,
      last_heartbeat_data TEXT,
      enrolled_at TEXT NOT NULL,
      enrolled_by TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      org_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
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

    CREATE TABLE IF NOT EXISTS agent_versions (
      version TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      binary_path TEXT NOT NULL,
      binary_sha256 TEXT NOT NULL,
      binary_size INTEGER NOT NULL,
      release_notes TEXT,
      mandatory INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (version, os, arch)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT,
      agent_ids TEXT NOT NULL,
      org_id TEXT NOT NULL,
      test_uuid TEXT NOT NULL,
      test_name TEXT NOT NULL,
      binary_name TEXT NOT NULL,
      execution_timeout INTEGER NOT NULL DEFAULT 300,
      priority INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL DEFAULT '{}',
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once','daily','weekly','monthly')),
      schedule_config TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      next_run_at TEXT,
      last_run_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','deleted')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_status_next_run ON schedules(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_schedules_org ON schedules(org_id);

    CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);
    CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_org ON enrollment_tokens(org_id);
  `);

  // Migration: add notes columns to tasks table
  const columns = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has('notes')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN notes TEXT DEFAULT NULL`);
  }
  if (!colNames.has('notes_history')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN notes_history TEXT DEFAULT '[]'`);
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
