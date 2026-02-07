import Database from 'better-sqlite3';

/**
 * Create an in-memory SQLite database with the full agent schema.
 * Each test gets a fresh, isolated database instance.
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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
      notes TEXT DEFAULT NULL,
      notes_history TEXT DEFAULT '[]',
      target_index TEXT DEFAULT NULL,
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
      signed INTEGER DEFAULT 0,
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
      target_index TEXT DEFAULT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);
    CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_org ON enrollment_tokens(org_id);
  `);

  return db;
}

/**
 * Insert a test agent directly into the database.
 * Returns the agent ID for reference.
 */
export function insertTestAgent(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    org_id: string;
    hostname: string;
    os: string;
    arch: string;
    agent_version: string;
    api_key_hash: string;
    status: string;
    last_heartbeat: string;
    last_heartbeat_data: string;
    enrolled_at: string;
    enrolled_by: string;
    tags: string;
  }> = {}
): string {
  const id = overrides.id ?? 'agent-001';
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, last_heartbeat, last_heartbeat_data, enrolled_at, enrolled_by, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.org_id ?? 'org-001',
    overrides.hostname ?? 'test-host',
    overrides.os ?? 'linux',
    overrides.arch ?? 'amd64',
    overrides.agent_version ?? '1.0.0',
    overrides.api_key_hash ?? '$2a$10$fakehashvalue',
    overrides.status ?? 'active',
    overrides.last_heartbeat ?? now,
    overrides.last_heartbeat_data ?? null,
    overrides.enrolled_at ?? now,
    overrides.enrolled_by ?? 'token-001',
    overrides.tags ?? '[]',
  );

  return id;
}

/**
 * Insert a test task directly into the database.
 */
export function insertTestTask(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    agent_id: string;
    org_id: string;
    type: string;
    priority: number;
    status: string;
    payload: string;
    created_by: string;
    ttl: number;
  }> = {}
): string {
  const id = overrides.id ?? 'task-001';
  const defaultPayload = JSON.stringify({
    test_uuid: 'test-uuid-001',
    test_name: 'Test Name',
    binary_name: 'test.exe',
    binary_sha256: 'abc123',
    binary_size: 1024,
    execution_timeout: 300,
    arguments: [],
    metadata: {
      category: 'test',
      subcategory: '',
      severity: 'medium',
      techniques: [],
      tactics: [],
      threat_actor: '',
      target: '',
      complexity: '',
      tags: [],
      score: null,
    },
  });

  db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_by, ttl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.agent_id ?? 'agent-001',
    overrides.org_id ?? 'org-001',
    overrides.type ?? 'execute_test',
    overrides.priority ?? 1,
    overrides.status ?? 'pending',
    overrides.payload ?? defaultPayload,
    overrides.created_by ?? 'user-001',
    overrides.ttl ?? 604800,
  );

  return id;
}
