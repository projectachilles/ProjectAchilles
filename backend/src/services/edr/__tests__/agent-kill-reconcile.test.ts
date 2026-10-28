import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import Database from 'better-sqlite3';
import type { Client } from '@elastic/elasticsearch';
import { createTestDatabase, insertTestAgent, insertTestTask } from '../../../__tests__/helpers/db.js';

// ── Mocks ──────────────────────────────────────────────────────────
let testDb: Database.Database;
vi.mock('../../agent/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent/database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// One fake ES client serves both the reconciler (msearch, alert markers) and
// results.service (the kill doc write), so `mockIndex` sees the real doc.
const mockMsearch = vi.fn();
const mockBulk = vi.fn();
const mockIndex = vi.fn();
const mockPutMapping = vi.fn();
const esClient = { msearch: mockMsearch, bulk: mockBulk, index: mockIndex, indices: { putMapping: mockPutMapping } };

let esConfigured = true;
let writeIndexRollover = 'none';
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = () => ({
      configured: esConfigured, indexPattern: 'achilles-results-*',
      writeIndexPrefix: 'achilles-results-acme-', writeIndexRollover,
    });
    isConfigured = () => esConfigured;
  },
}));
vi.mock('../../analytics/client.js', () => ({ createEsClient: () => esClient }));

// Dated rollover auto-creates the day's index; record it instead.
const mockCreateResultsIndex = vi.fn();
vi.mock('../../analytics/index-management.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/index-management.service.js')>()),
  createResultsIndex: (...args: unknown[]) => mockCreateResultsIndex(...args),
}));

const mockResolveTestNames = vi.fn();
vi.mock('../../analytics/test-name-lookup.js', () => ({
  resolveTestNames: (...args: unknown[]) => mockResolveTestNames(...args),
}));

let mockCatalog = new Map<string, { name: string; isMultiStage: boolean }>();
vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: (uuid: string) => mockCatalog.get(uuid) ?? null,
}));

let edrConfigured = { defender: true, crowdstrike: true, sentinelone: true };
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    isDefenderConfigured = () => edrConfigured.defender;
    isCrowdStrikeConfigured = () => edrConfigured.crowdstrike;
    isSentinelOneConfigured = () => edrConfigured.sentinelone;
  },
}));

const { EdrAgentKillReconciler, runAgentKillReconciliation, resetAgentKillLookback } = await import('../agent-kill-reconcile.service.js');
const { resetClient } = await import('../../agent/results.service.js');

// ── Fixtures (a customer fleet, Oct 26 2026: LockBit 3.0 batch a75d8c3e) ──
const OFFLINE = 'Agent went offline during execution';
const LOCKBIT_UUID = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';
const LOCKBIT_TECHNIQUES = ['T1059.001', 'T1003.001', 'T1021.002', 'T1567.002', 'T1486'];
const NOW = new Date('2026-10-26T17:00:00.000Z');
const S1 = 'achilles-sentinelone';
const DEFENDER = 'achilles-defender';
const CROWDSTRIKE = 'achilles-crowdstrike';

type AlertHit = { _id: string; _source: Record<string, unknown> };
let alertStore: Record<string, AlertHit[]>;
let indexErrors: Record<string, Record<string, unknown>>;

function lockbitPayload(category = 'intel-driven'): string {
  return JSON.stringify({
    test_uuid: LOCKBIT_UUID, test_name: 'LockBit 3.0', binary_name: `${LOCKBIT_UUID}.exe`, binary_sha256: 'x', binary_size: 1,
    execution_timeout: 300, arguments: [],
    metadata: { category, subcategory: 'ransomware', severity: 'critical', techniques: LOCKBIT_TECHNIQUES, tactics: [], threat_actor: 'LockBit', target: ['windows'], complexity: 'high', tags: [], score: 9, integrations: [] },
  });
}

