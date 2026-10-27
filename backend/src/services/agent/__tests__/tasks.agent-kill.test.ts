import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';
import type { EdrTermination } from '../../edr/agent-kill-evidence.js';

let testDb: Database.Database;
vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { listAgentKillCandidates, recordEdrTermination } = await import('../tasks.service.js');
const { RESULTS_INDEX_MAPPING } = await import('../../analytics/index-management.service.js');

const OFFLINE = 'Agent went offline during execution';
const OVERDUE = 'Task exceeded execution timeout';

function payload(category: string): string {
  return JSON.stringify({
    test_uuid: 'uuid-1', test_name: 'T', binary_name: 'b.exe', binary_sha256: 'x', binary_size: 1,
    execution_timeout: 300, arguments: [],
    metadata: { category, subcategory: '', severity: 'high', techniques: ['T1003'], tactics: [], threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [] },
  });
}

function addTask(id: string, o: { error?: string; status?: string; category?: string; completed_at?: string; assigned?: boolean; type?: string }): void {
  insertTestTask(testDb, {
    id, agent_id: 'agent-001', status: o.status ?? 'failed', payload: payload(o.category ?? 'intel-driven'),
    type: o.type ?? 'execute_test', assigned_at: o.assigned === false ? null : '2026-10-20 10:00:00',
  });
  const result = o.error
    ? JSON.stringify({ error: o.error, exit_code: -1, stdout: '', stderr: o.error, execution_duration_ms: 0 })
    : null;
  testDb.prepare('UPDATE tasks SET result = ?, completed_at = ? WHERE id = ?')
    .run(result, o.completed_at ?? '2026-10-20 10:30:00', id);
}

const term: EdrTermination = {
  vendors: ['sentinelone'], alert_ids: ['a1'],
  killed_at: '2026-10-20T10:05:00.000Z', reconciled_at: '2026-10-20T10:40:00.000Z',
};

beforeEach(() => {
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'agent-001', hostname: 'SBL4862' });
});

describe('listAgentKillCandidates', () => {
  it('lists watchdog-failed execute_test tasks with the agent hostname', () => {
    addTask('offline', { error: OFFLINE });
    addTask('overdue', { error: OVERDUE });
    addTask('agent-fail', { error: 'binary not found' });
    addTask('done', { status: 'completed' });
    addTask('hygiene', { error: OFFLINE, category: 'cyber-hygiene' });
    addTask('old', { error: OFFLINE, completed_at: '2026-08-01 00:00:00' });
    addTask('unassigned', { error: OFFLINE, assigned: false });
    const rows = listAgentKillCandidates('2026-10-01T00:00:00.000Z');
    expect(rows.map((r) => r.task.id).sort()).toEqual(['offline', 'overdue']);
    expect(rows.every((r) => r.hostname === 'SBL4862' && r.termination === null)).toBe(true);
  });

  it("reports the same agent's next assignment, ignoring other agents", () => {
    insertTestAgent(testDb, { id: 'agent-002', hostname: 'SBL3938' });
    addTask('killed', { error: OVERDUE });
    insertTestTask(testDb, { id: 'other-agent', agent_id: 'agent-002', status: 'completed', assigned_at: '2026-10-20 10:02:00' });
    insertTestTask(testDb, { id: 'earlier', agent_id: 'agent-001', status: 'completed', assigned_at: '2026-10-20 09:00:00' });
    insertTestTask(testDb, { id: 'next', agent_id: 'agent-001', status: 'completed', assigned_at: '2026-10-20 10:07:00' });
    insertTestTask(testDb, { id: 'later', agent_id: 'agent-001', status: 'pending', assigned_at: '2026-10-20 10:20:00' });
    const [row] = listAgentKillCandidates('2026-10-01T00:00:00.000Z');
    expect(row.task.id).toBe('killed');
    expect(row.nextAssignedAt).toBe('2026-10-20 10:07:00');
  });

  it('has no next assignment when the agent ran nothing after the task', () => {
    addTask('killed', { error: OFFLINE });
    const [row] = listAgentKillCandidates('2026-10-01T00:00:00.000Z');
    expect(row.nextAssignedAt).toBeNull();
  });

  it('returns the parsed termination of a reconciled task', () => {
    addTask('k', { error: OFFLINE });
    recordEdrTermination('k', term);
    const [row] = listAgentKillCandidates('2026-10-01T00:00:00.000Z');
    expect(row.termination).toEqual(term);
  });
});

describe('recordEdrTermination', () => {
  it('stamps result and es_ingested but keeps status failed', () => {
    addTask('k', { error: OFFLINE });
    recordEdrTermination('k', term);
    const row = testDb.prepare('SELECT status, es_ingested, result FROM tasks WHERE id = ?').get('k') as { status: string; es_ingested: number; result: string };
    expect(row.status).toBe('failed');
    expect(row.es_ingested).toBe(1);
    const result = JSON.parse(row.result);
    expect(result.edr_terminated.vendors).toEqual(term.vendors);
    expect(result.exit_code).toBe(-1);
  });
});

describe('results mapping', () => {
  it('mapping declares the edr_terminated fields', () => {
    const p = RESULTS_INDEX_MAPPING.mappings.properties.f0rtika.properties;
    expect(p.edr_terminated).toEqual({ type: 'boolean' });
    expect(p.stages_unknown).toEqual({ type: 'boolean' });
    expect(p.edr_terminated_vendors).toEqual({ type: 'keyword' });
    expect(p.edr_terminated_alert_ids).toEqual({ type: 'keyword' });
  });
});
