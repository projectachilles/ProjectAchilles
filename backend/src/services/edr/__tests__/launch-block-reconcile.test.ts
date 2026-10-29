import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';

// ── Mocks ──────────────────────────────────────────────────────────
// A tiny fake ES: alert searches return every alert of their index and the
// results search every result doc, so the code's own evidence rule (not the
// ES prefilter) decides. bulk applies its partial updates to the stores, so
// a second pass sees what the first one wrote.
type Hit = { _index: string; _id: string; _seq_no?: number; _primary_term?: number; _source: Record<string, any> };
let alertStore: Record<string, Hit[]>;
let resultStore: Hit[];
let bulkItemError: ((op: Record<string, any>) => Record<string, unknown> | null) | null;

const mockSearch = vi.fn();
const mockBulk = vi.fn();
const mockPutMapping = vi.fn();
const esClient = { search: mockSearch, bulk: mockBulk, indices: { putMapping: mockPutMapping } };

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = () => ({ configured: true, indexPattern: 'achilles-results-*' });
    isConfigured = () => true;
  },
}));
vi.mock('../../analytics/client.js', () => ({ createEsClient: () => esClient }));

const mockResolveTestNames = vi.fn();
vi.mock('../../analytics/test-name-lookup.js', () => ({
  resolveTestNames: (...args: unknown[]) => mockResolveTestNames(...args),
}));

let mockCatalog = new Map<string, { name: string; isMultiStage: boolean }>();
vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: (uuid: string) => mockCatalog.get(uuid) ?? null,
}));

let edrConfigured = { defender: true, crowdstrike: true, sentinelone: false, sophos: false };
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    isDefenderConfigured = () => edrConfigured.defender;
    isCrowdStrikeConfigured = () => edrConfigured.crowdstrike;
    isSentinelOneConfigured = () => edrConfigured.sentinelone;
    isSophosConfigured = () => edrConfigured.sophos;
  },
}));

const { EdrLaunchBlockReconciler, runLaunchBlockReconciliation, resetLaunchBlockLookback } = await import('../launch-block-reconcile.service.js');

// ── Fixtures (shape of a live CrowdStrike Falcon ML block of a test
// orchestrator; hosts, ids and uuids are neutral) ─────────────────────
const TEST_UUID = 'c0ffee00-1234-4abc-8def-000000000001';
const TASK_ID = '5d1c2f9e-7a4b-4c3d-9e8f-0a1b2c3d4e5f';
const RESULT_INDEX = 'achilles-results-acme-2026.10.27';
const CS = 'achilles-crowdstrike';
const DEFENDER = 'achilles-defender';
const NOW = new Date('2026-10-27T12:00:00.000Z');
const EVENT_TIME = '2026-10-27T10:00:00Z';

function resultDoc(id: string, opts: { host?: string; time?: string; code?: number; f0rtika?: Record<string, unknown>; seq?: number } = {}): Hit {
  return {
    _index: RESULT_INDEX,
    _id: id,
    _seq_no: opts.seq ?? 7,
    _primary_term: 1,
    _source: {
      routing: { event_time: opts.time ?? EVENT_TIME, oid: 'org-a', hostname: opts.host ?? 'WS-0042' },
      event: { ERROR: opts.code ?? 260 },
      f0rtika: {
        test_uuid: TEST_UUID,
        test_name: 'Example Orchestrated Test',
        is_protected: false,
        error_name: 'BlockedPreExecution',
        category: 'intel-driven',
        techniques: ['T1105', 'T1572'],
        ...opts.f0rtika,
      },
    },
  };
}

function falconAlert(id: string, extra: Record<string, unknown> = {}): Hit {
  return {
    _index: CS,
    _id: id,
    _source: {
      doc_type: 'alert',
      created_at: '2026-10-27T10:01:00Z',
      evidence_hostnames: ['WS-0042'],
      evidence_filenames: [`${TEST_UUID}.exe`],
      evidence_filepaths: [`\\device\\harddiskvolume3\\f0\\tasks\\task-${TASK_ID}-1234567\\${TEST_UUID}.exe`],
      prevention_action: 'quarantined',
      pattern_disposition_description: 'Prevention/Quarantine, process was blocked from execution and quarantine was attempted.',
      mitre_techniques: ['T1204.002'],
      ...extra,
    },
  };
}

