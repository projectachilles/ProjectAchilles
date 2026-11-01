import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';
import { initializeTables } from '../database.js';
import type { TaskResult, BundleControlResult, TaskStatus, TaskType } from '../../../types/agent.js';

let testDb: Database.Database;
vi.mock('../database.js', async (orig) => ({
  ...(await orig<typeof import('../database.js')>()),
  getDatabase: () => testDb,
}));

const { compactResult, compactTaskResults, pruneAgentEvents, getRetentionSettings, runRetentionTick } =
  await import('../retention.service.js');
const { classifyTaskOutcome } = await import('../../outcomes/taskOutcome.js');
const { controlsOf } = await import('../../outcomes/verdict.js');

const NOW = new Date('2026-11-01T12:00:00Z');
const OLD = '2026-06-01 10:00:00';
const RECENT = '2026-10-25 10:00:00';

function control(i: number): BundleControlResult {
  return {
    control_id: `C-${i}`, control_name: `n${i}`, validator: 'v', exit_code: i === 1 ? 101 : 126,
    compliant: i !== 1, severity: 'high', category: 'c', subcategory: 's',
    techniques: ['T1059'], tactics: ['execution'], expected: `exp${i}`, actual: `act${i}`,
    details: 'd'.repeat(5000), skipped: i === 2, error_message: '', description: 'desc',
  };
}

function result(over: Partial<TaskResult> = {}): TaskResult {
  return {
    task_id: 't', test_uuid: 'u', exit_code: 126, stdout: 'o'.repeat(50_000),
    stderr: Array.from({ length: 2000 }, (_, i) => String(i % 10)).join(''),
    started_at: 'a', completed_at: 'b', execution_duration_ms: 5, binary_sha256: 'x',
    hostname: 'h', os: 'windows', arch: 'amd64', ...over,
  };
}

function bundle(): TaskResult {
  return result({
    bundle_results: {
      schema_version: '1', bundle_id: 'b', bundle_name: 'B', bundle_category: 'intel-driven',
      bundle_subcategory: '', total_controls: 3, passed: 2, failed: 1,
      controls: [control(0), control(1), control(2)],
    } as unknown as TaskResult['bundle_results'],
  });
}

let n = 0;
function insertTask(opts: {
  completedAt: string | null; status?: TaskStatus; type?: TaskType; ingested?: number;
  result?: TaskResult | null;
}): string {
  const id = `task-${++n}`;
  testDb.prepare(
    `INSERT INTO tasks (id, agent_id, org_id, type, status, payload, result, completed_at, created_by, es_ingested)
     VALUES (?, 'agent-1', 'org', ?, ?, '{}', ?, ?, 'u', ?)`,
  ).run(
    id, opts.type ?? 'execute_test', opts.status ?? 'completed',
    opts.result === null ? null : JSON.stringify(opts.result ?? result()),
    opts.completedAt, opts.ingested ?? 1,
  );
  return id;
}

const compactedAt = (id: string) =>
  (testDb.prepare('SELECT result_compacted_at AS c FROM tasks WHERE id = ?').get(id) as { c: string | null }).c;

beforeEach(() => {
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'agent-1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('compactResult', () => {
  it('keeps everything verdicts read', () => {
    const input = bundle();
    input.error = 'boom';
    const before = JSON.parse(JSON.stringify(input)) as TaskResult;
    const out = compactResult(input, '2026-11-01T12:00:00.000Z');

    expect(out.stdout).toBe('');
    expect(out.stderr).toHaveLength(400);
    expect(out.stderr).toBe(before.stderr.slice(-400));
    expect(out.exit_code).toBe(before.exit_code);
    expect(out.error).toBe('boom');
    expect(out.compacted_at).toBe('2026-11-01T12:00:00.000Z');
    const controls = out.bundle_results!.controls;
    expect(controls).toHaveLength(3);
    controls.forEach((c, i) => {
      const { details, ...rest } = c;
      const { details: _d, ...origRest } = before.bundle_results!.controls[i];
      expect(details).toBe('');
      expect(rest).toEqual(origRest);
    });
    // pure: input untouched
    expect(input).toEqual(before);
  });

  it('keeps edr_terminated and leaves a short stderr and bundle-less result alone', () => {
    const edr = { vendors: ['crowdstrike'], alert_ids: ['a'] } as unknown as TaskResult['edr_terminated'];
    const out = compactResult(result({ edr_terminated: edr, stderr: 'short' }), 'iso');
    expect(out.edr_terminated).toEqual(edr);
    expect(out.stderr).toBe('short');
    expect(out.bundle_results).toBeUndefined();
  });
});

