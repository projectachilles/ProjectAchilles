import Database from 'better-sqlite3';
import { initializeTables } from '../../services/agent/database.js';

/**
 * Create an in-memory SQLite database with the full agent schema.
 * Each test gets a fresh, isolated database instance.
 *
 * Schema is sourced from production initializeTables() so any future
 * migration drift is caught by the test suite. Earlier this helper
 * duplicated the schema as a hardcoded CREATE TABLE block, which let
 * a security-hook-blocked migration ALTER ship undetected in PR #181:
 * 1100+ tests passed against the fabricated schema while the
 * production migration code was missing entirely.
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  db.pragma('temp_store = MEMORY');

  initializeTables(db);

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
    batch_id: string;
    created_at: string;
    assigned_at: string | null;
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
      target: [],
      complexity: '',
      tags: [],
      score: null,
      integrations: [],
    },
  });

  db.prepare(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_by, ttl, batch_id, created_at, assigned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    overrides.batch_id ?? id,
    overrides.created_at ?? new Date().toISOString().replace('T', ' ').slice(0, 19),
    overrides.assigned_at ?? null,
  );

  return id;
}