function deepMerge(target: Record<string, any>, patch: Record<string, any>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

/** Every update op + doc the reconciler sent through bulk, in order. */
function bulkUpdates(): Array<{ meta: Record<string, any>; doc: Record<string, any> }> {
  const out: Array<{ meta: Record<string, any>; doc: Record<string, any> }> = [];
  for (const [arg] of mockBulk.mock.calls) {
    const ops = (arg as { operations: Array<Record<string, any>> }).operations;
    for (let i = 0; i < ops.length; i += 2) out.push({ meta: ops[i].update, doc: ops[i + 1].doc });
  }
  return out;
}
const resultUpdates = () => bulkUpdates().filter((u) => u.meta._index === RESULT_INDEX);
const alertUpdates = () => bulkUpdates().filter((u) => u.meta._index !== RESULT_INDEX);

/** The search for unresolved 260 candidates (the results index is also searched for re-links and siblings). */
function candidateSearch(): Record<string, any> | undefined {
  return mockSearch.mock.calls.map(([r]) => r).find((r) => r.index === 'achilles-results-*' && JSON.stringify(r.query).includes('"event.ERROR":260'));
}

function reconciler(): InstanceType<typeof EdrLaunchBlockReconciler> {
  return new EdrLaunchBlockReconciler(esClient as unknown as Client, 'achilles-results-*');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLaunchBlockLookback();
  alertStore = {};
  resultStore = [];
  bulkItemError = null;
  mockCatalog = new Map();
  edrConfigured = { defender: true, crowdstrike: true, sentinelone: false, sophos: false };
  mockSearch.mockImplementation(async (req: { index: string }) => {
    const hits = req.index === 'achilles-results-*' ? resultStore : (alertStore[req.index] ?? []);
    return { hits: { hits: hits.map((h) => structuredClone(h)) } };
  });
  mockBulk.mockImplementation(async ({ operations }: { operations: Array<Record<string, any>> }) => {
    const items: unknown[] = [];
    for (let i = 0; i < operations.length; i += 2) {
      const meta = operations[i].update;
      const error = bulkItemError?.(meta) ?? null;
      if (error) {
        items.push({ update: { _index: meta._index, _id: meta._id, status: 409, error } });
        continue;
      }
      const store = meta._index === RESULT_INDEX ? resultStore : (alertStore[meta._index] ?? []);
      const hit = store.find((h) => h._id === meta._id);
      if (hit) deepMerge(hit._source, operations[i + 1].doc);
      items.push({ update: { _index: meta._index, _id: meta._id, status: 200, result: 'updated' } });
    }
    return { errors: items.some((it: any) => it.update.error), items };
  });
  mockPutMapping.mockResolvedValue({ acknowledged: true });
  mockResolveTestNames.mockResolvedValue(new Map());
});

// ── Tests ──────────────────────────────────────────────────────────

