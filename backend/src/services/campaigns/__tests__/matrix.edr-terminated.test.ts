import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/database.js')>()),
  getDatabase: () => testDb,
}));
vi.mock('../../outcomes/edr.js', () => ({
  fetchEdrDocs: async () => ({ status: 'not_configured', docs: new Map() }),
}));
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    isDefenderConfigured() { return false; }
    isCrowdStrikeConfigured() { return false; }
    isSentinelOneConfigured() { return true; }
  },
}));
vi.mock('../../notices/userLabel.js', () => ({ resolveUserLabel: async (id: string) => id }));

const { getRunMatrix, runMatrixCsv } = await import('../matrix.js');

const ORG = 'org-1';
const OFFLINE = 'Agent went offline during execution';
const TERMINATION = {
  vendors: ['sentinelone'],
  alert_ids: ['s1-threat-1'],
  killed_at: '2026-10-26T16:06:32.000Z',
  reconciled_at: '2026-10-26T16:12:00.000Z',
};

function insertRun(id: string, tests: string[], agents: string[]) {
  const snapshot = {
    campaign_name: 'C',
    framework_label: null,
    tests: tests.map((t) => ({ uuid: t, name: `Test ${t}` })),
    agents: agents.map((a) => ({ id: a, hostname: `host-${a}`, os: 'windows' })),
    skipped: [],
  };
  testDb
    .prepare(`INSERT INTO campaign_runs (id, campaign_id, org_id, started_by, started_at, snapshot, task_count)
              VALUES (?, 'c1', ?, 'u1', ?, ?, 1)`)
    .run(id, ORG, new Date().toISOString(), JSON.stringify(snapshot));
}

function insertTask(id: string, test: string, status: string, result: object, esIngested = 0) {
  testDb
    .prepare(`INSERT INTO tasks (id, agent_id, org_id, type, status, payload, result, created_at, completed_at, campaign_run_id, es_ingested)
              VALUES (?, 'a1', ?, 'execute_test', ?, ?, ?, '2026-10-26 16:00:00', '2026-10-26 16:12:00', 'r1', ?)`)
    .run(id, ORG, status, JSON.stringify({ test_uuid: test, metadata: { techniques: ['T1003'] } }), JSON.stringify(result), esIngested);
}

describe('campaign matrix: EDR-killed runs', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'a1', org_id: ORG, hostname: 'host-a1', os: 'windows' });
  });

  it('matrix shows a reconciled failed task as protected', async () => {
    insertRun('r1', ['t1'], ['a1']);
    insertTask('k1', 't1', 'failed', { error: OFFLINE, exit_code: -1, edr_terminated: TERMINATION }, 1);
    const m = await getRunMatrix('r1', ORG);
    expect(m.cells.t1.a1).toMatchObject({
      state: 'protected',
      task_id: 'k1',
      reason: 'Stopped by SentinelOne: the EDR terminated the agent and the test. Stages not reported.',
      edr: 'SentinelOne: prevented (agent terminated)',
      stages: [],
      stages_text: 'stages unknown',
    });
    expect(runMatrixCsv(m)).toContain(',protected,-1,Stopped by SentinelOne: the EDR terminated the agent and the test. Stages not reported.,');
  });

  it('matrix still shows an unreconciled failed task as error', async () => {
    insertRun('r1', ['t1'], ['a1']);
    insertTask('k1', 't1', 'failed', { error: OFFLINE, exit_code: -1 });
    expect((await getRunMatrix('r1', ORG)).cells.t1.a1).toMatchObject({ state: 'error', reason: OFFLINE, stages_text: '' });
  });

  it('percent_protected counts it', async () => {
    insertRun('r1', ['t1', 't2'], ['a1']);
    insertTask('k1', 't1', 'failed', { error: OFFLINE, exit_code: -1, edr_terminated: TERMINATION }, 1);
    insertTask('k2', 't2', 'completed', { exit_code: 101 });
    expect((await getRunMatrix('r1', ORG)).totals).toMatchObject({ protected: 1, unprotected: 1, error: 0, percent_protected: 50 });
  });
});
