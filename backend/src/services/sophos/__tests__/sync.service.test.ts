import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Mocks ──────────────────────────────────────────────────────────
const mockWhoami = vi.fn();
const mockListAlerts = vi.fn();
const mockSiemEvents = vi.fn();
const mockGraphql = vi.fn();
const mockDetectionsV1 = vi.fn();
const clientCtor = vi.fn();

vi.mock('../sophos-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sophos-client.js')>()),
  SophosClient: class {
    permissionMode = 'read_only';
    constructor(...args: unknown[]) { clientCtor(...args); }
    whoami = mockWhoami;
    listAlerts = mockListAlerts;
    siemEvents = mockSiemEvents;
    graphql = mockGraphql;
    detectionsV1 = mockDetectionsV1;
    async *paginateKey<T>(fetchPage: (key?: string) => Promise<{ items: T[]; nextKey?: string }>) {
      let key: string | undefined;
      do {
        const res = await fetchPage(key);
        if (res.items.length) yield res.items;
        key = res.nextKey;
      } while (key);
    }
  },
}));

const TENANT = '79067fa3-e4d0-4769-a5f7-8d6550b3b68b';
let mockSettings: Record<string, unknown> | null;
let mockCheckpoints: Record<string, unknown>;
let mockAutoResolveMode = 'disabled';
const mockSaveCheckpoints = vi.fn();
const mockResetCheckpoints = vi.fn();
const mockSaveDiscovery = vi.fn();
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getSophosSettings = () => mockSettings;
    getSophosCredentials = () => mockSettings ? { client_id: mockSettings.client_id, client_secret: 's', permission_mode: 'read_only' } : null;
    getSophosSyncTimestamps = () => mockCheckpoints;
    saveSophosSyncTimestamps = mockSaveCheckpoints;
    resetSophosSyncTimestamps = mockResetCheckpoints;
    saveSophosDiscovery = mockSaveDiscovery;
    getSophosAutoResolveMode = () => mockAutoResolveMode;
  },
}));

const mockAutoResolvePass = vi.fn();
const autoResolveCtor = vi.fn();
vi.mock('../auto-resolve.service.js', () => ({
  SophosAutoResolveService: class {
    constructor(...args: unknown[]) { autoResolveCtor(...args); }
    runAutoResolvePass = mockAutoResolvePass;
  },
}));
const mockPosturePass = vi.fn();
vi.mock('../posture.service.js', () => ({
  POSTURE_INTERVAL_MS: 6 * 60 * 60 * 1000,
  SophosPostureService: class { runPosturePass = mockPosturePass; },
}));
vi.mock('../index-management.js', () => ({
  ensureSophosIndex: vi.fn().mockResolvedValue(undefined),
  SOPHOS_INDEX: 'achilles-sophos',
}));

const mockBulk = vi.fn();
const mockSearch = vi.fn();
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class { getSettings = () => ({ configured: true, indexPattern: 'achilles-results-*' }); },
}));
vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({ bulk: mockBulk, search: mockSearch }),
}));

const mockRunEnrichment = vi.fn();
const enrichmentCtor = vi.fn();
vi.mock('../enrichment.service.js', () => ({
  SophosEnrichmentService: class {
    constructor(...args: unknown[]) { enrichmentCtor(...args); }
    runEnrichmentPass = mockRunEnrichment;
  },
}));

const mockAgentKill = vi.fn(async () => ({ candidates: 0, reconciled: 0, vendorsAdded: 0, errors: [] as string[] }));
vi.mock('../../edr/agent-kill-reconcile.service.js', () => ({
  runAgentKillReconciliation: () => mockAgentKill(),
  failedAgentKillPass: (err: unknown) => ({ candidates: 0, reconciled: 0, vendorsAdded: 0, errors: [err instanceof Error ? err.message : String(err)] }),
}));

const { SophosSyncService, SOPHOS_SYNC_VERSION, SOPHOS_SIEM_GAP_MS } = await import('../sync.service.js');
const { SophosApiError, SophosGraphQLError } = await import('../sophos-client.js');

// ── Fixtures ───────────────────────────────────────────────────────
const dir = dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fx = (n: string) => JSON.parse(readFileSync(join(dir, 'fixtures', `${n}.json`), 'utf8')) as Record<string, any>;
const ALERT_ID = 'a5ded91c-6575-435c-a6b4-64b94f9048ff';
const EVENT_ID = 'e1111111-1111-4111-8111-111111111111';
const CLEANUP_ID = 'e3333333-3333-4333-8333-333333333333';
const commonAlert = () => fx('common-alert');
const coreEvent = (extra: Record<string, unknown> = {}) => ({ ...fx('siem-core-detection-ml'), ...extra });
const cleanupEvent = () => fx('siem-threat-cleanedup');
const gqlDetection = () => fx('graphql-detection');
const v1Detection = () => fx('v1-detection');