describe('EdrLaunchBlockReconciler.runPass', () => {
  it('resolves the live-shaped Falcon launch block found by its task directory', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];

    const result = await reconciler().runPass({ now: NOW });

    expect(result).toEqual({ evidenceAlerts: 1, candidates: 1, resolved: 1, errors: [] });
    const [doc] = resultUpdates();
    // Only the doc version that was evaluated is updated.
    expect(doc.meta).toEqual({ _index: RESULT_INDEX, _id: TASK_ID, if_seq_no: 7, if_primary_term: 1 });
    expect(doc.doc).toEqual({
      event: { ERROR: 126 },
      f0rtika: {
        is_protected: true,
        error_name: 'ExecutionPrevented',
        edr_launch_blocked: true,
        launch_block: {
          original_exit_code: 260,
          original_error_name: 'BlockedPreExecution',
          vendors: ['crowdstrike'],
          alert_ids: ['cs-alert-1'],
          evidence: 'task_path',
          resolved_at: NOW.toISOString(),
        },
        crowdstrike_detected: true,
        crowdstrike_prevented: true,
        crowdstrike_prevention_action: 'quarantined',
      },
    });

    // The proving alert is linked the way enrichment links one, so auto-resolve may act on it.
    expect(alertUpdates()).toEqual([{
      meta: { _index: CS, _id: 'cs-alert-1', retry_on_conflict: 3 },
      doc: { f0rtika: { achilles_correlated: true, achilles_test_uuid: TEST_UUID, achilles_matched_at: NOW.toISOString(), achilles_launch_block_doc_id: TASK_ID } },
    }]);
    // The launch-block fields are declared on the doc's index before the write.
    expect(mockPutMapping).toHaveBeenCalledWith(expect.objectContaining({ index: RESULT_INDEX }));
    expect(mockPutMapping.mock.invocationCallOrder[0]).toBeLessThan(mockBulk.mock.invocationCallOrder[0]);
  });

  it('is idempotent: a second pass finds nothing left to resolve', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    await reconciler().runPass({ now: NOW });
    mockBulk.mockClear();

    const again = await reconciler().runPass({ now: NOW });

    expect(again.resolved).toBe(0);
    expect(again.candidates).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
    expect(resultStore[0]._source.event.ERROR).toBe(126);
  });

  it('leaves an already-resolved doc alone', async () => {
    resultStore = [resultDoc(TASK_ID, { code: 126, f0rtika: { edr_launch_blocked: true, is_protected: true } })];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('resolves on the orchestrator file name inside the correlation window', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1', { evidence_filepaths: [] })];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(1);
    expect(resultUpdates()[0].doc.f0rtika.launch_block.evidence).toBe('orchestrator');
  });

  it('does not resolve on the orchestrator file name outside the window', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1', { evidence_filepaths: [], created_at: '2026-10-27T10:45:00Z' })];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed kill', { prevention_action: 'kill_failed' }],
    ['a detection-only alert', { prevention_action: undefined }],
    ['another host', { evidence_hostnames: ['WS-0043'] }],
    ['a stage binary alone', { evidence_filepaths: [], evidence_filenames: [`${TEST_UUID}-T1105.exe`] }],
    ["Achilles' own mitigation", { f0rtika: { auto_mitigated: true, auto_mitigation_mode: 'enabled' } }],
  ])('does not resolve on %s', async (_label, extra) => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1', extra)];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('never takes a Defender alert as proof, and never searches its index', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[DEFENDER] = [{ ...falconAlert('mde-1'), _index: DEFENDER }];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(mockSearch.mock.calls.map(([r]) => r.index)).not.toContain(DEFENDER);
  });

  it('does nothing, and queries nothing, when only Defender is configured', async () => {
    edrConfigured = { defender: true, crowdstrike: false, sentinelone: false, sophos: false };
    resultStore = [resultDoc(TASK_ID)];
    const result = await reconciler().runPass({ now: NOW });
    expect(result).toEqual({ evidenceAlerts: 0, candidates: 0, resolved: 0, errors: [] });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('leaves a bundle-control 260 stage doc untouched', async () => {
    resultStore = [resultDoc(`${TASK_ID}::T1105`, {
      f0rtika: { test_uuid: `${TEST_UUID}::T1105`, is_bundle_control: true, bundle_id: TEST_UUID, control_id: 'T1105' },
    })];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('leaves a cyber-hygiene 260 doc untouched', async () => {
    resultStore = [resultDoc(TASK_ID, { f0rtika: { category: 'cyber-hygiene' } })];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    expect((await reconciler().runPass({ now: NOW })).resolved).toBe(0);
  });

  it('gives a multi-stage test its bundle identity so it joins the bundle pair', async () => {
    mockCatalog.set(TEST_UUID, { name: 'Example Orchestrated Test', isMultiStage: true });
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    await reconciler().runPass({ now: NOW });
    expect(resultUpdates()[0].doc.f0rtika).toMatchObject({ bundle_id: TEST_UUID, bundle_name: 'Example Orchestrated Test' });
  });

  it('a single-binary test gets no bundle identity', async () => {
    mockCatalog.set(TEST_UUID, { name: 'Example', isMultiStage: false });
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    await reconciler().runPass({ now: NOW });
    expect(resultUpdates()[0].doc.f0rtika).not.toHaveProperty('bundle_id');
  });

  it('a failed doc write (e.g. the doc changed meanwhile) links no alert and is retried next pass', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    bulkItemError = (meta) => (meta._index === RESULT_INDEX ? { type: 'version_conflict_engine_exception', reason: 'conflict' } : null);
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(result.errors).toEqual([expect.stringContaining('conflict')]);
    expect(alertUpdates()).toEqual([]);
  });

  it('only searches the 260 docs the alerts could prove', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    await reconciler().runPass({ now: NOW });
    const req = candidateSearch()!;
    const q = JSON.stringify(req.query);
    expect(q).toContain('"event.ERROR":260');
    expect(q).toContain(`"ids":{"values":["${TASK_ID}"]}`);
    expect(q).toContain(`"f0rtika.test_uuid":["${TEST_UUID}"]`);
    expect(req.query.bool.must_not).toEqual(expect.arrayContaining([
      { term: { 'f0rtika.is_bundle_control': true } },
      { term: { 'f0rtika.category': 'cyber-hygiene' } },
      { term: { 'f0rtika.edr_launch_blocked': true } },
    ]));
    expect(req.seq_no_primary_term).toBe(true);
  });

  it('skips the results search when no alert names an Achilles run', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1', { evidence_filenames: ['tool.exe'], evidence_filepaths: ['C:\\Users\\x\\tool.exe'] })];
    const result = await reconciler().runPass({ now: NOW });
    expect(result).toEqual({ evidenceAlerts: 1, candidates: 0, resolved: 0, errors: [] });
    expect(candidateSearch()).toBeUndefined();
  });

  it('a missing vendor index is not an error', async () => {
    edrConfigured = { defender: false, crowdstrike: true, sentinelone: true, sophos: false };
    mockSearch.mockImplementation(async (req: { index: string }) => {
      if (req.index === 'achilles-sentinelone') {
        throw Object.assign(new Error('index_not_found_exception'), { meta: { body: { error: { type: 'index_not_found_exception' } } } });
      }
      const hits = req.index === 'achilles-results-*' ? resultStore : (alertStore[req.index] ?? []);
      return { hits: { hits: hits.map((h) => structuredClone(h)) } };
    });
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.errors).toEqual([]);
    expect(result.resolved).toBe(1);
  });
});

