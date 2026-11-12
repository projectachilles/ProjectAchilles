import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { getTestRunRecency, getAgentRunRecency } = await import('../testRunHistory.js');

const TEST_A = '11111111-1111-4111-8111-111111111111';
const TEST_B = '22222222-2222-4222-8222-222222222222';

interface TaskSeed {
  id: string;
  agent?: string;
  org?: string;
  test?: string;
  status: string;
  completedAt?: string;
  esIngested?: boolean;
  type?: string;
}

function seed(t: TaskSeed): void {
  insertTestTask(testDb, {
    id: t.id,
    agent_id: t.agent ?? 'agent-001',
    org_id: t.org ?? 'org-001',
    type: t.type ?? 'execute_test',
    status: t.status,
    payload: JSON.stringify({ test_uuid: t.test ?? TEST_A, test_name: 'T', binary_name: 't.exe' }),
  });
  testDb.prepare('UPDATE tasks SET completed_at = ?, es_ingested = ? WHERE id = ?')
    .run(t.completedAt ?? null, t.esIngested ? 1 : 0, t.id);
}

describe('getTestRunRecency', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
  });

  it('returns nothing for no tests or a test that never ran', () => {
    expect(getTestRunRecency([])).toEqual([]);
    expect(getTestRunRecency([TEST_A])).toEqual([]);
  });

  it('reports the most recent completed run as an ISO time', () => {
    seed({ id: 't1', status: 'completed', completedAt: '2026-10-01 08:00:00' });
    seed({ id: 't2', status: 'completed', completedAt: '2026-10-20 09:30:00' });
    expect(getTestRunRecency([TEST_A])).toEqual([
      { agent_id: 'agent-001', test_uuid: TEST_A, last_run_at: '2026-10-20T09:30:00Z', queued: false },
    ]);
  });

  it('does not count a cut-off, expired or agent-failed run', () => {
    seed({ id: 't1', status: 'failed', completedAt: '2026-10-20 09:30:00' });
    seed({ id: 't2', status: 'expired', completedAt: '2026-10-21 09:30:00' });
    expect(getTestRunRecency([TEST_A])).toEqual([
      { agent_id: 'agent-001', test_uuid: TEST_A, last_run_at: null, queued: false },
    ]);
  });

  it('counts a watchdog-failed run the EDR-kill pass reconciled', () => {
    seed({ id: 't1', status: 'failed', completedAt: '2026-10-20 09:30:00', esIngested: true });
    expect(getTestRunRecency([TEST_A])[0].last_run_at).toBe('2026-10-20T09:30:00Z');
  });

  it.each(['pending', 'assigned', 'downloading', 'executing'])('marks a %s task as queued', (status) => {
    seed({ id: 't1', status: 'completed', completedAt: '2026-10-01 08:00:00' });
    seed({ id: 't2', status });
    expect(getTestRunRecency([TEST_A])).toEqual([
      { agent_id: 'agent-001', test_uuid: TEST_A, last_run_at: '2026-10-01T08:00:00Z', queued: true },
    ]);
  });

  it('keeps agents and tests apart and ignores other tests and task types', () => {
    seed({ id: 't1', status: 'completed', completedAt: '2026-10-01 08:00:00' });
    seed({ id: 't2', agent: 'agent-002', status: 'completed', completedAt: '2026-10-05 08:00:00' });
    seed({ id: 't3', test: TEST_B, status: 'completed', completedAt: '2026-10-09 08:00:00' });
    seed({ id: 't4', type: 'execute_command', status: 'completed', completedAt: '2026-10-30 08:00:00' });

    const onlyA = getTestRunRecency([TEST_A]);
    expect(onlyA.map((r) => [r.agent_id, r.last_run_at]).sort()).toEqual([
      ['agent-001', '2026-10-01T08:00:00Z'],
      ['agent-002', '2026-10-05T08:00:00Z'],
    ]);

    const both = getTestRunRecency([TEST_A, TEST_B]);
    expect(both).toHaveLength(3);
    expect(both.find((r) => r.test_uuid === TEST_B)).toMatchObject({
      agent_id: 'agent-001', last_run_at: '2026-10-09T08:00:00Z',
    });
  });

  it('limits rows to the given organization', () => {
    seed({ id: 't1', status: 'completed', completedAt: '2026-10-01 08:00:00' });
    seed({ id: 't2', agent: 'agent-002', org: 'org-002', status: 'completed', completedAt: '2026-10-05 08:00:00' });
    expect(getTestRunRecency([TEST_A], 'org-002').map((r) => r.agent_id)).toEqual(['agent-002']);
    expect(getTestRunRecency([TEST_A])).toHaveLength(2);
  });
});

describe('getAgentRunRecency', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'host-2' });
  });

  it('reports the latest run of any test per agent', () => {
    seed({ id: 't1', test: TEST_A, status: 'completed', completedAt: '2026-10-01 08:00:00' });
    seed({ id: 't2', test: TEST_B, status: 'completed', completedAt: '2026-10-09 08:00:00' });
    seed({ id: 't3', agent: 'agent-002', status: 'pending' });
    expect(getAgentRunRecency().sort((a, b) => a.agent_id.localeCompare(b.agent_id))).toEqual([
      { agent_id: 'agent-001', last_run_at: '2026-10-09T08:00:00Z', queued: false },
      { agent_id: 'agent-002', last_run_at: null, queued: true },
    ]);
  });

  it('ignores non-test tasks and runs that produced no result', () => {
    seed({ id: 't1', type: 'execute_command', status: 'completed', completedAt: '2026-10-30 08:00:00' });
    expect(getAgentRunRecency()).toEqual([]);
    seed({ id: 't2', status: 'failed', completedAt: '2026-10-20 09:30:00' });
    expect(getAgentRunRecency()).toEqual([{ agent_id: 'agent-001', last_run_at: null, queued: false }]);
  });

  it('limits rows to the given organization', () => {
    seed({ id: 't1', status: 'completed', completedAt: '2026-10-01 08:00:00' });
    seed({ id: 't2', agent: 'agent-002', org: 'org-002', status: 'completed', completedAt: '2026-10-05 08:00:00' });
    expect(getAgentRunRecency('org-002').map((r) => r.agent_id)).toEqual(['agent-002']);
  });
});
