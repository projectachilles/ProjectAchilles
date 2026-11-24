import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

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

const {
  createTasks, createCommandTasks, createUninstallTasks, createUpdateTasks,
  retryTask, expireStaleTasks, expireOverdueTasks,
} = await import('../tasks.service.js');
const { taskTestVersion } = await import('../testArtifacts.js');

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const WIN = 'win-binary';
const LIN = 'lin-binary';
const WIN_SHA = sha(WIN);
const LIN_SHA = sha(LIN);
const FP = 'f'.repeat(64);

function stamp(over: Record<string, unknown> = {}) {
  return {
    fingerprint: FP,
    source_hash: 'a', shared_hash: 'b', test_tree: 'c',
    commit: 'abc1234', commit_date: '2026-11-01T10:00:00Z',
    provenance: 'git', deps_hash: 'd', modified: false,
    binaries: { 'u.exe': WIN_SHA, 'u-linux': LIN_SHA },
    ...over,
  };
}

function setMeta(meta: Record<string, unknown>) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockImplementation((p: string) => {
    if (p.endsWith('build-meta.json')) return JSON.stringify(meta);
    if (p.endsWith('u.exe')) return Buffer.from(WIN);
    if (p.endsWith('u-linux')) return Buffer.from(LIN);
    return Buffer.from('other');
  });
}

const baseMeta = {
  builtAt: '2026-11-02T08:00:00Z',
  binaries: { windows: { filename: 'u.exe' }, linux: { filename: 'u-linux' } },
};

const req = (agent_ids: string[]) => ({
  agent_ids, test_uuid: 'u', test_name: 'T', binary_name: 'u.exe',
});

function payloadOf(id: string) {
  const row = testDb.prepare('SELECT payload FROM tasks WHERE id = ?').get(id) as { payload: string };
  return JSON.parse(row.payload);
}

describe('taskTestVersion', () => {
  const art = { name: 'u.exe', sha256: WIN_SHA };
  const meta = (v: unknown, extra: Record<string, unknown> = {}) => ({ builtAt: 'T0', version: v, ...extra });

  it('returns every field for a clean stamp with a matching hash', () => {
    expect(taskTestVersion(meta(stamp()), art)).toEqual({
      built_at: 'T0', build_source: 'built', commit: 'abc1234',
      commit_date: '2026-11-01T10:00:00Z', fingerprint: FP,
    });
  });
  it('leaves out version fields when the hash differs', () => {
    expect(taskTestVersion(meta(stamp()), { name: 'u.exe', sha256: 'zz' })).toEqual({ built_at: 'T0', build_source: 'built' });
  });
  it('leaves out version fields when the filename is not stamped', () => {
    expect(taskTestVersion(meta(stamp()), { name: 'other', sha256: WIN_SHA })).toEqual({ built_at: 'T0', build_source: 'built' });
  });
  it('leaves out version fields when modified', () => {
    expect(taskTestVersion(meta(stamp({ modified: true })), art)).toEqual({ built_at: 'T0', build_source: 'built' });
  });
  it('handles a meta without version', () => {
    expect(taskTestVersion({ builtAt: 'T0' }, art)).toEqual({ built_at: 'T0', build_source: 'built' });
  });
  it('reports an uploaded build', () => {
    expect(taskTestVersion({ builtAt: 'T0', source: 'uploaded' }, art)).toEqual({ built_at: 'T0', build_source: 'uploaded' });
  });
  it('omits null commit and commit_date, keeps the fingerprint', () => {
    const r = taskTestVersion(meta(stamp({ commit: null, commit_date: null })), art)!;
    expect(r).toEqual({ built_at: 'T0', build_source: 'built', fingerprint: FP });
    expect(Object.keys(r)).not.toContain('commit');
    expect(Object.keys(r)).not.toContain('commit_date');
  });
  it('returns undefined when the meta has no builtAt or is not an object', () => {
    expect(taskTestVersion({ version: stamp() }, art)).toBeUndefined();
    expect(taskTestVersion(null, art)).toBeUndefined();
    expect(taskTestVersion('x', art)).toBeUndefined();
  });
  it('treats a malformed version as absent', () => {
    const plain = { built_at: 'T0', build_source: 'built' };
    expect(taskTestVersion(meta('nope'), art)).toEqual(plain);
    expect(taskTestVersion(meta(null), art)).toEqual(plain);
    expect(taskTestVersion(meta([1]), art)).toEqual(plain);
    expect(taskTestVersion(meta(stamp({ binaries: undefined })), art)).toEqual(plain);
    expect(taskTestVersion(meta(stamp({ binaries: 'x' })), art)).toEqual(plain);
    expect(taskTestVersion(meta(stamp({ fingerprint: 42 })), art)).toEqual(plain);
    expect(taskTestVersion(meta(stamp({ modified: undefined })), art)).toEqual(plain);
  });
});