type Op = { update?: Record<string, unknown>; delete?: Record<string, unknown>; doc?: Record<string, unknown>; doc_as_upsert?: boolean };
const allOps = (): Op[] => mockBulk.mock.calls.flatMap((c) => c[0].operations as Op[]);
const updateIds = () => allOps().filter((o) => o.update).map((o) => o.update!._id);
const deleteIds = () => allOps().filter((o) => o.delete).map((o) => o.delete!._id);
/** The doc body written for an id (the op right after its update header). */
const docFor = (id: string) => {
  const ops = allOps();
  const i = ops.findIndex((o) => o.update?._id === id);
  return i >= 0 ? (ops[i + 1] as { doc: Record<string, unknown>; doc_as_upsert: boolean }) : undefined;
};
const savedCheckpoints = () => Object.assign({}, ...mockSaveCheckpoints.mock.calls.map((c) => c[0])) as Record<string, unknown>;
const esHit = (id: string, source: Record<string, unknown>) => ({ hits: { hits: [{ _id: id, _source: source }] } });

const gqlPage = (list: unknown[], extra: Record<string, unknown> = {}) => ({
  detectionSearch: { status: 'OK', search_id: 's1', alerts: { total_results: list.length, list }, ...extra },
});

describe('SophosSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps unconsumed *Once queues; drop them so no test inherits another's pages.
    for (const m of [mockWhoami, mockListAlerts, mockSiemEvents, mockGraphql, mockDetectionsV1, mockBulk, mockSearch, mockRunEnrichment, mockAutoResolvePass, mockPosturePass]) m.mockReset();
    mockSettings = { configured: true, client_id: 'cid-1', tenant_id: TENANT, detection_backfill_days: 30 };
    // An installed integration already carries the current sync_version (version-bump tests override this).
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION };
    mockSaveCheckpoints.mockImplementation((cp: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(cp)) if (v !== undefined) mockCheckpoints[k] = v;
    });
    mockResetCheckpoints.mockImplementation(() => {
      for (const k of ['siem_cursor', 'last_siem_sync', 'last_alert_sync', 'last_detection_sync', 'last_posture_sync', 'sync_version', 'sync_gap']) delete mockCheckpoints[k];
    });
    mockAutoResolveMode = 'disabled';
    mockWhoami.mockResolvedValue({ id: TENANT, idType: 'tenant', dataRegionHost: 'api-eu01.central.sophos.com' });
    mockListAlerts.mockResolvedValue({ items: [] });
    mockSiemEvents.mockResolvedValue({ items: [], next_cursor: 'cur-1', has_more: false });
    mockGraphql.mockResolvedValue(gqlPage([]));
    mockDetectionsV1.mockResolvedValue([]);
    mockBulk.mockResolvedValue({ errors: false, items: [] });
    mockSearch.mockResolvedValue({ hits: { hits: [] } });
    mockRunEnrichment.mockResolvedValue({ scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors: [], durationMs: 0 });
    mockAutoResolvePass.mockResolvedValue({ mode: 'disabled', candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [], durationMs: 0 });
    mockPosturePass.mockResolvedValue({ healthCheck: true, historyImported: 0, endpoints: 1, policies: 1, exclusions: 0, allowedItems: 0, errors: [] });
  });

  // ── Brief-mandated tests ─────────────────────────────────────────

  it('merges a SIEM event into the matching alert and emits no second row', async () => {
    mockListAlerts.mockResolvedValueOnce({ items: [commonAlert()] });
    mockSiemEvents.mockResolvedValueOnce({ items: [coreEvent()], next_cursor: 'cur-2', has_more: false });
    const result = await new SophosSyncService().syncAll();

    expect(updateIds()).not.toContain(`siem-${EVENT_ID}`);
    expect(new Set(updateIds())).toEqual(new Set([`alert-${ALERT_ID}`]));
    const merged = [...mockBulk.mock.calls].reverse().map((c) => c[0].operations as Op[])
      .find((ops) => ops.some((o) => o.update?._id === `alert-${ALERT_ID}`))!;
    const body = merged[merged.findIndex((o) => o.update?._id === `alert-${ALERT_ID}`) + 1] as { doc: Record<string, unknown> };
    expect(body.doc).toMatchObject({ merged_siem_event_ids: [EVENT_ID], prevention_action: 'quarantined', source_type: 'alert' });
    expect(result.siem_events).toMatchObject({ fetched: 1, merged: 1, errors: [] });
    expect(result.alerts).toMatchObject({ fetched: 1, synced: 1, errors: [] });
  });

  it('writes an unmatched SIEM detection event as its own siem_event row', async () => {
    mockSiemEvents.mockResolvedValueOnce({ items: [coreEvent(), { id: 'noise', type: 'Event::Endpoint::UpdateSuccess' }], next_cursor: 'cur-2', has_more: false });
    const result = await new SophosSyncService().syncAll();
    expect(updateIds()).toEqual([`siem-${EVENT_ID}`]);
    expect(docFor(`siem-${EVENT_ID}`)!.doc).toMatchObject({ source_type: 'siem_event', alert_id: EVENT_ID, prevention_action: 'quarantined' });
    expect(result.siem_events).toMatchObject({ fetched: 2, synced: 1, merged: 0 });
  });

  it('records a sync gap when the last SIEM poll is older than 23 hours', async () => {
    const last = new Date(Date.now() - 30 * 3_600_000).toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, siem_cursor: 'stale', last_siem_sync: last, last_alert_sync: last, last_detection_sync: last };
    const before = Date.now();
    const svc = new SophosSyncService();
    await svc.syncAll();

    // The stale cursor is dropped; the feed restarts inside Sophos' 24 h window.
    const params = mockSiemEvents.mock.calls[0][0];
    expect(params.cursor).toBeUndefined();
    expect(before / 1000 - params.fromDate).toBeGreaterThanOrEqual(SOPHOS_SIEM_GAP_MS / 1000 - 5);
    expect(before / 1000 - params.fromDate).toBeLessThan(24 * 3600);

    const gap = svc.getSyncStatus().syncGap;
    expect(gap?.from).toBe(last);
    expect(gap?.to).toBe(new Date(params.fromDate * 1000).toISOString());
    expect(savedCheckpoints().sync_gap).toEqual(gap);
    expect(savedCheckpoints().last_siem_sync).not.toBe(last);
  });

  it('does not advance the detection checkpoint when GraphQL returned errors', async () => {
    const last = new Date(Date.now() - 3_600_000).toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: last, last_siem_sync: last, siem_cursor: 'c', last_detection_sync: last };
    mockGraphql.mockRejectedValueOnce(new SophosGraphQLError('Sophos GraphQL error: internal failure', [{ message: 'internal failure' }]));
    const result = await new SophosSyncService().syncAll();
    expect(result.xdr_detections?.errors[0]).toContain('internal failure');
    expect(mockDetectionsV1).not.toHaveBeenCalled();
    const saved = savedCheckpoints();
    expect(saved.last_detection_sync).toBeUndefined(); // never advanced (and not rewritten)
    expect(saved.last_alert_sync).not.toBe(last);
    expect(mockCheckpoints.last_detection_sync).toBe(last);
  });

  it('a non-OK detectionSearch status also pins the detection checkpoint', async () => {
    mockGraphql.mockResolvedValueOnce({ detectionSearch: { status: 'TRANSACTION_ERROR', reason: 'busy', alerts: null } });
    const result = await new SophosSyncService().syncAll();
    expect(result.xdr_detections?.errors[0]).toContain('TRANSACTION_ERROR');
    expect(savedCheckpoints().last_detection_sync).toBeUndefined();
  });

  it('falls back to REST v1 detections when GraphQL is forbidden and records the capability', async () => {
    mockGraphql.mockRejectedValueOnce(new SophosApiError('Sophos POST /graphql failed: HTTP 403.', 403, ''));
    mockDetectionsV1.mockResolvedValueOnce([v1Detection()]);
    const before = Date.now();
    const result = await new SophosSyncService().syncAll();

    const range = mockDetectionsV1.mock.calls[0][0];
    expect(before - Date.parse(range.from)).toBeGreaterThanOrEqual(30 * 86_400_000 - 5000);
    expect(before - Date.parse(range.from)).toBeLessThan(31 * 86_400_000);
    expect(updateIds()).toContain(`xdr-${v1Detection().id}`);
    expect(result.xdr_detections).toMatchObject({ fetched: 1, synced: 1, errors: [] });
    const caps = mockSaveDiscovery.mock.calls.map((c) => c[0].capabilities).filter(Boolean).pop();
    expect(caps).toMatchObject({ xdr_graphql: 'forbidden', xdr_rest: 'available' });
    expect(savedCheckpoints().last_detection_sync).toEqual(expect.any(String));
  });

  it('GraphQL success records the capability and writes detections; the CQL window uses the checkpoint minus 2 min', async () => {
    const last = new Date(Date.now() - 60 * 60_000).toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: last, last_siem_sync: last, siem_cursor: 'c', last_detection_sync: last };
    mockGraphql.mockResolvedValueOnce(gqlPage([gqlDetection()]));
    await new SophosSyncService().syncAll();
    const vars = mockGraphql.mock.calls[0][1];
    expect(vars.in.cql_query).toMatch(/^from alert earliest=-6[23]m$/);
    expect(vars.in.offset).toBe(0);
    expect(mockGraphql.mock.calls[0][0]).toMatch(/detectionSearch/);
    expect(mockGraphql.mock.calls[0][0]).not.toMatch(/mutation|subscription/);
    expect(docFor(`xdr-${gqlDetection().id}`)!.doc).toMatchObject({ source_type: 'xdr_detection' });
    expect(docFor(`xdr-${gqlDetection().id}`)!.doc.prevention_action).toBeUndefined();
    const caps = mockSaveDiscovery.mock.calls.map((c) => c[0].capabilities).filter(Boolean).pop();
    expect(caps).toMatchObject({ xdr_graphql: 'available' });
  });

  it('pages GraphQL detections by offset until total_results', async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ ...gqlDetection(), id: `alert:${i}` }));
    mockGraphql
      .mockResolvedValueOnce({ detectionSearch: { status: 'OK', alerts: { total_results: 501, list: page } } })
      .mockResolvedValueOnce({ detectionSearch: { status: 'OK', alerts: { total_results: 501, list: [{ ...gqlDetection(), id: 'alert:last' }] } } });
    const result = await new SophosSyncService().syncAll();
    expect(mockGraphql.mock.calls[1][1].in.offset).toBe(500);
    expect(result.xdr_detections).toMatchObject({ fetched: 501, synced: 501 });
  });

  it('XDR paging: short pages that stop before total_results pin the detection checkpoint', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ ...gqlDetection(), id: `alert:${from + i}` }));
    mockGraphql
      .mockResolvedValueOnce({ detectionSearch: { status: 'OK', alerts: { total_results: 1200, list: page(400, 0) } } })
      .mockResolvedValueOnce({ detectionSearch: { status: 'OK', alerts: { total_results: 1200, list: page(400, 400) } } })
      .mockResolvedValueOnce({ detectionSearch: { status: 'OK', alerts: { total_results: 1200, list: [] } } });
    const result = await new SophosSyncService().syncAll();
    expect(mockGraphql.mock.calls[1][1].in.offset).toBe(400);
    expect(mockGraphql.mock.calls[2][1].in.offset).toBe(800);
    expect(result.xdr_detections?.fetched).toBe(800);
    expect(result.xdr_detections?.errors[0]).toMatch(/800 of 1200/);
    expect(savedCheckpoints().last_detection_sync).toBeUndefined();
    expect(mockDetectionsV1).not.toHaveBeenCalled();
  });

  it('XDR paging past 10k: detectionPoll parts that end before total_results pin the checkpoint; a complete set is clean', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ ...gqlDetection(), id: `alert:${from + i}` }));
    const serve = (total: number, pollPages: Array<{ n: number; part: number; parts: number }>) => {
      let polls = 0;
      mockGraphql.mockImplementation(async (query: string, vars: { in: { offset?: number } }) => {
        if (/detectionPoll/.test(query)) {
          const p = pollPages[polls++] ?? { n: 0, part: 9, parts: 9 };
          return { detectionPoll: { status: 'OK', alerts: { total_results: total, part: p.part, total_parts: p.parts, list: page(p.n, 20_000 + polls * 1000) } } };
        }
        return { detectionSearch: { status: 'OK', search_id: 's-big', alerts: { total_results: total, list: page(500, vars.in.offset ?? 0) } } };
      });
    };
    serve(10_600, [{ n: 300, part: 2, parts: 2 }]);
    const short = await new SophosSyncService().syncAll();
    expect(mockGraphql.mock.calls.filter((c) => /detectionPoll/.test(c[0]))[0][1]).toEqual({ in: { search_id: 's-big' } });
    expect(short.xdr_detections?.fetched).toBe(10_300);
    expect(short.xdr_detections?.errors[0]).toMatch(/10300 of 10600/);
    expect(savedCheckpoints().last_detection_sync).toBeUndefined();

    mockGraphql.mockReset();
    mockSaveCheckpoints.mockClear();
    serve(10_600, [{ n: 300, part: 2, parts: 3 }, { n: 300, part: 3, parts: 3 }]);
    const complete = await new SophosSyncService().syncAll();
    expect(complete.xdr_detections).toMatchObject({ fetched: 10_600, errors: [] });
    expect(savedCheckpoints().last_detection_sync).toEqual(expect.any(String));
  });

  it('writes with update + doc_as_upsert so f0rtika receipts survive', async () => {
    // The stored alert carries an auto-resolve receipt; the merge must not write it back.
    mockSearch.mockResolvedValue(esHit(`alert-${ALERT_ID}`, { ...JSON.parse(JSON.stringify(transformedAlert())), f0rtika: { auto_resolved: true } }));
    mockSiemEvents.mockResolvedValueOnce({ items: [coreEvent()], next_cursor: 'cur-2', has_more: false });
    await new SophosSyncService().syncAll();
    const ops = allOps();
    const i = ops.findIndex((o) => o.update?._id === `alert-${ALERT_ID}`);
    expect(ops[i]).toEqual({ update: { _index: 'achilles-sophos', _id: `alert-${ALERT_ID}`, retry_on_conflict: 3 } });
    expect((ops[i + 1] as { doc_as_upsert: boolean }).doc_as_upsert).toBe(true);
    expect('f0rtika' in (ops[i + 1] as { doc: object }).doc).toBe(false);
    expect(ops.some((o) => 'index' in o || 'create' in o)).toBe(false);
  });

  it('a sync_version mismatch clears every checkpoint once and saves the version before fetching', async () => {
    const last = new Date(Date.now() - 60_000).toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION - 1, last_alert_sync: last, last_siem_sync: last, siem_cursor: 'c', last_detection_sync: last };
    const before = Date.now();
    await new SophosSyncService().syncAll();
    expect(mockResetCheckpoints).toHaveBeenCalledTimes(1);
    const versionSave = mockSaveCheckpoints.mock.calls.findIndex((c) => c[0].sync_version === SOPHOS_SYNC_VERSION);
    expect(versionSave).toBeGreaterThanOrEqual(0);
    expect(mockSaveCheckpoints.mock.invocationCallOrder[versionSave]).toBeLessThan(mockListAlerts.mock.invocationCallOrder[0]);
    expect(mockResetCheckpoints.mock.invocationCallOrder[0]).toBeLessThan(mockSaveCheckpoints.mock.invocationCallOrder[versionSave]);
    // Backfill for every source.
    expect(before - Date.parse(mockListAlerts.mock.calls[0][0].from)).toBeGreaterThan(89 * 86_400_000);
    expect(mockSiemEvents.mock.calls[0][0].cursor).toBeUndefined();
    // The next poll trusts the new checkpoints: no second reset.
    mockResetCheckpoints.mockClear();
    await new SophosSyncService().syncAll();
    expect(mockResetCheckpoints).not.toHaveBeenCalled();
    expect(mockSiemEvents.mock.calls[1][0]).toEqual({ cursor: 'cur-1' });
  });

  it('a source that keeps failing re-backfills alone; the others keep their own checkpoints', async () => {
    mockCheckpoints = {}; // fresh install: alerts fail from the very first poll
    mockListAlerts.mockRejectedValue(new SophosApiError('Sophos GET /common/v1/alerts failed: HTTP 503.', 503, ''));
    await new SophosSyncService().syncAll();
    expect(mockCheckpoints.last_alert_sync).toBeUndefined();
    expect(mockCheckpoints.last_siem_sync).toEqual(expect.any(String));
    expect(mockCheckpoints.last_detection_sync).toEqual(expect.any(String));

    const before = Date.now();
    await new SophosSyncService().syncAll();
    // SIEM continues from its cursor (no re-read from now - 23 h); XDR from its checkpoint.
    expect(mockSiemEvents.mock.calls[1][0]).toEqual({ cursor: 'cur-1' });
    expect(mockGraphql.mock.calls[1][1].in.cql_query).toMatch(/earliest=-[23]m$/);
    // Alerts alone backfill again.
    expect(before - Date.parse(mockListAlerts.mock.calls[1][0].from)).toBeGreaterThan(89 * 86_400_000);
  });

  it('detects a SIEM gap on a later poll even though another source has been pinned since the first poll', async () => {
    mockCheckpoints = {}; // fresh install: XDR fails from the very first poll
    mockGraphql.mockRejectedValue(new SophosGraphQLError('Sophos GraphQL error: internal failure', [{ message: 'internal failure' }]));
    const svc = new SophosSyncService();
    await svc.syncAll();
    expect(mockCheckpoints.last_detection_sync).toBeUndefined();
    // 30 h later (simulated by ageing the stored SIEM checkpoint).
    const stale = new Date(Date.now() - 30 * 3_600_000).toISOString();
    mockCheckpoints.last_siem_sync = stale;
    await svc.syncAll();
    expect(svc.getSyncStatus().syncGap?.from).toBe(stale);
    expect(mockCheckpoints.sync_gap).toMatchObject({ from: stale });
    expect(mockSiemEvents.mock.calls[1][0].cursor).toBeUndefined();
  });

  it('a tenant without XDR (GraphQL and REST both forbidden) records the capability, not an error', async () => {
    mockGraphql.mockRejectedValueOnce(new SophosApiError('HTTP 403', 403, ''));
    mockDetectionsV1.mockRejectedValueOnce(new SophosApiError('HTTP 403', 403, ''));
    const result = await new SophosSyncService().syncAll();
    expect(savedCheckpoints().last_detection_sync).toBeUndefined();
    expect(result.xdr_detections?.errors).toEqual([]);
    const caps = mockSaveDiscovery.mock.calls.map((c) => c[0].capabilities).filter(Boolean).pop();
    expect(caps).toMatchObject({ xdr_graphql: 'forbidden', xdr_rest: 'forbidden' });
  });

  it('discards checkpoints when the tenant changes mid-sync', async () => {
    mockListAlerts.mockImplementationOnce(async () => {
      // The admin saves another API credential (another tenant) while the poll runs.
      mockSettings = { configured: true, client_id: 'cid-2', tenant_id: undefined };
      return { items: [commonAlert()] };
    });
    const svc = new SophosSyncService();
    const result = await svc.syncAll();
    expect(result.scopeChanged).toBe(true);
    expect(mockSaveCheckpoints).not.toHaveBeenCalled();
    expect(mockRunEnrichment).not.toHaveBeenCalled();
    expect(mockSaveDiscovery.mock.calls.some((c) => c[0].capabilities)).toBe(false);
    expect(svc.isDue()).toBe(true);
  });

  it('a stored tenant that differs from whoami resets the checkpoints and backfills', async () => {
    const last = new Date(Date.now() - 60_000).toISOString();
    mockSettings = { ...mockSettings, tenant_id: '11111111-1111-4111-8111-111111111111' };
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: last, last_siem_sync: last, siem_cursor: 'c', last_detection_sync: last };
    const before = Date.now();
    await new SophosSyncService().syncAll();
    expect(mockResetCheckpoints).toHaveBeenCalledTimes(1);
    // Crash-safe order: the old tenant's checkpoints are gone before the new tenant is recorded.
    expect(mockResetCheckpoints.mock.invocationCallOrder[0]).toBeLessThan(mockSaveDiscovery.mock.invocationCallOrder[0]);
    expect(before - Date.parse(mockListAlerts.mock.calls[0][0].from)).toBeGreaterThan(89 * 86_400_000);
    expect(mockSiemEvents.mock.calls[0][0].cursor).toBeUndefined();
    expect(mockSaveDiscovery).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT, api_host: 'api-eu01.central.sophos.com', data_region: 'eu01' }));
  });

  it('runs enrichment, then agent-kill reconciliation, then auto-resolve, then posture when due', async () => {
    mockAutoResolveMode = 'dry_run';
    const result = await new SophosSyncService().syncAll();
    const order = [mockRunEnrichment, mockAgentKill, mockAutoResolvePass, mockPosturePass].map((m) => m.mock.invocationCallOrder[0]);
    expect(order.every((n) => typeof n === 'number')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(mockGraphql.mock.invocationCallOrder[0]).toBeLessThan(order[0]);
    expect(enrichmentCtor).toHaveBeenCalledWith(expect.anything(), 'achilles-results-*');
    expect(mockRunEnrichment).toHaveBeenCalledWith({ lookbackDays: 90 });
    expect(autoResolveCtor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ whoami: expect.any(Function) }), 'dry_run');
    expect(result.posture).toMatchObject({ healthCheck: true });
    expect(mockSaveCheckpoints.mock.calls.some((c) => typeof c[0].last_posture_sync === 'string')).toBe(true);

    // Inside the 6 h interval the posture pass is skipped.
    mockPosturePass.mockClear();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_posture_sync: new Date().toISOString() };
    expect((await new SophosSyncService().syncAll()).posture).toBeUndefined();
    expect(mockPosturePass).not.toHaveBeenCalled();
  });

  it('a failing enrichment, agent-kill, auto-resolve or posture pass never fails the sync', async () => {
    mockRunEnrichment.mockRejectedValueOnce(new Error('es down'));
    mockAgentKill.mockRejectedValueOnce(new Error('sqlite busy'));
    mockAutoResolvePass.mockRejectedValueOnce(new Error('boom-r'));
    mockPosturePass.mockRejectedValueOnce(new Error('boom-p'));
    const result = await new SophosSyncService().syncAll();
    expect(result.enrichment?.errors).toEqual(['es down']);
    expect(result.agentKill?.errors).toEqual(['sqlite busy']);
    expect(result.autoResolve?.errors).toEqual(['boom-r']);
    expect(result.posture?.errors).toEqual(['pass: boom-p']);
    expect(mockSaveCheckpoints.mock.calls.some((c) => typeof c[0].last_posture_sync === 'string')).toBe(false);
    expect(savedCheckpoints().last_alert_sync).toEqual(expect.any(String));
  });

  it('coalesces overlapping syncAll calls', async () => {
    let release!: () => void;
    mockWhoami.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ id: TENANT, idType: 'tenant', dataRegionHost: 'api-eu01.central.sophos.com' });
    }));
    const svc = new SophosSyncService();
    const first = svc.syncAll();
    const second = await svc.syncAll();
    expect(Object.keys(second)).toEqual(['timestamp']);
    expect(svc.getSyncStatus().inProgress).toBe(true);
    release();
    await first;
    expect(mockWhoami).toHaveBeenCalledTimes(1);
    expect(svc.getSyncStatus().inProgress).toBe(false);
  });

  // ── Merge across polls ───────────────────────────────────────────

  it('(a) merges a SIEM event into an alert stored by an earlier poll', async () => {
    mockSearch.mockResolvedValue(esHit(`alert-${ALERT_ID}`, JSON.parse(JSON.stringify(transformedAlert()))));
    mockSiemEvents.mockResolvedValueOnce({ items: [coreEvent()], next_cursor: 'cur-2', has_more: false });
    const result = await new SophosSyncService().syncAll();
    expect(updateIds()).toEqual([`alert-${ALERT_ID}`]);
    expect(docFor(`alert-${ALERT_ID}`)!.doc).toMatchObject({ merged_siem_event_ids: [EVENT_ID], prevention_action: 'quarantined' });
    expect(deleteIds()).toEqual([`siem-${EVENT_ID}`]);
    expect(result.siem_events).toMatchObject({ merged: 1 });
    // One lookup for the whole SIEM page, scoped to alert and siem_event rows.
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockSearch.mock.calls[0][0].query)).toContain('"source_type":["alert","siem_event"]');
  });

  it('(b) an alert absorbs a siem_event row stored by an earlier poll and deletes it', async () => {
    const row = JSON.parse(JSON.stringify(transformedEvent()));
    mockSearch.mockResolvedValue(esHit(`siem-${EVENT_ID}`, row));
    mockListAlerts.mockResolvedValueOnce({ items: [commonAlert()] });
    const result = await new SophosSyncService().syncAll();
    expect(docFor(`alert-${ALERT_ID}`)!.doc).toMatchObject({ merged_siem_event_ids: [EVENT_ID], prevention_action: 'quarantined' });
    expect(updateIds()).not.toContain(`siem-${EVENT_ID}`);
    expect(deleteIds()).toEqual([`siem-${EVENT_ID}`]);
    expect(result.alerts).toMatchObject({ synced: 1, merged: 1 });
  });

  it('(b) does not delete the siem_event row when writing the alert that absorbed it failed', async () => {
    mockSearch.mockResolvedValue(esHit(`siem-${EVENT_ID}`, JSON.parse(JSON.stringify(transformedEvent()))));
    mockListAlerts.mockResolvedValueOnce({ items: [commonAlert()] });
    mockBulk.mockResolvedValueOnce({ errors: true, items: [{ update: { _id: `alert-${ALERT_ID}`, status: 400, error: { reason: 'mapper_parsing_exception' } } }] });
    const result = await new SophosSyncService().syncAll();
    expect(deleteIds()).toEqual([]);
    expect(result.alerts?.errors[0]).toContain('mapper_parsing_exception');
  });

  it('(c) merges a legacy cleanup into the stored alert, and drops one that matches nothing', async () => {
    mockSearch.mockResolvedValue(esHit(`alert-${ALERT_ID}`, JSON.parse(JSON.stringify(transformedAlert()))));
    mockSiemEvents.mockResolvedValueOnce({ items: [cleanupEvent(), { ...cleanupEvent(), id: 'e-other', location: 'elsewhere' }], next_cursor: 'cur-2', has_more: false });
    const result = await new SophosSyncService().syncAll();
    expect(updateIds()).toEqual([`alert-${ALERT_ID}`]);
    expect(docFor(`alert-${ALERT_ID}`)!.doc).toMatchObject({ merged_siem_event_ids: [CLEANUP_ID], prevention_action: 'blocked' });
    expect(result.siem_events).toMatchObject({ fetched: 2, merged: 1, synced: 1 });
  });

  // ── Checkpoints ──────────────────────────────────────────────────

  it('first run backfills 90 days of alerts (less a 1 h margin); later runs read from the checkpoint minus 2 min', async () => {
    const before = Date.now();
    await new SophosSyncService().syncAll();
    const age = before - Date.parse(mockListAlerts.mock.calls[0][0].from);
    expect(age).toBeLessThanOrEqual(90 * 86_400_000 - 3_600_000);
    expect(age).toBeGreaterThan(90 * 86_400_000 - 3_600_000 - 5000);
    expect(mockSiemEvents.mock.calls[0][0].fromDate).toBeGreaterThan(0);

    vi.clearAllMocks();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: '2026-10-28T10:00:00.000Z', last_siem_sync: new Date().toISOString(), siem_cursor: 'cur-9', last_detection_sync: new Date().toISOString() };
    await new SophosSyncService().syncAll();
    expect(mockListAlerts.mock.calls[0][0].from).toBe('2026-10-28T09:58:00.000Z');
    expect(mockSiemEvents.mock.calls[0][0]).toEqual({ cursor: 'cur-9' });
  });

  it('follows the SIEM cursor across pages and saves the last cursor', async () => {
    mockSiemEvents
      .mockResolvedValueOnce({ items: [coreEvent()], next_cursor: 'p2', has_more: true })
      .mockResolvedValueOnce({ items: [], next_cursor: 'p3', has_more: false });
    await new SophosSyncService().syncAll();
    expect(mockSiemEvents.mock.calls[1][0]).toEqual({ cursor: 'p2' });
    expect(savedCheckpoints().siem_cursor).toBe('p3');
  });

  it('a permanently rejected doc does not pin the checkpoint; throttling does', async () => {
    mockListAlerts.mockResolvedValueOnce({ items: [commonAlert()] });
    mockBulk.mockResolvedValueOnce({ errors: true, items: [{ update: { _id: `alert-${ALERT_ID}`, status: 400, error: { reason: 'failed to parse' } } }] });
    const ok = await new SophosSyncService().syncAll();
    expect(ok.alerts).toMatchObject({ synced: 0, errors: [`alert-${ALERT_ID}: failed to parse`] });
    expect(savedCheckpoints().last_alert_sync).toEqual(expect.any(String));

    mockSaveCheckpoints.mockClear();
    mockListAlerts.mockResolvedValueOnce({ items: [commonAlert()] });
    mockBulk.mockResolvedValueOnce({ errors: true, items: [{ update: { _id: `alert-${ALERT_ID}`, status: 429, error: { reason: 'rejected execution' } } }] });
    await new SophosSyncService().syncAll();
    expect(savedCheckpoints().last_alert_sync).toBeUndefined();
  });

  it('a retryable write failure on a SIEM page keeps the cursor before that page and last_siem_sync unchanged', async () => {
    const last = new Date(Date.now() - 60 * 60_000).toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: last, last_siem_sync: last, siem_cursor: 'c0', last_detection_sync: last };
    mockSiemEvents
      .mockResolvedValueOnce({ items: [coreEvent()], next_cursor: 'p1', has_more: true })
      .mockResolvedValueOnce({ items: [], next_cursor: 'p2', has_more: false });
    mockBulk.mockResolvedValueOnce({ errors: true, items: [{ update: { _id: `siem-${EVENT_ID}`, status: 503, error: { reason: 'unavailable' } } }] });
    const result = await new SophosSyncService().syncAll();
    expect(result.siem_events?.errors[0]).toContain('unavailable');
    expect(mockSiemEvents).toHaveBeenCalledTimes(1);
    expect(savedCheckpoints().siem_cursor).toBeUndefined();
    expect(savedCheckpoints().last_siem_sync).toBeUndefined();
    expect(mockCheckpoints).toMatchObject({ siem_cursor: 'c0', last_siem_sync: last });
  });

  it('an API failure on SIEM page 2 keeps the cursor of page 1 and last_siem_sync unchanged', async () => {
    const last = new Date(Date.now() - 60 * 60_000).toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: last, last_siem_sync: last, siem_cursor: 'c0', last_detection_sync: last };
    mockSiemEvents
      .mockResolvedValueOnce({ items: [coreEvent()], next_cursor: 'p1', has_more: true })
      .mockRejectedValueOnce(new SophosApiError('Sophos GET /siem/v1/events failed: HTTP 503.', 503, ''));
    const result = await new SophosSyncService().syncAll();
    expect(result.siem_events?.errors[0]).toContain('503');
    expect(mockSiemEvents.mock.calls[1][0]).toEqual({ cursor: 'p1' });
    expect(savedCheckpoints().siem_cursor).toBe('p1');
    expect(savedCheckpoints().last_siem_sync).toBeUndefined();
    expect(mockCheckpoints.last_siem_sync).toBe(last);
  });

  it('a failing whoami fails the poll without touching checkpoints', async () => {
    mockWhoami.mockRejectedValueOnce(new SophosApiError('Sophos GET /whoami/v1 failed: HTTP 401.', 401, ''));
    const svc = new SophosSyncService();
    const result = await svc.syncAll();
    expect(result.alerts?.errors[0]).toContain('401');
    expect(mockSaveCheckpoints).not.toHaveBeenCalled();
    expect(svc.getSyncStatus().lastError).toMatchObject({ stage: 'whoami' });
  });

  it('clears a recorded sync gap after a clean poll at least 24 h after it was detected; keeps a recent one', async () => {
    const recent = { from: new Date(Date.now() - 50 * 3_600_000).toISOString(), to: new Date(Date.now() - 24 * 3_600_000).toISOString() };
    const now = new Date().toISOString();
    mockCheckpoints = { sync_version: SOPHOS_SYNC_VERSION, last_alert_sync: now, last_siem_sync: now, siem_cursor: 'c', last_detection_sync: now, sync_gap: recent };
    const svc = new SophosSyncService();
    await svc.syncAll();
    expect(savedCheckpoints().sync_gap).toBeUndefined();
    expect(svc.getSyncStatus().syncGap).toEqual(recent);

    mockSaveCheckpoints.mockClear();
    const old = { from: new Date(Date.now() - 80 * 3_600_000).toISOString(), to: new Date(Date.now() - 48 * 3_600_000).toISOString() };
    mockCheckpoints = { ...mockCheckpoints, sync_gap: old };
    await svc.syncAll();
    expect(savedCheckpoints().sync_gap).toBeNull();
    expect(svc.getSyncStatus().syncGap).toBeNull();
  });

  it('resetCheckpoints clears the stored checkpoints and the status', async () => {
    const svc = new SophosSyncService();
    await svc.syncAll();
    svc.resetCheckpoints();
    expect(mockResetCheckpoints).toHaveBeenCalled();
    expect(svc.getSyncStatus()).toMatchObject({ lastAlertSync: null, lastSiemSync: null, lastDetectionSync: null, syncGap: null });
  });

  it('isDue honors the configured polling interval', async () => {
    mockSettings = { ...mockSettings, poll_interval_minutes: 10 };
    const svc = new SophosSyncService();
    expect(svc.isDue()).toBe(true);
    await svc.syncAll();
    expect(svc.isDue()).toBe(false);
    expect(svc.isDue(Date.now() + 10 * 60_000 + 1)).toBe(true);
    mockSettings = null;
    expect(svc.isDue(Date.now() + 60 * 60_000)).toBe(false);
  });
});

// Normalized docs as the earlier poll would have stored them.
const { transformAlert, transformSiemEvent } = await import('../normalize.js');
function transformedAlert() { return transformAlert(commonAlert()); }
function transformedEvent() { return transformSiemEvent(coreEvent())!; }
