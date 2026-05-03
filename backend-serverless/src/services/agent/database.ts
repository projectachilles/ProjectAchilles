import { createClient, type Client, type InStatement, type InValue, type ResultSet, type Row, type Transaction } from '@libsql/client';

let client: Client | null = null;
let initialized = false;

export interface DbHelper {
  get(sql: string, args?: InValue[]): Promise<Row | undefined>;
  all(sql: string, args?: InValue[]): Promise<Row[]>;
  run(sql: string, args?: InValue[]): Promise<{ changes: number; lastInsertRowid: bigint }>;
  execute(sql: string, args?: InValue[]): Promise<ResultSet>;
  batch(statements: InStatement[]): Promise<ResultSet[]>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

function getClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error('TURSO_DATABASE_URL environment variable is required');
  }

  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return client;
}

function wrapClient(c: Client): DbHelper {
  return {
    async get(sql: string, args?: InValue[]): Promise<Row | undefined> {
      const result = await c.execute({ sql, args: args ?? [] });
      return result.rows[0];
    },
    async all(sql: string, args?: InValue[]): Promise<Row[]> {
      const result = await c.execute({ sql, args: args ?? [] });
      return result.rows;
    },
    async run(sql: string, args?: InValue[]): Promise<{ changes: number; lastInsertRowid: bigint }> {
      const result = await c.execute({ sql, args: args ?? [] });
      return {
        changes: result.rowsAffected,
        lastInsertRowid: BigInt(result.lastInsertRowid ?? 0),
      };
    },
    async execute(sql: string, args?: InValue[]): Promise<ResultSet> {
      return c.execute({ sql, args: args ?? [] });
    },
    async batch(statements: InStatement[]): Promise<ResultSet[]> {
      return c.batch(statements);
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      const tx = await c.transaction('write');
      try {
        const result = await fn(tx);
        tx.commit();
        return result;
      } catch (err) {
        tx.rollback();
        throw err;
      }
    },
  };
}

export async function getDb(): Promise<DbHelper> {
  const c = getClient();
  if (!initialized) {
    await initializeTables(c);
    initialized = true;
  }
  return wrapClient(c);
}

async function initializeTables(c: Client): Promise<void> {
  // Turso doesn't support multi-statement exec — use batch() with individual statements
  await c.batch([
    `CREATE TABLE IF NOT EXISTS agents (
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      api_key_rotated_at TEXT DEFAULT NULL,
      pending_api_key_hash TEXT DEFAULT NULL,
      pending_api_key_encrypted TEXT DEFAULT NULL,
      key_rotation_initiated_at TEXT DEFAULT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS enrollment_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      org_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
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
      created_by TEXT,
      notes TEXT DEFAULT NULL,
      notes_history TEXT DEFAULT '[]',
      target_index TEXT DEFAULT NULL,
      batch_id TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 2,
      original_task_id TEXT DEFAULT NULL,
      es_ingested INTEGER NOT NULL DEFAULT 0,
      ingest_attempts INTEGER NOT NULL DEFAULT 0,
      last_ingest_attempt_at TEXT DEFAULT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )`,
    `CREATE TABLE IF NOT EXISTS agent_versions (
      version TEXT NOT NULL,
      os TEXT NOT NULL CHECK(os IN ('windows', 'linux', 'darwin')),
      arch TEXT NOT NULL CHECK(arch IN ('amd64', 'arm64')),
      binary_path TEXT NOT NULL,
      binary_sha256 TEXT NOT NULL,
      binary_size INTEGER NOT NULL,
      release_notes TEXT,
      mandatory INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      signed INTEGER DEFAULT 0,
      binary_signature TEXT DEFAULT NULL,
      PRIMARY KEY (version, os, arch)
    )`,
    `CREATE TABLE IF NOT EXISTS schedules (
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      target_index TEXT DEFAULT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS heartbeat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      cpu_percent REAL,
      memory_mb REAL,
      disk_free_mb REAL,
      uptime_seconds INTEGER,
      process_cpu_percent REAL,
      process_memory_mb REAL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )`,
    `CREATE TABLE IF NOT EXISTS agent_events (
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
    )`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_schedules_status_next_run ON schedules(status, next_run_at)`,
    `CREATE INDEX IF NOT EXISTS idx_schedules_org ON schedules(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_org ON enrollment_tokens(org_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_hb_hist_agent_ts ON heartbeat_history(agent_id, timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_hb_hist_ts ON heartbeat_history(timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_events_agent_ts ON agent_events(agent_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_es_ingested ON tasks(status, es_ingested)`,
  ]);

  // Idempotent ALTER for tasks table on Turso DBs that pre-date the
  // ES-ingestion-tracking schema. CREATE TABLE IF NOT EXISTS won't add
  // columns to an existing table, so we probe with PRAGMA table_info and
  // ALTER only if missing. New columns: es_ingested, ingest_attempts,
  // last_ingest_attempt_at — all backed by application-level retry logic.
  const taskCols = await c.execute('PRAGMA table_info(tasks)');
  const taskColNames = new Set(
    taskCols.rows.map((r) => String((r as { name?: unknown }).name ?? '')),
  );
  if (!taskColNames.has('es_ingested')) {
    await c.execute('ALTER TABLE tasks ADD COLUMN es_ingested INTEGER NOT NULL DEFAULT 0');
  }
  if (!taskColNames.has('ingest_attempts')) {
    await c.execute('ALTER TABLE tasks ADD COLUMN ingest_attempts INTEGER NOT NULL DEFAULT 0');
  }
  if (!taskColNames.has('last_ingest_attempt_at')) {
    await c.execute('ALTER TABLE tasks ADD COLUMN last_ingest_attempt_at TEXT DEFAULT NULL');
  }
}

/**
 * Create an in-memory database for testing.
 * Returns a DbHelper backed by a local :memory: libsql client.
 */
let testDbCounter = 0;

export async function createTestDb(): Promise<DbHelper> {
  // libsql transactions open a second internal connection. With anonymous
  // in-memory databases (file::memory:) each connection gets its OWN
  // database, so the transaction cannot see tables from the first.
  // Use a unique temp file so both connections share the same database.
  const name = `/tmp/.achilles_test_${process.pid}_${Date.now()}_${testDbCounter++}.db`;
  const c = createClient({ url: `file:${name}` });
  await initializeTables(c);
  return wrapClient(c);
}

export function closeDatabase(): void {
  if (client) {
    client.close();
    client = null;
    initialized = false;
  }
}
