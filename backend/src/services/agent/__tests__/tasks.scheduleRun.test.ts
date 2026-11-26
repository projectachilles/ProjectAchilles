import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

vi.mock('../test-catalog.service.js', () => ({
  getTestMetadata: () => null,
}));

const { mockExistsSync, mockReadFileSync, mockStatSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockReadFileSync: vi.fn(),
  mockStatSync: vi.fn().mockReturnValue({ size: 1024 }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const overrides = { existsSync: mockExistsSync, readFileSync: mockReadFileSync, statSync: mockStatSync };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const overrides = { homedir: () => '/mock-home' };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getAzureCredentials() { return null; }
  },
}));


const { createTasks, retryTask, expireStaleTasks, expireOverdueTasks } = await import('../tasks.service.js');
const { initializeTables } = await import('../database.js');
const { scheduleRunKey } = await import('../scheduleRun.js');

// tasks.schedule_run records which scheduled run created a task:
// "<schedule id>:<local date of the slot>". The scheduler writes it, retries
// inherit it, and the task list groups by it.

const cols = (db: Database.Database, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const indexes = (db: Database.Database, t: string) =>
  (db.prepare(`PRAGMA index_list(${t})`).all() as { name: string }[]).map((i) => i.name);
const runOf = (where: string) =>
  (testDb.prepare(`SELECT schedule_run FROM tasks WHERE ${where}`).get() as { schedule_run: string | null } | undefined);

function insertScheduled(id: string, extra: Record<string, unknown> = {}) {
  insertTestTask(testDb, { id, agent_id: 'agent-001', ...extra });
  testDb.prepare('UPDATE tasks SET schedule_run = ? WHERE id = ?').run('sch1:2026-10-23', id);
}

describe('scheduleRunKey', () => {
  it('is the schedule id and the local date of the instant in the schedule timezone', () => {
    const at = new Date('2026-11-18T02:30:00Z');
    expect(scheduleRunKey('sch1', 'UTC', at)).toBe('sch1:2026-11-18');
    expect(scheduleRunKey('sch1', 'America/New_York', at)).toBe('sch1:2026-11-17');
  });

  it('falls back to UTC for a missing or invalid timezone', () => {
    const at = new Date('2026-11-18T02:30:00Z');
    expect(scheduleRunKey('sch1', null, at)).toBe('sch1:2026-11-18');
    expect(scheduleRunKey('sch1', 'Not/AZone', at)).toBe('sch1:2026-11-18');
  });
});

describe('tasks.schedule_run schema', () => {
  it('adds the column and its index on a fresh database', () => {
    const db = createTestDatabase();
    expect(cols(db, 'tasks')).toContain('schedule_run');
    expect(indexes(db, 'tasks')).toContain('idx_tasks_schedule_run');
  });

  it('keeps the column, its values and its index through the legacy execute_command table recreation', () => {
    const db = createTestDatabase();
    db.prepare(`INSERT INTO agents (id, org_id, hostname, os, arch, agent_version, api_key_hash, status, enrolled_at, enrolled_by)
      VALUES ('a', 'o', 'h', 'linux', 'amd64', '1', 'x', 'active', 't', 'u')`).run();
    // Rebuild tasks with the pre-execute_command CHECK, keeping schedule_run.
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
        schedule_run TEXT DEFAULT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
      INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by, schedule_run)
        VALUES ('old', 'a', 'o', 'execute_test', '{}', 'u', 'sch1:2026-10-23');
    `);
    db.pragma('foreign_keys = ON');

    initializeTables(db);

    expect(cols(db, 'tasks')).toContain('schedule_run');
    expect(indexes(db, 'tasks')).toContain('idx_tasks_schedule_run');
    expect((db.prepare("SELECT schedule_run FROM tasks WHERE id = 'old'").get() as { schedule_run: string }).schedule_run).toBe('sch1:2026-10-23');
    // The recreation ran: the widened CHECK accepts execute_command.
    expect(() => db.prepare(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by)
      VALUES ('cmd', 'a', 'o', 'execute_command', '{}', 'u')`).run()).not.toThrow();
  });
});

describe('tasks.schedule_run writers', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.endsWith('build-meta.json')) {
        return JSON.stringify({ binary_name: 'test-binary.exe', filename: 'test-binary.exe' });
      }
      return Buffer.from('fake-binary-content');
    });
    mockStatSync.mockReturnValue({ size: 2048 });
  });

  const req = { agent_ids: ['agent-001', 'agent-002'], test_uuid: 'u1', test_name: 'T', binary_name: 'test-binary.exe' };

  it('createTasks writes each agent its own scheduled run', () => {
    const runs: Record<string, string> = { 'agent-001': 'sch1:2026-10-23', 'agent-002': 'sch1:2026-10-24' };
    createTasks(req, 'org', 'user', { scheduleRunFor: (agentId) => runs[agentId] });
    expect(runOf("agent_id = 'agent-001'")?.schedule_run).toBe('sch1:2026-10-23');
    expect(runOf("agent_id = 'agent-002'")?.schedule_run).toBe('sch1:2026-10-24');
  });

  it('leaves schedule_run NULL for a task no schedule created', () => {
    const ids = createTasks(req, 'org', 'user');
    expect(runOf(`id = '${ids[0]}'`)?.schedule_run).toBeNull();
  });

  it('a retry started by hand inherits the scheduled run', () => {
    insertScheduled('orig', { status: 'failed' });
    retryTask('orig', 'u');
    expect(runOf("original_task_id = 'orig'")?.schedule_run).toBe('sch1:2026-10-23');
  });

  it('an automatic retry after the agent went offline inherits the scheduled run', () => {
    insertScheduled('p', { status: 'executing' });
    testDb.prepare("UPDATE agents SET last_heartbeat = datetime('now', '-1 hour') WHERE id = 'agent-001'").run();
    const origPrepare = testDb.prepare.bind(testDb);
    vi.spyOn(testDb, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('is_back_online')) {
        return { get: () => ({ last_heartbeat: 'x', is_back_online: 1 }) } as never;
      }
      return origPrepare(sql);
    }) as never);
    expireStaleTasks();
    vi.restoreAllMocks();
    expect(runOf("original_task_id = 'p'")?.schedule_run).toBe('sch1:2026-10-23');
  });

  it('an automatic retry after a timeout inherits the scheduled run', () => {
    insertScheduled('p', { status: 'executing', assigned_at: '2000-01-01 00:00:00' });
    expireOverdueTasks();
    expect(runOf("original_task_id = 'p'")?.schedule_run).toBe('sch1:2026-10-23');
  });
});