function addKilledTask(id: string, agentId: string, assigned: string, failed: string, error = OFFLINE): void {
  insertTestTask(testDb, { id, agent_id: agentId, status: 'failed', payload: lockbitPayload(), assigned_at: assigned });
  testDb.prepare('UPDATE tasks SET result = ?, completed_at = ? WHERE id = ?').run(
    JSON.stringify({ error, exit_code: -1, stdout: '', stderr: error, execution_duration_ms: 0 }), failed, id,
  );
}

function s1Threat(id: string, host: string, createdAt: string, extra: Record<string, unknown> = {}): AlertHit {
  return {
    _id: id,
    _source: {
      doc_type: 'alert', created_at: createdAt, evidence_hostnames: [host],
      evidence_filenames: ['achilles-agent-windows-amd64.exe'],
      mitre_techniques: ['T1003.001', 'T1059.001', 'T1053.005', 'T1547.001'],
      prevention_action: 'process_killed', ...extra,
    },
  };
}

function taskRow(id: string): { es_ingested: number; status: string; result: { edr_terminated?: { vendors: string[]; alert_ids: string[]; killed_at: string } } } {
  const row = testDb.prepare('SELECT es_ingested, status, result FROM tasks WHERE id = ?').get(id) as { es_ingested: number; status: string; result: string };
  return { ...row, result: JSON.parse(row.result) };
}

/** Every `doc` body the reconciler sent through bulk, in order. */
function bulkDocs(): Array<{ meta: { _index: string; _id: string }; doc: Record<string, unknown> }> {
  const out: Array<{ meta: { _index: string; _id: string }; doc: Record<string, unknown> }> = [];
  for (const [arg] of mockBulk.mock.calls) {
    const ops = (arg as { operations: Array<Record<string, unknown>> }).operations;
    for (let i = 0; i < ops.length; i += 2) {
      out.push({ meta: ops[i].update as { _index: string; _id: string }, doc: ops[i + 1].doc as Record<string, unknown> });
    }
  }
  return out;
}

