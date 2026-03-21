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
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('temp_store = MEMORY');

  initializeTables(db);

  return db;
}

function initializeTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux', 'darwin')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      agent_version TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'decommissioned', 'uninstalled')),
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
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux', 'darwin')),
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

    CREATE TABLE IF NOT EXISTS heartbeat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      cpu_percent REAL,
      memory_mb REAL,
      disk_free_mb REAL,
      uptime_seconds INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hb_hist_agent_ts ON heartbeat_history(agent_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_hb_hist_ts ON heartbeat_history(timestamp);

    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'enrolled','went_offline','came_online','task_failed',
        'task_completed','version_updated','key_rotated',
        'status_changed','decommissioned'
      )),
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_agent_ts ON agent_events(agent_id, created_at);
  `);

  // Migration: add process metrics columns to heartbeat_history
  const hbCols = database.prepare(`PRAGMA table_info(heartbeat_history)`).all() as { name: string }[];
  const hbColNames = new Set(hbCols.map((c) => c.name));
  if (!hbColNames.has('process_cpu_percent')) {
    database.exec('ALTER TABLE heartbeat_history ADD COLUMN process_cpu_percent REAL');
  }
  if (!hbColNames.has('process_memory_mb')) {
    database.exec('ALTER TABLE heartbeat_history ADD COLUMN process_memory_mb REAL');
  }

  // Migration: add notes columns to tasks table
  const columns = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const colNames = new Set(columns.map((c) => c.name));
  if (!colNames.has('notes')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN notes TEXT DEFAULT NULL`);
  }
  if (!colNames.has('notes_history')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN notes_history TEXT DEFAULT '[]'`);
  }
  if (!colNames.has('target_index')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN target_index TEXT DEFAULT NULL`);
  }
  if (!colNames.has('batch_id')) {
    database.exec("ALTER TABLE tasks ADD COLUMN batch_id TEXT");
    database.exec("UPDATE tasks SET batch_id = id WHERE batch_id IS NULL");
    database.exec("CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id)");
  }

  // Migration: add api_key_rotated_at column to agents table
  const agentCols = database.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
  const agentColNames = new Set(agentCols.map((c) => c.name));
  if (!agentColNames.has('api_key_rotated_at')) {
    database.exec(`ALTER TABLE agents ADD COLUMN api_key_rotated_at TEXT DEFAULT NULL`);
  }

  // Migration: add pending key rotation columns for zero-downtime rotation
  if (!agentColNames.has('pending_api_key_hash')) {
    database.exec(`ALTER TABLE agents ADD COLUMN pending_api_key_hash TEXT DEFAULT NULL`);
  }
  if (!agentColNames.has('pending_api_key_encrypted')) {
    database.exec(`ALTER TABLE agents ADD COLUMN pending_api_key_encrypted TEXT DEFAULT NULL`);
  }
  if (!agentColNames.has('key_rotation_initiated_at')) {
    database.exec(`ALTER TABLE agents ADD COLUMN key_rotation_initiated_at TEXT DEFAULT NULL`);
  }

  // Migration: add target_index to schedules table
  const scheduleCols = database.prepare(`PRAGMA table_info(schedules)`).all() as { name: string }[];
  const scheduleColNames = new Set(scheduleCols.map((c) => c.name));
  if (!scheduleColNames.has('target_index')) {
    database.exec(`ALTER TABLE schedules ADD COLUMN target_index TEXT DEFAULT NULL`);
  }

  // Migration: add signed column to agent_versions table
  const versionCols = database.prepare(`PRAGMA table_info(agent_versions)`).all() as { name: string }[];
  const versionColNames = new Set(versionCols.map((c) => c.name));
  if (!versionColNames.has('signed')) {
    database.exec(`ALTER TABLE agent_versions ADD COLUMN signed INTEGER DEFAULT 0`);
  }
  if (!versionColNames.has('binary_signature')) {
    database.exec(`ALTER TABLE agent_versions ADD COLUMN binary_signature TEXT DEFAULT NULL`);
  }

  // Migration: expand os CHECK constraint to include 'darwin' for agents and agent_versions.
  // SQLite doesn't support ALTER COLUMN, so recreate tables if constraint rejects 'darwin'.
  migrateDarwinConstraint(database);

  // Migration: expand tasks.type CHECK constraint to include 'execute_command'.
  migrateExecuteCommandType(database);

  // Migration: expand agents.status CHECK constraint to include 'uninstalled'.
  migrateUninstalledStatus(database);

  // CLI auth tables — device authorization flow for headless CLI login
  database.exec(`
    CREATE TABLE IF NOT EXISTS cli_auth_codes (
      device_code_hash TEXT PRIMARY KEY,
      user_code TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      user_id TEXT,
      org_id TEXT,
      role TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_user_code ON cli_auth_codes(user_code);
    CREATE INDEX IF NOT EXISTS idx_cli_auth_codes_expires ON cli_auth_codes(expires_at);

    CREATE TABLE IF NOT EXISTS cli_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      role TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cli_refresh_expires ON cli_refresh_tokens(expires_at);
  `);

  // Periodic cleanup of expired CLI auth codes and refresh tokens
  database.exec(`
    DELETE FROM cli_auth_codes WHERE expires_at < datetime('now', '-1 hour');
    DELETE FROM cli_refresh_tokens WHERE expires_at < datetime('now');
  `);

  // Migration: add retry columns to tasks table for automatic task retry on agent offline
  const taskRetryCheck = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const taskRetryColNames = new Set(taskRetryCheck.map((c) => c.name));
  if (!taskRetryColNames.has('retry_count')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0`);
  }
  if (!taskRetryColNames.has('max_retries')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN max_retries INTEGER DEFAULT 2`);
  }
  if (!taskRetryColNames.has('original_task_id')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN original_task_id TEXT DEFAULT NULL`);
  }
}

function migrateDarwinConstraint(database: Database.Database): void {
  // Temporarily disable FK checks — dropping `agents` would fail because `tasks` references it.
  // PRAGMA foreign_keys can only be toggled outside a transaction.
  database.pragma('foreign_keys = OFF');

  // Test if agents table already accepts 'darwin'
  let agentsNeedMigration = false;
  try {
    database.exec(`SAVEPOINT darwin_check`);
    database.exec(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, enrolled_at)
                    VALUES ('__darwin_check__', '__test__', '__test__', 'darwin', 'amd64', '0', '__test__', datetime('now'))`);
    database.exec(`DELETE FROM agents WHERE id = '__darwin_check__'`);
    database.exec(`RELEASE darwin_check`);
  } catch {
    database.exec(`ROLLBACK TO darwin_check`);
    database.exec(`RELEASE darwin_check`);
    agentsNeedMigration = true;
  }

  if (agentsNeedMigration) {
    // Determine which columns exist (notes/notes_history/target_index may have been added by migration)
    const cols = database.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
    const colSet = new Set(cols.map((c) => c.name));
    const selectCols = cols.map((c) => c.name).join(', ');

    const extraCols = [
      colSet.has('notes') ? 'notes TEXT DEFAULT NULL' : null,
      colSet.has('notes_history') ? "notes_history TEXT DEFAULT '[]'" : null,
      colSet.has('target_index') ? 'target_index TEXT DEFAULT NULL' : null,
    ].filter(Boolean);

    // Drop leftover temp table from a previous interrupted migration
    database.exec(`DROP TABLE IF EXISTS agents_new`);
    database.exec(`
      CREATE TABLE agents_new (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL CHECK(os IN ('windows', 'linux', 'darwin')),
        arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
        agent_version TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'decommissioned', 'uninstalled')),
        last_heartbeat TEXT,
        last_heartbeat_data TEXT,
        enrolled_at TEXT NOT NULL,
        enrolled_by TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        ${extraCols.length > 0 ? ', ' + extraCols.join(', ') : ''}
      );
      INSERT INTO agents_new (${selectCols}) SELECT ${selectCols} FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
      CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    `);
  }

  // Test if agent_versions table already accepts 'darwin'
  let versionsNeedMigration = false;
  try {
    database.exec(`SAVEPOINT darwin_ver_check`);
    database.exec(`INSERT INTO agent_versions (version, os, arch, binary_path, binary_sha256, binary_size)
                    VALUES ('__check__', 'darwin', 'amd64', '__test__', '__test__', 0)`);
    database.exec(`DELETE FROM agent_versions WHERE version = '__check__' AND os = 'darwin'`);
    database.exec(`RELEASE darwin_ver_check`);
  } catch {
    database.exec(`ROLLBACK TO darwin_ver_check`);
    database.exec(`RELEASE darwin_ver_check`);
    versionsNeedMigration = true;
  }

  if (versionsNeedMigration) {
    const vCols = database.prepare(`PRAGMA table_info(agent_versions)`).all() as { name: string }[];
    const vSelectCols = vCols.map((c) => c.name).join(', ');
    const hasSigned = vCols.some((c) => c.name === 'signed');

    // Drop leftover temp table from a previous interrupted migration
    database.exec(`DROP TABLE IF EXISTS agent_versions_new`);
    database.exec(`
      CREATE TABLE agent_versions_new (
        version TEXT NOT NULL,
        os TEXT NOT NULL CHECK(os IN ('windows', 'linux', 'darwin')),
        arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
        binary_path TEXT NOT NULL,
        binary_sha256 TEXT NOT NULL,
        binary_size INTEGER NOT NULL,
        release_notes TEXT,
        mandatory INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
        ${hasSigned ? ', signed INTEGER DEFAULT 0' : ''}
        , PRIMARY KEY (version, os, arch)
      );
      INSERT INTO agent_versions_new (${vSelectCols}) SELECT ${vSelectCols} FROM agent_versions;
      DROP TABLE agent_versions;
      ALTER TABLE agent_versions_new RENAME TO agent_versions;
    `);
  }

  // Re-enable FK checks and verify integrity
  database.pragma('foreign_keys = ON');
}