describe('createTasks test_version', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-win', os: 'windows' });
    insertTestAgent(testDb, { id: 'agent-lin', os: 'linux' });
  });

  it('clean stamp and matching hash: payload.test_version carries the whole stamp', () => {
    setMeta({ ...baseMeta, version: stamp() });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    expect(payloadOf(id).test_version).toEqual({
      built_at: '2026-11-02T08:00:00Z', build_source: 'built',
      commit: 'abc1234', commit_date: '2026-11-01T10:00:00Z', fingerprint: FP,
    });
  });

  it('stamped hash for that filename differs from the binary on disk: built_at and build_source only', () => {
    setMeta({ ...baseMeta, version: stamp({ binaries: { 'u.exe': 'e'.repeat(64) } }) });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    expect(payloadOf(id).test_version).toEqual({ built_at: '2026-11-02T08:00:00Z', build_source: 'built' });
  });

  it('version.modified: no fingerprint or commit', () => {
    setMeta({ ...baseMeta, version: stamp({ modified: true }) });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    expect(payloadOf(id).test_version).toEqual({ built_at: '2026-11-02T08:00:00Z', build_source: 'built' });
  });

  it('build-meta without version: built_at and build_source only', () => {
    setMeta({ ...baseMeta });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    expect(payloadOf(id).test_version).toEqual({ built_at: '2026-11-02T08:00:00Z', build_source: 'built' });
  });

  it('uploaded build: build_source uploaded, no fingerprint', () => {
    setMeta({ ...baseMeta, source: 'uploaded' });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    expect(payloadOf(id).test_version).toEqual({ built_at: '2026-11-02T08:00:00Z', build_source: 'uploaded' });
  });

  it('a custom test stamp with null commit carries the fingerprint and no commit keys', () => {
    setMeta({ ...baseMeta, version: stamp({ commit: null, commit_date: null }) });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    const tv = payloadOf(id).test_version;
    expect(tv).toEqual({ built_at: '2026-11-02T08:00:00Z', build_source: 'built', fingerprint: FP });
    expect('commit' in tv).toBe(false);
  });

  it('no builtAt in the meta: no test_version at all', () => {
    setMeta({ filename: 'u.exe', version: stamp() });
    const [id] = createTasks(req(['agent-win']), 'org-001', 'user');
    expect('test_version' in payloadOf(id)).toBe(false);
  });

  it('two agents on different OSes each get the stamp checked against their own artifact', () => {
    // Only the Windows binary is vouched for; the Linux one differs from the stamp.
    setMeta({ ...baseMeta, version: stamp({ binaries: { 'u.exe': WIN_SHA, 'u-linux': 'e'.repeat(64) } }) });
    const ids = createTasks(req(['agent-win', 'agent-lin']), 'org-001', 'user');
    const byAgent = new Map(ids.map((id) => {
      const r = testDb.prepare('SELECT agent_id FROM tasks WHERE id = ?').get(id) as { agent_id: string };
      return [r.agent_id, payloadOf(id)] as const;
    }));
    expect(byAgent.get('agent-win')!.test_version.fingerprint).toBe(FP);
    expect(byAgent.get('agent-lin')!.binary_name).toBe('u-linux');
    expect(byAgent.get('agent-lin')!.test_version).toEqual({ built_at: '2026-11-02T08:00:00Z', build_source: 'built' });
  });

  it('manual retry and both automatic retries keep the original test_version and binary_sha256', () => {
    setMeta({ ...baseMeta, version: stamp() });
    const [manual] = createTasks(req(['agent-win']), 'org-001', 'user');
    const [stale] = createTasks(req(['agent-win']), 'org-001', 'user');
    const [overdue] = createTasks(req(['agent-win']), 'org-001', 'user');
    const originals = new Map([manual, stale, overdue].map((id) => [id, payloadOf(id)]));
    expect(originals.get(manual).test_version.fingerprint).toBe(FP);

    testDb.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(manual);
    retryTask(manual, 'user');

    testDb.prepare("UPDATE tasks SET status = 'executing' WHERE id = ?").run(stale);
    testDb.prepare("UPDATE agents SET last_heartbeat = datetime('now', '-1 hour') WHERE id = 'agent-win'").run();
    const origPrepare = testDb.prepare.bind(testDb);
    vi.spyOn(testDb, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('is_back_online')) {
        return { get: () => ({ last_heartbeat: 'x', is_back_online: 1 }) } as unknown;
      }
      return origPrepare(sql);
    }) as never);
    expireStaleTasks();
    vi.restoreAllMocks();

    testDb.prepare("UPDATE tasks SET status = 'executing', assigned_at = '2000-01-01 00:00:00' WHERE id = ?").run(overdue);
    expireOverdueTasks();

    for (const id of [manual, stale, overdue]) {
      const clone = testDb.prepare('SELECT id FROM tasks WHERE original_task_id = ?').get(id) as { id: string } | undefined;
      expect(clone, `retry of ${id}`).toBeDefined();
      const p = payloadOf(clone!.id);
      expect(p.test_version).toEqual(originals.get(id).test_version);
      expect(p.binary_sha256).toBe(WIN_SHA);
    }
  });

  it('execute_command, update_agent and uninstall tasks have no test_version', () => {
    const ids = [
      ...createCommandTasks({ agent_ids: ['agent-win'], command: 'whoami' } as never, 'org-001', 'user'),
      ...createUninstallTasks(['agent-win'], 'org-001', 'user'),
      ...createUpdateTasks(['agent-win'], 'org-001', 'user'),
    ];
    expect(ids).toHaveLength(3);
    for (const id of ids) expect('test_version' in payloadOf(id)).toBe(false);
  });
});