describe('runLaunchBlockReconciliation', () => {
  const alertRangeStart = () => {
    const req = mockSearch.mock.calls.map(([r]) => r).find((r) => r.index === CS);
    return JSON.stringify(req.query).match(/"created_at":\{"gte":"([^"]+)"/)?.[1];
  };

  it('looks back 90 days on the first clean pass, then 2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    try {
      await runLaunchBlockReconciliation();
      // 90 days of result docs, plus a day of alert slack before the oldest one.
      expect(alertRangeStart()).toBe(new Date(NOW.getTime() - 91 * 86_400_000).toISOString());
      mockSearch.mockClear();
      await runLaunchBlockReconciliation();
      expect(alertRangeStart()).toBe(new Date(NOW.getTime() - 3 * 86_400_000).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it('never throws', async () => {
    mockSearch.mockRejectedValue(new Error('boom'));
    const result = await runLaunchBlockReconciliation();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('an alert proves at most one run', () => {
  const B_ID = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const byName = (extra: Record<string, unknown> = {}) => falconAlert('cs-alert-1', { evidence_filepaths: [], created_at: '2026-10-27T10:00:10Z', ...extra });

  it('a run resolved on one pass never lends its alert to a later 260 run (two passes)', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [byName()];
    expect((await reconciler().runPass({ now: NOW })).resolved).toBe(1);
    // The alert carries its receipt now.
    expect(alertStore[CS][0]._source.f0rtika.achilles_launch_block_doc_id).toBe(TASK_ID);

    // Run B of the same test on the host, 4 minutes later: an ASR block, no alert of its own.
    resultStore.push(resultDoc(B_ID, { time: '2026-10-27T10:04:00Z' }));
    mockBulk.mockClear();
    const second = await reconciler().runPass({ now: NOW });
    expect(second.resolved).toBe(0);
    expect(resultStore.find((d) => d._id === B_ID)!._source.event.ERROR).toBe(260);
    expect(resultUpdates()).toEqual([]);
  });

  it('even without the receipt, the resolved run is nearer and keeps the alert', async () => {
    resultStore = [
      resultDoc(TASK_ID, { code: 126, f0rtika: { edr_launch_blocked: true, is_protected: true, launch_block: { alert_ids: [] } } }),
      resultDoc(B_ID, { time: '2026-10-27T10:04:00Z' }),
    ];
    alertStore[CS] = [byName()];
    expect((await reconciler().runPass({ now: NOW })).resolved).toBe(0);
  });

  it('a file-name-only alert nearer to a run that executed is that run\'s, not a 260 sibling\'s', async () => {
    resultStore = [
      resultDoc('cccccccc-0000-4000-8000-00000000000c', { code: 101 }),
      resultDoc(B_ID, { time: '2026-10-27T10:04:00Z' }),
    ];
    alertStore[CS] = [byName()];
    const result = await reconciler().runPass({ now: NOW });
    expect(result.resolved).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('a file-name-only alert enrichment linked to a run is that run\'s', async () => {
    resultStore = [resultDoc(B_ID, { time: '2026-10-27T10:04:00Z' })];
    alertStore[CS] = [byName({ f0rtika: { achilles_correlated: true, achilles_test_uuid: TEST_UUID } })];
    expect((await reconciler().runPass({ now: NOW })).resolved).toBe(0);
  });

  it('task-folder alerts are unaffected by a nearer sibling run', async () => {
    resultStore = [
      resultDoc('cccccccc-0000-4000-8000-00000000000c', { code: 101, time: '2026-10-27T10:01:00Z' }),
      resultDoc(TASK_ID),
    ];
    alertStore[CS] = [falconAlert('cs-alert-1', { f0rtika: { achilles_correlated: true, achilles_test_uuid: TEST_UUID } })];
    expect((await reconciler().runPass({ now: NOW })).resolved).toBe(1);
  });

  it('when the sibling lookup fails, only task-folder evidence counts that pass', async () => {
    const failSiblings = (req: { index: string; query: unknown }) => {
      if (req.index === 'achilles-results-*' && JSON.stringify(req.query).includes('"f0rtika.bundle_id"')) throw new Error('es timeout');
      const hits = req.index === 'achilles-results-*' ? resultStore : (alertStore[req.index] ?? []);
      return { hits: { hits: hits.map((h) => structuredClone(h)) } };
    };
    mockSearch.mockImplementation(async (req) => failSiblings(req));
    resultStore = [resultDoc(B_ID, { time: '2026-10-27T10:04:00Z' })];
    alertStore[CS] = [byName()];
    const byNameOnly = await reconciler().runPass({ now: NOW });
    expect(byNameOnly.resolved).toBe(0);
    expect(byNameOnly.errors).toEqual([expect.stringContaining('siblings: es timeout')]);

    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-2'), byName()];
    expect((await reconciler().runPass({ now: NOW })).resolved).toBe(1);
  });

  it('the evidence search skips alerts that already proved a run', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    await reconciler().runPass({ now: NOW });
    const req = mockSearch.mock.calls.map(([r]) => r).find((r) => r.index === CS && JSON.stringify(r.query).includes('prevention_action'));
    expect(req.query.bool.must_not).toContainEqual({ exists: { field: 'f0rtika.achilles_launch_block_doc_id' } });
  });
});

describe('re-linking resolved docs', () => {
  it('links the alerts of a doc resolved on a pass whose alert write failed', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    bulkItemError = (meta) => (meta._index === CS ? { type: 'es_rejected_execution_exception', reason: 'busy' } : null);
    const first = await reconciler().runPass({ now: NOW });
    expect(first.resolved).toBe(1);
    expect(first.errors).toEqual([expect.stringContaining('busy')]);
    expect(alertStore[CS][0]._source.f0rtika).toBeUndefined();

    bulkItemError = null;
    mockBulk.mockClear();
    const second = await reconciler().runPass({ now: NOW });
    expect(second.errors).toEqual([]);
    expect(alertUpdates()).toEqual([{
      meta: { _index: CS, _id: 'cs-alert-1', retry_on_conflict: 3 },
      doc: { f0rtika: { achilles_correlated: true, achilles_test_uuid: TEST_UUID, achilles_matched_at: NOW.toISOString(), achilles_launch_block_doc_id: TASK_ID } },
    }]);
    expect(resultUpdates()).toEqual([]);
  });

  it('leaves already-linked alerts alone', async () => {
    resultStore = [resultDoc(TASK_ID)];
    alertStore[CS] = [falconAlert('cs-alert-1')];
    await reconciler().runPass({ now: NOW });
    mockBulk.mockClear();
    await reconciler().runPass({ now: NOW });
    expect(mockBulk).not.toHaveBeenCalled();
  });
});
