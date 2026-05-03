import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Mock ingestResult so we can simulate ES success/failure deterministically.
vi.mock('../results.service.js', () => ({
  ingestResult: vi.fn(),
}));

// Imports must be dynamic — they need the mocks above to resolve first.
const { retryPendingIngestions } = await import('../ingestionWorker.service.js');
const { ingestResult } = await import('../results.service.js');
const { MAX_INGEST_ATTEMPTS } = await import('../tasks.service.js');

function setIngestState(taskId: string, es_ingested: number, ingest_attempts: number): void {
  testDb.prepare(`
    UPDATE tasks SET es_ingested = ?, ingest_attempts = ?
    WHERE id = ?
  `).run(es_ingested, ingest_attempts, taskId);
}

function readIngestState(taskId: string): { es_ingested: number; ingest_attempts: number } {
  return testDb.prepare(`
    SELECT es_ingested, ingest_attempts FROM tasks WHERE id = ?
  `).get(taskId) as { es_ingested: number; ingest_attempts: number };
}

function insertCompletedTaskWithResult(taskId: string): void {
  insertTestTask(testDb, {
    id: taskId,
    agent_id: 'agent-001',
    status: 'completed',
    type: 'execute_test',
  });
  // Attach a TaskResult JSON to the result column — required for replay.
  const result = JSON.stringify({
    task_id: taskId,
    test_uuid: 'test-uuid-1',
    exit_code: 101,
    stdout: '', stderr: '',
    started_at: '2026-05-03T00:00:00Z',
    completed_at: '2026-05-03T00:01:00Z',
    execution_duration_ms: 60000,
    binary_sha256: 'abc',
    hostname: 'test-host',
    os: 'linux',
    arch: 'amd64',
  });
  testDb.prepare(`UPDATE tasks SET result = ? WHERE id = ?`).run(result, taskId);
}

describe('ingestionWorker.retryPendingIngestions', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    vi.mocked(ingestResult).mockReset();
  });

  it('attempts ingestion for tasks where es_ingested=0', async () => {
    insertCompletedTaskWithResult('t-pending');
    vi.mocked(ingestResult).mockResolvedValue(undefined);

    const report = await retryPendingIngestions();

    expect(report.attempted).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(0);
    expect(ingestResult).toHaveBeenCalledOnce();
  });

  it('marks task ingested on successful replay', async () => {
    insertCompletedTaskWithResult('t-success');
    vi.mocked(ingestResult).mockResolvedValue(undefined);

    await retryPendingIngestions();

    const state = readIngestState('t-success');
    expect(state.es_ingested).toBe(1);
    expect(state.ingest_attempts).toBe(1);
  });

  it('leaves task at es_ingested=0 and increments attempts on failure', async () => {
    insertCompletedTaskWithResult('t-failing');
    vi.mocked(ingestResult).mockRejectedValue(new Error('ES unreachable'));

    const report = await retryPendingIngestions();

    expect(report.failed).toBe(1);
    const state = readIngestState('t-failing');
    expect(state.es_ingested).toBe(0);
    expect(state.ingest_attempts).toBe(1);
  });

  it('skips tasks that have already been ingested (es_ingested=1)', async () => {
    insertCompletedTaskWithResult('t-done');
    setIngestState('t-done', 1, 1);
    vi.mocked(ingestResult).mockResolvedValue(undefined);

    const report = await retryPendingIngestions();

    expect(report.attempted).toBe(0);
    expect(ingestResult).not.toHaveBeenCalled();
  });

  it('skips tasks that have hit the permanent-failure cap (ingest_attempts >= 10)', async () => {
    insertCompletedTaskWithResult('t-permanent');
    setIngestState('t-permanent', 0, MAX_INGEST_ATTEMPTS);
    vi.mocked(ingestResult).mockResolvedValue(undefined);

    const report = await retryPendingIngestions();

    expect(report.attempted).toBe(0);
    expect(report.permanentlyFailed).toBe(1);
    expect(ingestResult).not.toHaveBeenCalled();
  });

  it('processes a mixed batch independently — failures do not abort successes', async () => {
    insertCompletedTaskWithResult('t-A');
    insertCompletedTaskWithResult('t-B');
    insertCompletedTaskWithResult('t-C');

    vi.mocked(ingestResult)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);

    const report = await retryPendingIngestions();

    expect(report.attempted).toBe(3);
    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(1);

    // The failed one (whichever was second by completed_at order) keeps es_ingested=0
    const ids = ['t-A', 't-B', 't-C'];
    const states = ids.map((id) => ({ id, ...readIngestState(id) }));
    const ingested = states.filter((s) => s.es_ingested === 1);
    const pending = states.filter((s) => s.es_ingested === 0);
    expect(ingested).toHaveLength(2);
    expect(pending).toHaveLength(1);
    expect(pending[0].ingest_attempts).toBe(1);
  });

  it('skips execute_command tasks (only execute_test should be ingested)', async () => {
    insertTestTask(testDb, {
      id: 't-cmd',
      agent_id: 'agent-001',
      status: 'completed',
      type: 'execute_command',
    });
    testDb.prepare(`UPDATE tasks SET result = ? WHERE id = ?`).run(
      JSON.stringify({ exit_code: 0 }),
      't-cmd',
    );
    vi.mocked(ingestResult).mockResolvedValue(undefined);

    const report = await retryPendingIngestions();

    expect(report.attempted).toBe(0);
    expect(ingestResult).not.toHaveBeenCalled();
  });

  it('processes oldest-first (FIFO drain so a backlog does not starve old tasks)', async () => {
    insertCompletedTaskWithResult('t-newer');
    insertCompletedTaskWithResult('t-older');
    // Force completed_at ordering: older was completed yesterday, newer just now.
    testDb.prepare(`UPDATE tasks SET completed_at = '2026-05-01T00:00:00Z' WHERE id = 't-older'`).run();
    testDb.prepare(`UPDATE tasks SET completed_at = '2026-05-03T00:00:00Z' WHERE id = 't-newer'`).run();

    const callOrder: string[] = [];
    vi.mocked(ingestResult).mockImplementation(async (task) => {
      callOrder.push(task.id);
    });

    await retryPendingIngestions();

    expect(callOrder).toEqual(['t-older', 't-newer']);
  });
});