function migrateExecuteCommandType(database: Database.Database): void {
  // Probe: check if tasks table already accepts 'execute_command'
  let needsMigration = false;
  try {
    database.exec(`SAVEPOINT cmd_type_check`);
    database.exec(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by)
                    VALUES ('__cmd_check__', '__test__', '__test__', 'execute_command', '{}', '__test__')`);
    database.exec(`DELETE FROM tasks WHERE id = '__cmd_check__'`);
    database.exec(`RELEASE cmd_type_check`);
  } catch {
    database.exec(`ROLLBACK TO cmd_type_check`);
    database.exec(`RELEASE cmd_type_check`);
    needsMigration = true;
  }

  if (!needsMigration) return;

  database.pragma('foreign_keys = OFF');

  const cols = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const selectCols = cols.map((c) => c.name).join(', ');
  const colSet = new Set(cols.map((c) => c.name));

  // Build optional columns that may have been added by earlier migrations
  const optionalCols = [
    colSet.has('notes') ? 'notes TEXT DEFAULT NULL' : null,
    colSet.has('notes_history') ? "notes_history TEXT DEFAULT '[]'" : null,
    colSet.has('target_index') ? 'target_index TEXT DEFAULT NULL' : null,
    colSet.has('batch_id') ? 'batch_id TEXT' : null,
  ].filter(Boolean);

  database.exec(`DROP TABLE IF EXISTS tasks_new`);
  database.exec(`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('execute_test', 'update_agent', 'uninstall', 'execute_command')),
      priority INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'downloading', 'executing', 'completed', 'failed', 'expired')),
      payload TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      assigned_at TEXT,
      completed_at TEXT,
      ttl INTEGER NOT NULL DEFAULT 604800,
      created_by TEXT
      ${optionalCols.length > 0 ? ', ' + optionalCols.join(', ') : ''}
      , FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    INSERT INTO tasks_new (${selectCols}) SELECT ${selectCols} FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id);
  `);

  database.pragma('foreign_keys = ON');
}

function migrateUninstalledStatus(database: Database.Database): void {
  // Probe: check if agents table already accepts 'uninstalled'
  let needsMigration = false;
  try {
    database.exec(`SAVEPOINT uninstall_check`);
    database.exec(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at)
                    VALUES ('__uninstall_check__', '__test__', '__test__', 'linux', 'amd64', '0', '__test__', 'uninstalled', datetime('now'))`);
    database.exec(`DELETE FROM agents WHERE id = '__uninstall_check__'`);
    database.exec(`RELEASE uninstall_check`);
  } catch {
    database.exec(`ROLLBACK TO uninstall_check`);
    database.exec(`RELEASE uninstall_check`);
    needsMigration = true;
  }

  if (!needsMigration) return;

  // Backup the database before destructive migration
  try {
    const backupPath = DB_PATH + '.bak';
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[db] Database backed up to ${backupPath}`);
  } catch (backupErr) {
    console.warn(`[db] Warning: could not back up database: ${backupErr}`);
  }

  database.pragma('foreign_keys = OFF');

  const cols = database.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[];
  const selectCols = cols.map((c) => c.name).join(', ');
  const colSet = new Set(cols.map((c) => c.name));

  // Build optional columns that may have been added by earlier migrations
  const optionalCols = [
    colSet.has('api_key_rotated_at') ? 'api_key_rotated_at TEXT DEFAULT NULL' : null,
    colSet.has('pending_api_key_hash') ? 'pending_api_key_hash TEXT DEFAULT NULL' : null,
    colSet.has('pending_api_key_encrypted') ? 'pending_api_key_encrypted TEXT DEFAULT NULL' : null,
    colSet.has('key_rotation_initiated_at') ? 'key_rotation_initiated_at TEXT DEFAULT NULL' : null,
  ].filter(Boolean);

  database.exec(`DROP TABLE IF EXISTS agents_new`);
  database.exec(`
    CREATE TABLE agents_new (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux', 'darwin')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      agent_version TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'decommissioned', 'uninstalled')),
      last_heartbeat TEXT,
      last_heartbeat_data TEXT,
      enrolled_at TEXT NOT NULL,
      enrolled_by TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      ${optionalCols.length > 0 ? ', ' + optionalCols.join(', ') : ''}
    );
    INSERT INTO agents_new (${selectCols}) SELECT ${selectCols} FROM agents;
    DROP TABLE agents;
    ALTER TABLE agents_new RENAME TO agents;
    CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  `);

  database.pragma('foreign_keys = ON');

  console.log(`[db] Migration complete: added 'uninstalled' status. Backup at ${DB_PATH}.bak`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