describe('verdicts are identical before and after compaction', () => {
  const fixtures: Array<[string, TaskStatus, TaskResult]> = [
    ['bundle protected', 'completed', bundle()],
    ['single 101', 'completed', result({ exit_code: 101 })],
    ['error 999', 'completed', result({ exit_code: 999 })],
    ['edr_terminated failed', 'failed', result({
      exit_code: -1, error: 'Agent went offline during execution',
      edr_terminated: { vendors: ['sentinelone'], alert_ids: ['a1'] } as unknown as TaskResult['edr_terminated'],
    })],
  ];

  it.each(fixtures)('%s', (_name, status, res) => {
    const compacted = compactResult(res, 'iso');
    expect(classifyTaskOutcome({ type: 'execute_test', status, result: compacted }))
      .toEqual(classifyTaskOutcome({ type: 'execute_test', status, result: res }));
    // The exact columns the campaign matrix reads
    expect(controlsOf(compacted.bundle_results?.controls)).toEqual(controlsOf(res.bundle_results?.controls));
    expect(compacted.stderr.slice(-400)).toBe(res.stderr.slice(-400));
    expect(compacted.edr_terminated).toEqual(res.edr_terminated);
    expect(compacted.error).toBe(res.error);
    expect(compacted.exit_code).toBe(res.exit_code);
  });
});

describe('compactTaskResults', () => {
  it('compacts only old, finished, ingested tasks', () => {
    const oldDone = insertTask({ completedAt: OLD });
    const oldFailed = insertTask({ completedAt: OLD, status: 'failed' });
    const oldNotIngested = insertTask({ completedAt: OLD, ingested: 0 });
    const oldUpdate = insertTask({ completedAt: OLD, type: 'update_agent', ingested: 0 });
    const recent = insertTask({ completedAt: RECENT });
    const oldPending = insertTask({ completedAt: null, status: 'pending' });

    // 2 + oldFailed = 3 eligible; oldFailed is old+failed+ingested
    expect(compactTaskResults({ olderThanDays: 90, now: NOW })).toBe(3);
    expect(compactedAt(oldDone)).not.toBeNull();
    expect(compactedAt(oldFailed)).not.toBeNull();
    expect(compactedAt(oldUpdate)).not.toBeNull();
    expect(compactedAt(oldNotIngested)).toBeNull();
    expect(compactedAt(recent)).toBeNull();
    expect(compactedAt(oldPending)).toBeNull();

    const stored = JSON.parse(
      (testDb.prepare('SELECT result FROM tasks WHERE id = ?').get(oldDone) as { result: string }).result,
    ) as TaskResult;
    expect(stored.stdout).toBe('');
    expect(stored.compacted_at).toBe(NOW.toISOString());
    const untouched = JSON.parse(
      (testDb.prepare('SELECT result FROM tasks WHERE id = ?').get(oldNotIngested) as { result: string }).result,
    ) as TaskResult;
    expect(untouched.stdout).toHaveLength(50_000);
  });

  it('is idempotent', () => {
    insertTask({ completedAt: OLD });
    insertTask({ completedAt: OLD, type: 'update_agent', ingested: 0 });
    expect(compactTaskResults({ olderThanDays: 90, now: NOW })).toBe(2);
    expect(compactTaskResults({ olderThanDays: 90, now: NOW })).toBe(0);
  });

  it('respects maxRows and batches', () => {
    for (let i = 0; i < 12; i++) insertTask({ completedAt: OLD });
    expect(compactTaskResults({ olderThanDays: 90, now: NOW, maxRows: 5, batchSize: 2 })).toBe(5);
    expect(compactTaskResults({ olderThanDays: 90, now: NOW, batchSize: 5 })).toBe(7);
  });

  it('skips rows without a result and survives an unparseable one', () => {
    insertTask({ completedAt: OLD, result: null });
    const bad = insertTask({ completedAt: OLD });
    testDb.prepare('UPDATE tasks SET result = ? WHERE id = ?').run('not json', bad);
    expect(compactTaskResults({ olderThanDays: 90, now: NOW })).toBe(1);
    expect(compactTaskResults({ olderThanDays: 90, now: NOW })).toBe(0);
  });
});

