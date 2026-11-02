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

const { taskDownloadBytes, tryReserveDownload, _resetDownloadBudget } =
  await import('../downloadBudget.js');
const { getNextTask } = await import('../tasks.service.js');

const MB = 1_048_576;
const T0 = 1_800_000_000_000;

describe('taskDownloadBytes', () => {
  it('reads binary_size for execute_test and update_agent only', () => {
    expect(taskDownloadBytes('execute_test', { binary_size: 5 })).toBe(5);
    expect(taskDownloadBytes('update_agent', { binary_size: 7 })).toBe(7);
    expect(taskDownloadBytes('execute_command', { binary_size: 7 })).toBe(0);
    expect(taskDownloadBytes('uninstall', {})).toBe(0);
    expect(taskDownloadBytes('execute_test', { binary_size: -1 })).toBe(0);
    expect(taskDownloadBytes('execute_test', { binary_size: 'x' })).toBe(0);
  });
});

describe('tryReserveDownload', () => {
  beforeEach(() => _resetDownloadBudget(100));

  it('allows up to the per-minute budget, then defers', () => {
    const seq = Array.from({ length: 6 }, () => tryReserveDownload(20 * MB, T0));
    expect(seq).toEqual([true, true, true, true, true, false]);
    expect(tryReserveDownload(20 * MB, T0 + 60_000)).toBe(true);
  });

  it('allows one overdraw', () => {
    expect(tryReserveDownload(90 * MB, T0)).toBe(true);
    expect(tryReserveDownload(40 * MB, T0)).toBe(true);
    expect(tryReserveDownload(1 * MB, T0)).toBe(false);
  });

  it('never starves a binary larger than the budget', () => {
    _resetDownloadBudget(10);
    expect(tryReserveDownload(40 * MB, T0)).toBe(true);
    expect(tryReserveDownload(40 * MB, T0)).toBe(false);
    expect(tryReserveDownload(40 * MB, T0 + 60_000)).toBe(true);
  });

  it('0 disables the budget', () => {
    _resetDownloadBudget(0);
    for (let i = 0; i < 1000; i++) expect(tryReserveDownload(40 * MB, T0)).toBe(true);
  });

  it('zero-byte tasks never consume', () => {
    expect(tryReserveDownload(500 * MB, T0)).toBe(true);
    expect(tryReserveDownload(1, T0)).toBe(false);
    expect(tryReserveDownload(0, T0)).toBe(true);
    expect(tryReserveDownload(0, T0)).toBe(true);
  });
});

describe('getNextTask download budget', () => {
  const NOW = new Date('2026-10-23T12:00:00.000Z');

  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    insertTestAgent(testDb, { id: 'agent-002' });
    _resetDownloadBudget(10);
  });

  const big = JSON.stringify({
    test_uuid: 'u', test_name: 'n', binary_name: 'b.exe', binary_sha256: 'x',
    binary_size: 40 * MB, execution_timeout: 300, arguments: [],
  });

  it('leaves a deferred test pending and still serves it later', () => {
    insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', payload: big });
    insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', payload: big });
    expect(getNextTask('agent-001', NOW)?.id).toBe('t1');
    expect(getNextTask('agent-002', NOW)).toBeNull();
    const row = testDb.prepare('SELECT status FROM tasks WHERE id = ?').get('t2') as { status: string };
    expect(row.status).toBe('pending');
    expect(getNextTask('agent-002', new Date(NOW.getTime() + 60_000))?.id).toBe('t2');
  });

  it('does not defer command tasks', () => {
    insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', payload: big });
    insertTestTask(testDb, { id: 't2', agent_id: 'agent-002', type: 'execute_command', payload: JSON.stringify({ command: 'ls' }) });
    expect(getNextTask('agent-001', NOW)?.id).toBe('t1');
    expect(getNextTask('agent-002', NOW)?.id).toBe('t2');
  });

  it('deferred tasks still respect notice holds', () => {
    testDb.prepare(`
      INSERT INTO run_notices (id, kind, state, source_type, timezone, created_by, created_at, release_at, pickup_deadline)
      VALUES ('n1', 'run', 'pending', 'run_now', 'UTC', 'u', ?, NULL, NULL)
    `).run(NOW.toISOString());
    insertTestTask(testDb, { id: 't1', agent_id: 'agent-001', payload: big });
    testDb.prepare('UPDATE tasks SET notice_id = ? WHERE id = ?').run('n1', 't1');
    // held: not assigned, and must not consume budget
    expect(getNextTask('agent-001', NOW)).toBeNull();
    testDb.prepare(`UPDATE run_notices SET state='sent', release_at=?, pickup_deadline=? WHERE id='n1'`)
      .run(new Date(NOW.getTime() - 1000).toISOString(), new Date(NOW.getTime() + 3600_000).toISOString());
    expect(getNextTask('agent-001', NOW)?.id).toBe('t1');
  });
});