function reconciler(): InstanceType<typeof EdrAgentKillReconciler> {
  return new EdrAgentKillReconciler(esClient as unknown as Client, 'achilles-results-*');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClient();
  resetAgentKillLookback();
  testDb = createTestDatabase();
  insertTestAgent(testDb, { id: 'agent-4862', hostname: 'LT4862', os: 'windows' });
  insertTestAgent(testDb, { id: 'agent-3938', hostname: 'LT3938', os: 'windows' });
  alertStore = {};
  indexErrors = {};
  esConfigured = true;
  writeIndexRollover = 'none';
  edrConfigured = { defender: true, crowdstrike: true, sentinelone: true };
  mockCatalog = new Map();
  // Fake msearch: every sub-search gets all alerts of its index, so the code's
  // own evidence rule (not the ES prefilter) decides what qualifies.
  mockMsearch.mockImplementation(async ({ searches }: { searches: Array<Record<string, unknown>> }) => {
    const responses: unknown[] = [];
    for (let i = 0; i < searches.length; i += 2) {
      const index = searches[i].index as string;
      if (indexErrors[index]) responses.push({ error: indexErrors[index], status: 404 });
      else responses.push({ hits: { hits: (alertStore[index] ?? []).map((h) => ({ _index: index, ...h })) } });
    }
    return { responses };
  });
  mockBulk.mockResolvedValue({ errors: false, items: [] });
  mockIndex.mockResolvedValue({ result: 'created' });
  mockPutMapping.mockResolvedValue({ acknowledged: true });
  mockResolveTestNames.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────

describe('EdrAgentKillReconciler.runPass', () => {
  it('reconciles the LT4862 S1 agent kill', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];

    const result = await reconciler().runPass({ now: NOW });

    expect(result).toEqual({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });
    expect(mockIndex).toHaveBeenCalledTimes(1);
    const { id, document } = mockIndex.mock.calls[0][0];
    expect(id).toBe('8089b475');
    expect(document.routing).toMatchObject({ hostname: 'LT4862', event_time: '2026-10-26T16:06:32.719Z' });
    expect(document.event.ERROR).toBe(126);
    expect(document.f0rtika).toMatchObject({
      test_uuid: LOCKBIT_UUID, edr_terminated: true, stages_unknown: true,
      edr_terminated_vendors: ['sentinelone'], edr_terminated_alert_ids: ['s1-threat-4862'],
    });

    const markers = bulkDocs();
    expect(markers).toHaveLength(1);
    expect(markers[0].meta).toEqual({ _index: S1, _id: 's1-threat-4862', retry_on_conflict: 3 });
    expect(markers[0].doc).toEqual({
      f0rtika: { achilles_agent_kill_task_id: '8089b475', achilles_agent_kill_matched_at: NOW.toISOString() },
    });

    const row = taskRow('8089b475');
    expect(row.es_ingested).toBe(1);
    expect(row.status).toBe('failed');
    expect(row.result.edr_terminated).toMatchObject({
      vendors: ['sentinelone'], alert_ids: ['s1-threat-4862'], killed_at: '2026-10-26T16:06:32.719Z',
    });
  });

  it('reconciles the LT3938 rphcp.exe kill', async () => {
    addKilledTask('518ffeab', 'agent-3938', '2026-10-26 16:06:03', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-3938', 'lt3938.corp.example.com', '2026-10-26T16:06:26.000Z', { evidence_filenames: ['rphcp.exe'] })];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(1);
    expect(taskRow('518ffeab').result.edr_terminated?.alert_ids).toEqual(['s1-threat-3938']);
  });

  it('leaves a plain offline task alone', async () => {
    addKilledTask('lid-closed', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');

    const result = await reconciler().runPass({ now: NOW });

    expect(result).toEqual({ candidates: 1, reconciled: 0, vendorsAdded: 0, errors: [] });
    expect(mockIndex).not.toHaveBeenCalled();
    expect(mockBulk).not.toHaveBeenCalled();
    expect(taskRow('lid-closed').es_ingested).toBe(0);
  });

  it('does not reconcile on alerts that fail the evidence rule', async () => {
    addKilledTask('t', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [
      // Oct 22 agent-named threat with no test running: outside the window
      s1Threat('outside', 'LT4862', '2026-10-22T23:39:00.000Z'),
      s1Threat('no-mitre', 'LT4862', '2026-10-26T16:07:00.000Z', { mitre_techniques: [] }),
      s1Threat('unmitigated', 'LT4862', '2026-10-26T16:07:00.000Z', { prevention_action: undefined }),
      s1Threat('ours', 'LT4862', '2026-10-26T16:07:00.000Z', {
        f0rtika: { auto_mitigated: true, auto_mitigation_mode: 'enabled' },
      }),
      s1Threat('other-host', 'LT48621', '2026-10-26T16:07:00.000Z'),
    ];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(0);
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("ignores the next test's alerts once the restarted agent has picked it up", async () => {
    const OVERDUE = 'Task exceeded execution timeout';
    addKilledTask('dead-a', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:30:00', OVERDUE);
    insertTestTask(testDb, { id: 'next-b', agent_id: 'agent-4862', status: 'completed', assigned_at: '2026-10-26 16:09:00' });
    // B's blocked stage, inside A's original window but after B's pickup + 60 s grace.
    alertStore[S1] = [s1Threat('b-stage', 'LT4862', '2026-10-26T16:12:00.000Z')];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(0);
    expect(mockIndex).not.toHaveBeenCalled();
    expect(taskRow('dead-a').result.edr_terminated).toBeUndefined();
    const body = JSON.stringify(mockMsearch.mock.calls[0][0].searches[1]);
    expect(body).toContain('{"range":{"created_at":{"gte":"2026-10-26T16:06:05.000Z","lte":"2026-10-26T16:10:00.000Z"}}}');
  });

  it('still reconciles on an alert inside the grace after the next pickup', async () => {
    const OVERDUE = 'Task exceeded execution timeout';
    addKilledTask('dead-a', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:30:00', OVERDUE);
    insertTestTask(testDb, { id: 'next-b', agent_id: 'agent-4862', status: 'completed', assigned_at: '2026-10-26 16:09:00' });
    // The console's createdAt for A's kill lagged past B's pickup.
    alertStore[S1] = [s1Threat('a-kill', 'LT4862', '2026-10-26T16:09:40.000Z')];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(1);
    expect(taskRow('dead-a').result.edr_terminated?.alert_ids).toEqual(['a-kill']);
  });

  it("rejects an alert correlated to a different test", async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('other-test', 'LT4862', '2026-10-26T16:06:32.719Z', {
      f0rtika: { achilles_correlated: true, achilles_test_uuid: '7659eeba-f315-440e-9882-4aa015d68b27' },
    })];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(0);
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it('never writes achilles_correlated', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    alertStore[DEFENDER] = [s1Threat('mde-1', 'LT4862', '2026-10-26T16:06:40.000Z')];
    alertStore[CROWDSTRIKE] = [s1Threat('cs-1', 'LT4862', '2026-10-26T16:06:45.000Z')];

    await reconciler().runPass({ now: NOW });

    expect(bulkDocs().map((m) => m.meta._index).sort()).toEqual([DEFENDER, CROWDSTRIKE, S1].sort());
    expect(JSON.stringify(mockBulk.mock.calls)).not.toContain('achilles_correlated');
  });

  it('ignores a missing vendor index', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    indexErrors[DEFENDER] = { type: 'index_not_found_exception', reason: 'no such index [achilles-defender]' };

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a failing sub-search and still reconciles on the others', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    indexErrors[CROWDSTRIKE] = { type: 'search_phase_execution_exception', reason: 'boom' };

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('crowdstrike');
  });

  it('leaves the task unreconciled when the result write fails', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockIndex.mockRejectedValueOnce(new Error('es down'));

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(mockBulk).not.toHaveBeenCalled();
    expect(taskRow('8089b475').es_ingested).toBe(0);
    expect(taskRow('8089b475').result.edr_terminated).toBeUndefined();
  });

  it('still stamps the task when the alert markers fail', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockBulk.mockResolvedValueOnce({ errors: true, items: [{ update: { _id: 's1-threat-4862', error: { reason: 'version conflict' } } }] });

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('version conflict');
    expect(taskRow('8089b475').es_ingested).toBe(1);
  });

  it('is idempotent', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    await reconciler().runPass({ now: NOW });
    mockIndex.mockClear();
    mockBulk.mockClear();

    const second = await reconciler().runPass({ now: NOW });

    expect(second).toEqual({ candidates: 1, reconciled: 0, vendorsAdded: 0, errors: [] });
    expect(mockIndex).not.toHaveBeenCalled();
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('adds a second vendor on a later pass', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    await reconciler().runPass({ now: NOW });
    mockIndex.mockClear();
    alertStore[DEFENDER] = [s1Threat('mde-1', 'LT4862.corp.example.com', '2026-10-26T16:06:50.000Z')];

    const later = await reconciler().runPass({ now: NOW });

    expect(later).toEqual({ candidates: 1, reconciled: 0, vendorsAdded: 1, errors: [] });
    expect(mockIndex).toHaveBeenCalledTimes(1);
    expect(mockIndex.mock.calls[0][0].document.f0rtika.edr_terminated_vendors).toEqual(['sentinelone', 'defender']);
    const t = taskRow('8089b475').result.edr_terminated;
    expect(t?.vendors).toEqual(['sentinelone', 'defender']);
    expect(t?.alert_ids).toEqual(['s1-threat-4862', 'mde-1']);
    expect(bulkDocs().some((m) => m.meta._index === DEFENDER && m.meta._id === 'mde-1')).toBe(true);
  });

  it('keeps an earlier vendor whose alert has left its index', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    await reconciler().runPass({ now: NOW });
    alertStore[S1] = [];
    alertStore[DEFENDER] = [s1Threat('mde-1', 'LT4862', '2026-10-26T16:06:50.000Z')];

    await reconciler().runPass({ now: NOW });

    const t = taskRow('8089b475').result.edr_terminated;
    expect(t?.vendors).toEqual(['sentinelone', 'defender']);
    expect(t?.alert_ids).toEqual(['s1-threat-4862', 'mde-1']);
    expect(t?.killed_at).toBe('2026-10-26T16:06:32.719Z');
  });

  it('keeps the recorded vendor order when a later-found vendor alerted earlier', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    await reconciler().runPass({ now: NOW });
    alertStore[DEFENDER] = [s1Threat('mde-early', 'LT4862', '2026-10-26T16:06:20.000Z')];

    await reconciler().runPass({ now: NOW });

    const t = taskRow('8089b475').result.edr_terminated;
    expect(t?.vendors).toEqual(['sentinelone', 'defender']);
    expect(t?.alert_ids).toEqual(['s1-threat-4862', 'mde-early']);
    expect(t?.killed_at).toBe('2026-10-26T16:06:32.719Z');
  });

  it('a vendor-add rewrite keeps killed_at, so a dated index never gets a second doc', async () => {
    writeIndexRollover = 'daily';
    addKilledTask('midnight', 'agent-4862', '2026-10-25 23:58:00', '2026-10-26 00:05:00');
    alertStore[S1] = [s1Threat('s1-after-midnight', 'LT4862', '2026-10-26T00:00:30.000Z')];
    await reconciler().runPass({ now: NOW });
    // Defender's alert syncs later but is dated the day before.
    alertStore[DEFENDER] = [s1Threat('mde-before-midnight', 'LT4862', '2026-10-25T23:59:30.000Z')];

    const later = await reconciler().runPass({ now: NOW });

    expect(later.vendorsAdded).toBe(1);
    expect(mockIndex).toHaveBeenCalledTimes(2);
    const [first, second] = mockIndex.mock.calls.map((c) => c[0]);
    expect(first.index).toBe('achilles-results-acme-2026.10.26');
    expect(second.index).toBe(first.index);
    expect(second.id).toBe(first.id);
    expect(second.document.routing.event_time).toBe('2026-10-26T00:00:30.000Z');
    expect(second.document.f0rtika.edr_terminated_vendors).toEqual(['sentinelone', 'defender']);
    expect(second.document.f0rtika.edr_terminated_alert_ids).toEqual(['s1-after-midnight', 'mde-before-midnight']);
    expect(taskRow('midnight').result.edr_terminated?.killed_at).toBe('2026-10-26T00:00:30.000Z');
    expect(mockCreateResultsIndex.mock.calls.map((c) => c[0])).not.toContain('achilles-results-acme-2026.10.25');
  });

  it('skips a task whose agent has no hostname', async () => {
    addKilledTask('orphan', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    testDb.pragma('foreign_keys = OFF');
    testDb.prepare('DELETE FROM agents WHERE id = ?').run('agent-4862');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.candidates).toBe(0);
    expect(mockMsearch).not.toHaveBeenCalled();
    expect(taskRow('orphan').es_ingested).toBe(0);
  });

  it('reconciles a killed original and its killed retry independently', async () => {
    addKilledTask('oct23', 'agent-4862', '2026-10-23 15:08:24', '2026-10-23 15:15:04');
    addKilledTask('oct26', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [
      s1Threat('threat-oct23', 'LT4862', '2026-10-23T15:09:10.000Z'),
      s1Threat('threat-oct26', 'LT4862', '2026-10-26T16:06:32.719Z'),
    ];

    const result = await reconciler().runPass({ now: NOW });

    expect(result.reconciled).toBe(2);
    expect(taskRow('oct23').result.edr_terminated?.alert_ids).toEqual(['threat-oct23']);
    expect(taskRow('oct26').result.edr_terminated?.alert_ids).toEqual(['threat-oct26']);
    expect(mockIndex.mock.calls.map((c) => c[0].id).sort()).toEqual(['oct23', 'oct26']);
  });

  it("uses the catalog's isMultiStage", async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockCatalog.set(LOCKBIT_UUID, { name: 'LockBit 3.0 Chain', isMultiStage: true });

    await reconciler().runPass({ now: NOW });

    expect(mockResolveTestNames).not.toHaveBeenCalled();
    expect(mockIndex.mock.calls[0][0].document.f0rtika).toMatchObject({ bundle_id: LOCKBIT_UUID, bundle_name: 'LockBit 3.0 Chain' });
    expect(taskRow('8089b475').result.edr_terminated).toMatchObject({ bundle_name: 'LockBit 3.0 Chain' });
  });

  it('trusts a catalog entry that is not multi-stage over ES names', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockCatalog.set(LOCKBIT_UUID, { name: 'LockBit 3.0', isMultiStage: false });
    mockResolveTestNames.mockResolvedValue(new Map([[LOCKBIT_UUID, { name: 'LockBit 3.0 Chain', kind: 'bundle' }]]));

    await reconciler().runPass({ now: NOW });

    expect(mockResolveTestNames).not.toHaveBeenCalled();
    expect('bundle_id' in mockIndex.mock.calls[0][0].document.f0rtika).toBe(false);
    expect(taskRow('8089b475').result.edr_terminated).not.toHaveProperty('bundle_name');
  });

  it('falls back to resolveTestNames when the catalog has no entry', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockResolveTestNames.mockResolvedValue(new Map([[LOCKBIT_UUID, { name: 'LockBit 3.0 Chain', kind: 'bundle' }]]));

    await reconciler().runPass({ now: NOW });

    expect(mockResolveTestNames).toHaveBeenCalledTimes(1);
    expect(mockResolveTestNames).toHaveBeenCalledWith(esClient, 'achilles-results-*', [LOCKBIT_UUID]);
    expect(mockIndex.mock.calls[0][0].document.f0rtika).toMatchObject({ bundle_id: LOCKBIT_UUID, bundle_name: 'LockBit 3.0 Chain' });
  });

  it('a vendor-add rewrite keeps bundle_id when the lookup now fails', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockResolveTestNames.mockResolvedValue(new Map([[LOCKBIT_UUID, { name: 'LockBit 3.0 Chain', kind: 'bundle' }]]));
    await reconciler().runPass({ now: NOW });
    mockIndex.mockClear();
    mockResolveTestNames.mockClear();
    mockResolveTestNames.mockResolvedValue(new Map()); // ES name lookup now fails (it returns an empty Map)
    alertStore[DEFENDER] = [s1Threat('mde-1', 'LT4862', '2026-10-26T16:06:50.000Z')];

    const later = await reconciler().runPass({ now: NOW });

    expect(later.vendorsAdded).toBe(1);
    expect(mockResolveTestNames).not.toHaveBeenCalled();
    expect(mockIndex.mock.calls[0][0].document.f0rtika).toMatchObject({ bundle_id: LOCKBIT_UUID, bundle_name: 'LockBit 3.0 Chain' });
    expect(taskRow('8089b475').result.edr_terminated).toMatchObject({ bundle_name: 'LockBit 3.0 Chain', vendors: ['sentinelone', 'defender'] });
  });

  it('writes a standalone doc when the name lookup says test', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    mockResolveTestNames.mockResolvedValue(new Map([[LOCKBIT_UUID, { name: 'LockBit 3.0', kind: 'test' }]]));

    await reconciler().runPass({ now: NOW });

    expect('bundle_id' in mockIndex.mock.calls[0][0].document.f0rtika).toBe(false);
  });

  it('prefilters each vendor index for the host, window and kill actions', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');

    await reconciler().runPass({ now: NOW });

    const { searches } = mockMsearch.mock.calls[0][0];
    expect(searches.filter((_: unknown, i: number) => i % 2 === 0)).toEqual([
      { index: DEFENDER, ignore_unavailable: true },
      { index: CROWDSTRIKE, ignore_unavailable: true },
      { index: S1, ignore_unavailable: true },
    ]);
    const body = JSON.stringify(searches[1]);
    expect(searches[1].size).toBe(50);
    expect(searches[1].sort).toEqual([{ created_at: 'asc' }]);
    expect(searches[1]._source).toContain('f0rtika.achilles_test_uuid');
    expect(body).toContain('{"term":{"doc_type":"alert"}}');
    expect(body).toContain('{"wildcard":{"evidence_hostnames":{"value":"lt4862*","case_insensitive":true}}}');
    expect(body).toContain('{"range":{"created_at":{"gte":"2026-10-26T16:06:05.000Z","lte":"2026-10-26T16:12:59.000Z"}}}');
    expect(body).toContain('{"terms":{"prevention_action":["process_killed","quarantined","blocked"]}}');
  });

  it('puts the marker mapping on an alert index before marking its alerts', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];

    await reconciler().runPass({ now: NOW });

    expect(mockPutMapping).toHaveBeenCalledWith({
      index: S1,
      properties: { f0rtika: { properties: {
        achilles_agent_kill_task_id: { type: 'keyword' },
        achilles_agent_kill_matched_at: { type: 'date' },
      } } },
    });
    const s1MappingCall = mockPutMapping.mock.calls.findIndex((c) => c[0].index === S1);
    expect(mockPutMapping.mock.invocationCallOrder[s1MappingCall]).toBeLessThan(mockBulk.mock.invocationCallOrder[0]);
  });

  it("searches only configured vendors' indices", async () => {
    edrConfigured = { defender: true, crowdstrike: false, sentinelone: true };
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[CROWDSTRIKE] = [s1Threat('cs-1', 'LT4862', '2026-10-26T16:06:45.000Z')];

    const result = await reconciler().runPass({ now: NOW });

    const { searches } = mockMsearch.mock.calls[0][0];
    expect(searches.filter((_: unknown, i: number) => i % 2 === 0).map((h: { index: string }) => h.index)).toEqual([DEFENDER, S1]);
    expect(result.reconciled).toBe(0);
  });

  it('is a no-op when no EDR is configured', async () => {
    edrConfigured = { defender: false, crowdstrike: false, sentinelone: false };
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];

    const result = await reconciler().runPass({ now: NOW });

    expect(result).toEqual({ candidates: 0, reconciled: 0, vendorsAdded: 0, errors: [] });
    expect(mockMsearch).not.toHaveBeenCalled();
  });

  it('rewrites the same _id on the next pass when the stamp failed after the doc was written', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    testDb.exec(`CREATE TRIGGER fail_stamp BEFORE UPDATE OF es_ingested ON tasks BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END;`);

    const first = await reconciler().runPass({ now: NOW });

    expect(first.reconciled).toBe(0);
    expect(first.errors).toEqual([expect.stringContaining('disk I/O error')]);
    expect(mockIndex).toHaveBeenCalledTimes(1);
    expect(taskRow('8089b475').es_ingested).toBe(0);

    testDb.exec('DROP TRIGGER fail_stamp');
    const second = await reconciler().runPass({ now: NOW });

    expect(second.reconciled).toBe(1);
    expect(mockIndex).toHaveBeenCalledTimes(2);
    expect(mockIndex.mock.calls.map((c) => c[0].id)).toEqual(['8089b475', '8089b475']);
    expect(mockIndex.mock.calls[1][0].index).toBe(mockIndex.mock.calls[0][0].index);
    expect(taskRow('8089b475').es_ingested).toBe(1);
  });

  it('honours the lookback window', async () => {
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');

    const result = await reconciler().runPass({ now: new Date('2026-12-01T00:00:00.000Z') });

    expect(result.candidates).toBe(0);
  });
});