describe('retention settings and tick', () => {
  it('defaults to 90, parses integers, falls back on junk', () => {
    expect(getRetentionSettings()).toEqual({ taskOutputDays: 90, agentEventDays: 90 });
    vi.stubEnv('TASK_OUTPUT_RETENTION_DAYS', '30');
    vi.stubEnv('AGENT_EVENT_RETENTION_DAYS', '-5');
    expect(getRetentionSettings()).toEqual({ taskOutputDays: 30, agentEventDays: 90 });
    vi.stubEnv('TASK_OUTPUT_RETENTION_DAYS', '1.5');
    vi.stubEnv('AGENT_EVENT_RETENTION_DAYS', 'abc');
    expect(getRetentionSettings()).toEqual({ taskOutputDays: 90, agentEventDays: 90 });
    vi.stubEnv('TASK_OUTPUT_RETENTION_DAYS', '0');
    expect(getRetentionSettings().taskOutputDays).toBe(0);
  });

  it('retention 0 disables each job in the tick', () => {
    const id = insertTask({ completedAt: '2000-01-01 00:00:00' });
    testDb.prepare(`INSERT INTO agent_events (agent_id, event_type, created_at) VALUES ('agent-1', 'enrolled', '2000-01-01 00:00:00')`).run();
    vi.stubEnv('TASK_OUTPUT_RETENTION_DAYS', '0');
    vi.stubEnv('AGENT_EVENT_RETENTION_DAYS', '0');
    expect(runRetentionTick()).toEqual({ compacted: 0, pruned: 0 });
    expect(compactedAt(id)).toBeNull();
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM agent_events').get()).toEqual({ c: 1 });

    vi.unstubAllEnvs();
    expect(runRetentionTick()).toEqual({ compacted: 1, pruned: 1 });
  });
});

describe('pruneAgentEvents', () => {
  it('deletes only older rows', () => {
    const ins = testDb.prepare(`INSERT INTO agent_events (agent_id, event_type, created_at) VALUES ('agent-1', 'came_online', ?)`);
    for (let i = 0; i < 3; i++) ins.run(OLD);
    for (let i = 0; i < 2; i++) ins.run(RECENT);
    expect(pruneAgentEvents({ olderThanDays: 90, now: NOW })).toBe(3);
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM agent_events').get()).toEqual({ c: 2 });
  });

  it('deletes across more than one batch', () => {
    const ins = testDb.prepare(`INSERT INTO agent_events (agent_id, event_type, created_at) VALUES ('agent-1', 'came_online', ?)`);
    testDb.transaction(() => { for (let i = 0; i < 2500; i++) ins.run(OLD); })();
    expect(pruneAgentEvents({ olderThanDays: 90, now: NOW })).toBe(2500);
  });
});

describe('schema', () => {
  const indexSql = (db: Database.Database, name: string) =>
    (db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name=?`).get(name) as { sql: string } | undefined)?.sql;

  it('fresh DB has the column and both indexes', () => {
    const cols = (testDb.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('result_compacted_at');
    expect(indexSql(testDb, 'idx_tasks_compactable')).toMatch(/WHERE result_compacted_at IS NULL/);
    expect(indexSql(testDb, 'idx_agent_events_created')).toBeDefined();
  });

  it('result_compacted_at survives the tasks table recreation', () => {
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
        result_compacted_at TEXT DEFAULT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
    `);
    insertTestAgent(db, { id: 'agent-1' });
    db.prepare(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by, result_compacted_at)
      VALUES ('t1', 'agent-1', 'o', 'execute_test', '{}', 'u', '2026-11-01T00:00:00.000Z')`).run();
    db.pragma('foreign_keys = ON');

    initializeTables(db); // CHECK lacks execute_command -> forces migrateExecuteCommandType

    expect(() => db.prepare(`INSERT INTO tasks (id, agent_id, org_id, type, payload, created_by)
      VALUES ('t2', 'agent-1', 'o', 'execute_command', '{}', 'u')`).run()).not.toThrow();
    expect(db.prepare(`SELECT result_compacted_at AS c FROM tasks WHERE id = 't1'`).get())
      .toEqual({ c: '2026-11-01T00:00:00.000Z' });
    expect(indexSql(db, 'idx_tasks_compactable')).toMatch(/WHERE result_compacted_at IS NULL/);
  });

  it('idx_agent_events_created survives the agent_events recreation', () => {
    const db = createTestDatabase();
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE agent_events;
      CREATE TABLE agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('enrolled','went_offline','came_online','task_failed',
          'task_completed','version_updated','key_rotated','status_changed','decommissioned')),
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );
    `);
    db.pragma('foreign_keys = ON');
    initializeTables(db);
    expect(indexSql(db, 'idx_agent_events_created')).toBeDefined();
    expect(db.prepare(`SELECT sql FROM sqlite_master WHERE name='agent_events'`).get())
      .toEqual({ sql: expect.stringContaining('key_rotation_cancelled') });
  });
});
