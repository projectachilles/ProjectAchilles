import type { DbHelper } from '../../services/agent/database.js';
import { createTestDb } from '../../services/agent/database.js';

/**
 * Create an in-memory Turso database with the full agent schema.
 * Each test gets a fresh, isolated database instance.
 */
export async function createTestDatabase(): Promise<DbHelper> {
  return createTestDb();
}

/**
 * Insert a test agent directly into the database.
 * Returns the agent ID for reference.
 */
export async function insertTestAgent(
  db: DbHelper,
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
): Promise<string> {
  const id = overrides.id ?? 'agent-001';
  const now = new Date().toISOString();

  await db.run(`
    INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, last_heartbeat, last_heartbeat_data, enrolled_at, enrolled_by, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
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
  ]);

  return id;
}

/**
 * Insert a test task directly into the database.
 */
export async function insertTestTask(
  db: DbHelper,
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
    retry_count: number;
    max_retries: number;
    original_task_id: string | null;
  }> = {}
): Promise<string> {
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

  await db.run(`
    INSERT INTO tasks (id, agent_id, org_id, type, priority, status, payload, created_by, ttl, batch_id, created_at, retry_count, max_retries, original_task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
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
    overrides.retry_count ?? 0,
    overrides.max_retries ?? 2,
    overrides.original_task_id ?? null,
  ]);

  return id;
}