describe('runAgentKillReconciliation', () => {
  it('returns an error instead of throwing when Elasticsearch is not configured', async () => {
    esConfigured = false;
    const result = await runAgentKillReconciliation();
    expect(result).toEqual({ candidates: 0, reconciled: 0, vendorsAdded: 0, errors: ['Elasticsearch is not configured'] });
  });

  it('runs a 30-day pass with the analytics client and index pattern', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    addKilledTask('old', 'agent-4862', '2026-09-20 16:06:05', '2026-09-20 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runAgentKillReconciliation();

    expect(result).toEqual({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });
    expect(mockResolveTestNames.mock.calls[0][1]).toBe('achilles-results-*');
  });

  it('looks back 30 days on the first pass and 2 days after that', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    addKilledTask('oct06', 'agent-4862', '2026-10-06 16:06:05', '2026-10-06 16:12:59');
    alertStore[S1] = [s1Threat('threat-oct06', 'LT4862', '2026-10-06T16:06:32.000Z')];

    const first = await runAgentKillReconciliation();

    expect(first).toEqual({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });

    addKilledTask('oct07', 'agent-3938', '2026-10-07 16:06:05', '2026-10-07 16:12:59');
    addKilledTask('oct25', 'agent-3938', '2026-10-25 16:06:05', '2026-10-25 16:12:59');
    alertStore[S1].push(
      s1Threat('threat-oct07', 'LT3938', '2026-10-07T16:06:32.000Z'),
      s1Threat('threat-oct25', 'LT3938', '2026-10-25T16:06:32.000Z'),
    );

    const second = await runAgentKillReconciliation();

    expect(second).toEqual({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });
    expect(taskRow('oct25').result.edr_terminated?.alert_ids).toEqual(['threat-oct25']);
    expect(taskRow('oct07').result.edr_terminated).toBeUndefined();
  });

  it('keeps the 30-day lookback until a pass runs cleanly with an EDR configured', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    addKilledTask('oct06', 'agent-4862', '2026-10-06 16:06:05', '2026-10-06 16:12:59');
    alertStore[S1] = [s1Threat('threat-oct06', 'LT4862', '2026-10-06T16:06:32.000Z')];

    esConfigured = false;
    await runAgentKillReconciliation();
    esConfigured = true;
    edrConfigured = { defender: false, crowdstrike: false, sentinelone: false };
    await runAgentKillReconciliation();
    edrConfigured = { defender: false, crowdstrike: false, sentinelone: true };
    mockMsearch.mockRejectedValueOnce(new Error('es down'));
    await runAgentKillReconciliation();

    const result = await runAgentKillReconciliation();

    expect(result).toEqual({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });
  });

  it('runs exactly one trailing pass for calls made while a pass is in flight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    addKilledTask('8089b475', 'agent-4862', '2026-10-26 16:06:05', '2026-10-26 16:12:59');
    alertStore[S1] = [s1Threat('s1-threat-4862', 'LT4862', '2026-10-26T16:06:32.719Z')];
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = runAgentKillReconciliation();
    const late1 = runAgentKillReconciliation();
    const late2 = runAgentKillReconciliation();

    expect(late1).toBe(late2);
    expect(late1).not.toBe(first);
    const [a, b] = await Promise.all([first, late1]);
    expect(a.reconciled).toBe(1);
    expect(b).toEqual({ candidates: 1, reconciled: 0, vendorsAdded: 0, errors: [] });
    expect(mockMsearch).toHaveBeenCalledTimes(2);

    // Idle again: the next call starts a fresh pass.
    await runAgentKillReconciliation();
    expect(mockMsearch).toHaveBeenCalledTimes(3);
  });

  it('never throws when the pass itself throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    testDb.close();
    const result = await runAgentKillReconciliation();
    expect(result.errors).toHaveLength(1);
    expect(err).toHaveBeenCalled();
  });
});

describe('server.ts 5-minute alert loops', () => {
  it('run the pass after enrichment and before auto-resolve for Defender and CrowdStrike', () => {
    const src = fs.readFileSync(new URL('../../../server.ts', import.meta.url), 'utf8');
    for (const svc of ['defenderSyncService', 'crowdstrikeSyncService']) {
      const enrichment = src.indexOf(`await ${svc}.runEnrichmentPass()`);
      const autoResolve = src.indexOf(`await ${svc}.runAutoResolvePass()`);
      expect(enrichment).toBeGreaterThan(-1);
      expect(src.slice(enrichment, autoResolve)).toContain('await runAgentKillReconciliation();');
    }
  });
});
