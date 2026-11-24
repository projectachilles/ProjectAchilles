// The campaign matrix with the real currentFingerprintMap (matrix.test.ts mocks
// it): a library read that never settles must not hold the page or its CSV.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';
import type { TestVersionsService } from '../../browser/testVersions.service.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/database.js')>()),
  getDatabase: () => testDb,
}));
vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: (uuid: string) => ({ uuid, name: `Test ${uuid}`, techniques: [] }),
}));
vi.mock('../../outcomes/edr.js', () => ({
  fetchEdrDocs: async () => ({ status: 'not_configured', docs: new Map() }),
}));
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    isDefenderConfigured() { return false; }
    isCrowdStrikeConfigured() { return false; }
    isSentinelOneConfigured() { return false; }
    isSophosConfigured() { return false; }
  },
}));
vi.mock('../../notices/userLabel.js', () => ({ resolveUserLabel: async (id: string) => id }));

const { getRunMatrix, runMatrixCsv } = await import('../matrix.js');
const { setTestVersionsService } = await import('../../browser/testVersions.service.js');
const { VERSION_READ_BUDGET_MS } = await import('../../browser/currentFingerprints.js');

const ORG = 'org-1';
const COMMIT = 'a'.repeat(7) + '1234567890abcdef1234567890abcdef1';

function insertRun(id: string, tests: string[]) {
  const snapshot = {
    campaign_name: 'C',
    framework_label: null,
    tests: tests.map((t) => ({ uuid: t, name: `Test ${t}` })),
    agents: [{ id: 'a1', hostname: 'host-a1', os: 'windows' }],
    skipped: [],
  };
  testDb
    .prepare(
      `INSERT INTO campaign_runs (id, campaign_id, org_id, started_by, started_at, notice_id, snapshot, task_count)
       VALUES (?, 'c1', ?, 'u1', ?, NULL, ?, 1)`,
    )
    .run(id, ORG, new Date().toISOString(), JSON.stringify(snapshot));
}

function insertTask(id: string, runId: string, test: string, testVersion?: object) {
  testDb
    .prepare(
      `INSERT INTO tasks (id, agent_id, org_id, type, status, payload, result, created_at, completed_at, notice_id, campaign_run_id)
       VALUES (?, 'a1', ?, 'execute_test', 'completed', ?, ?, '2026-10-23 10:00:00', '2026-10-23T10:05:00.000Z', NULL, ?)`,
    )
    .run(
      id, ORG,
      JSON.stringify({ test_uuid: test, test_name: test, metadata: { techniques: [] }, ...(testVersion ? { test_version: testVersion } : {}) }),
      JSON.stringify({ exit_code: 126 }),
      runId,
    );
}

describe('campaign run matrix: a library read that never settles', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'a1', org_id: ORG, hostname: 'host-a1', os: 'windows' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setTestVersionsService({ synced: () => new Promise(() => {}) } as unknown as TestVersionsService);
  });

  afterEach(() => {
    setTestVersionsService(undefined);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the matrix after the bound, with commits and no states', async () => {
    insertRun('r1', ['t1', 't2']);
    insertTask('k1', 'r1', 't1', { built_at: '2026-11-20T10:00:00.000Z', build_source: 'built', commit: COMMIT, fingerprint: 'fp-1' });
    insertTask('k2', 'r1', 't2');
    let settled = false;
    const matrix = getRunMatrix('r1', ORG).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(VERSION_READ_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const m = await matrix;
    expect(m.cells.t1.a1.version).toEqual({ commit: COMMIT, fingerprint: 'fp-1' });
    expect(m.cells.t2.a1.version).toEqual({ commit: null, fingerprint: null, state: 'not_recorded' });
    expect(runMatrixCsv(m).trimEnd().split('\r\n')[1].endsWith(',aaaaaaa,')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
