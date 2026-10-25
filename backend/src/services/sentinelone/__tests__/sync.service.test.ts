import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────
const mockListThreats = vi.fn();
const mockListAlerts = vi.fn();

vi.mock('../s1-client.js', () => ({
  SentinelOneClient: class {
    baseUrl = 'https://acme.sentinelone.net';
    listThreats = mockListThreats;
    listCloudDetectionAlerts = mockListAlerts;
    async *paginate(fetchPage: (p: Record<string, unknown>) => Promise<{ data: unknown[]; nextCursor?: string }>, params: Record<string, unknown>) {
      let cursor: string | undefined;
      do {
        const res = await fetchPage({ ...params, cursor });
        if (res.data.length) yield res.data;
        cursor = res.nextCursor;
      } while (cursor);
    }
  },
}));

let mockSettings: Record<string, unknown> | null;
let mockCheckpoints: Record<string, unknown>;
const mockSaveCheckpoints = vi.fn();
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getSentinelOneSettings = () => mockSettings;
    getSentinelOneCredentials = () => mockSettings ? { base_url: 'https://acme.sentinelone.net', api_token: 't'.repeat(30), permission_mode: 'read_only' } : null;
    getSentinelOneSyncTimestamps = () => mockCheckpoints;
    saveSentinelOneSyncTimestamps = mockSaveCheckpoints;
    resetSentinelOneSyncTimestamps = vi.fn();
    getSentinelOneAutoMitigation = () => mockAutoMitigation;
    getSentinelOneAutoResolveMode = () => mockAutoResolveMode;
  },
}));

let mockAutoMitigation: { mode: string; action: string } = { mode: 'disabled', action: 'kill' };
let mockAutoResolveMode = 'disabled';
const mockAutoResolvePass = vi.fn();
const autoResolveCtor = vi.fn();
vi.mock('../auto-resolve.service.js', () => ({
  SentinelOneAutoResolveService: class {
    constructor(...args: unknown[]) { autoResolveCtor(...args); }
    runAutoResolvePass = mockAutoResolvePass;
  },
}));
const mockAutoMitigationPass = vi.fn();
const autoMitigationCtor = vi.fn();
vi.mock('../auto-mitigation.service.js', () => ({
  SentinelOneAutoMitigationService: class {
    constructor(...args: unknown[]) { autoMitigationCtor(...args); }
    runAutoMitigationPass = mockAutoMitigationPass;
  },
}));
vi.mock('../response.service.js', () => ({ SentinelOneResponseService: class {} }));
const mockPosturePass = vi.fn();
vi.mock('../posture.service.js', () => ({
  POSTURE_INTERVAL_MS: 6 * 60 * 60 * 1000,
  SentinelOnePostureService: class { runPosturePass = mockPosturePass; },
}));

vi.mock('../index-management.js', () => ({
  ensureSentinelOneIndex: vi.fn().mockResolvedValue(undefined),
  SENTINELONE_INDEX: 'achilles-sentinelone',
}));

const mockBulk = vi.fn();
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class { getSettings = () => ({ configured: true }); },
}));
vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({ bulk: mockBulk }),
}));

const mockRunEnrichment = vi.fn();
const enrichmentCtor = vi.fn();
vi.mock('../../crowdstrike/enrichment.service.js', () => ({
  CrowdStrikeEnrichmentService: class {
    constructor(...args: unknown[]) { enrichmentCtor(...args); }
    runEnrichmentPass = mockRunEnrichment;
  },
}));

const { SentinelOneSyncService, transformThreat, transformCloudAlert, passesFilters, normalizeToken, SENTINELONE_SYNC_VERSION, threatPreventionAction } = await import('../sync.service.js');

// ── Fixtures (shape of /web/api/v2.1/threats and /cloud-detection/alerts) ──
const threat = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  threatInfo: {
    threatName: 'mimikatz.exe', confidenceLevel: 'malicious', incidentStatus: 'unresolved',
    mitigationStatus: 'mitigated', classification: 'Trojan', storyline: 'STORY1',
    filePath: '\\Device\\C:\\Users\\bob\\mimikatz.exe', fileDisplayName: 'mimikatz.exe',
    createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:05:00.000Z', sha1: 'abc', ...extra,
  },
  agentRealtimeInfo: { agentId: '999', agentComputerName: 'win-host-01', accountId: '111', siteId: '222' },
  indicators: [{ tactics: [{ techniques: [{ name: 'T1003.001', link: 'https://attack.mitre.org/techniques/T1003/001/' }] }] }],
  mitigationStatus: [{ action: 'kill', status: 'success' }],
});
const alert = (id: string, severity = 'High') => ({
  alertInfo: { alertId: id, incidentStatus: 'unresolved', createdAt: '2026-10-20T11:00:00.000Z' },
  ruleInfo: { name: 'Suspicious LSASS access T1003', severity },
  agentDetectionInfo: { name: 'linux-01', accountId: '111' },
  sourceProcessInfo: { name: 'bash', filePath: '/bin/bash', storyline: 'S2' },
});

describe('SentinelOne normalization', () => {
  it('maps a threat to the shared EDR alert doc shape', () => {
    const doc = transformThreat(threat('100') as never, 'https://acme.sentinelone.net');
    expect(doc).toMatchObject({
      doc_type: 'alert', source_type: 'threats', alert_id: '100', alert_title: 'mimikatz.exe',
      severity: 'high', status: 'unresolved', service_source: 'SentinelOne',
      mitre_techniques: ['T1003.001'], evidence_hostnames: ['WIN-HOST-01'], evidence_filenames: ['mimikatz.exe'],
      account_id: '111', site_id: '222', agent_id: '999', storyline_id: 'STORY1', prevention_action: 'process_killed',
      portal_url: 'https://acme.sentinelone.net/incidents/threats/100/overview',
    });
  });

  it('maps a cloud detection alert with normalized severity', () => {
    expect(transformCloudAlert(alert('a1', 'Info') as never)).toMatchObject({
      alert_id: 'a1', source_type: 'cloud_detection_alerts', severity: 'informational',
      mitre_techniques: ['T1003'], evidence_hostnames: ['LINUX-01'], evidence_filepaths: ['/bin/bash'],
    });
    expect(transformCloudAlert({ alertInfo: {} } as never)).toBeNull();
  });
});

describe('SentinelOne normalization — missing dates', () => {
  it('emits null, never an empty string, for dates S1 omits (ES date fields reject "")', () => {
    const t = transformThreat({ id: 't9', threatInfo: {} } as never, 'https://acme.sentinelone.net');
    expect(t).toMatchObject({ timestamp: null, created_at: null, updated_at: null, resolved_at: null });
    const a = transformCloudAlert({ alertInfo: { alertId: 'a9' } } as never);
    expect(a).toMatchObject({ timestamp: null, created_at: null, updated_at: null });
  });
});

describe('SentinelOne normalization — shared-module contract', () => {
  it('lowercases display-case statuses and verdicts from detection alerts and sets resolved_at', () => {
    const doc = transformCloudAlert({
      alertInfo: { alertId: 'r1', incidentStatus: 'Resolved', analystVerdict: 'False positive', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
      ruleInfo: { name: 'x', severity: 'Medium' },
    } as never);
    expect(doc).toMatchObject({ status: 'resolved', analyst_verdict: 'false_positive', resolved_at: '2026-10-02T00:00:00Z' });
    expect(transformCloudAlert({ alertInfo: { alertId: 'r2', incidentStatus: 'In progress' } } as never)?.status).toBe('in_progress');
    expect(normalizeToken('Unresolved')).toBe('unresolved');
  });

  it('derives evidence_filenames from the threat file path, name and originator process', () => {
    const doc = transformThreat({
      id: 't1',
      threatInfo: {
        threatName: '5f1a2b3c-0000-4000-8000-000000000001-t1003.001.exe',
        filePath: '\\Device\\HarddiskVolume3\\Users\\Public\\F0\\5F1A2B3C-0000-4000-8000-000000000001-T1003.001.exe',
        originatorProcess: 'powershell.exe',
        incidentStatus: 'resolved',
        updatedAt: '2026-10-03T00:00:00Z',
      },
    } as never, 'https://acme.sentinelone.net');
    expect(doc.evidence_filenames).toEqual(['5f1a2b3c-0000-4000-8000-000000000001-t1003.001.exe', 'powershell.exe']);
    expect(doc.evidence_filepaths[0]).toContain('\\device\\harddiskvolume3');
    expect(doc.resolved_at).toBe('2026-10-03T00:00:00Z');
  });

  it('ignores behavioral threat names that are not file names', () => {
    const doc = transformThreat({ id: 't2', threatInfo: { threatName: 'Suspicious Behavior Detected' } } as never, 'https://acme.sentinelone.net');
    expect(doc.evidence_filenames).toEqual([]);
  });

  it('derives detection-alert filenames from process names / image paths and techniques from the rule', () => {
    const doc = transformCloudAlert({
      alertInfo: { alertId: 'a9', incidentStatus: 'Unresolved' },
      ruleInfo: { name: 'Credential dumping', description: 'LSASS access (T1003.001)', severity: 'High' },
      agentDetectionInfo: { name: 'win-01', accountId: '1', siteId: '2', groupId: '3' },
      sourceProcessInfo: { name: 'cmd.exe', filePath: 'C:\\Windows\\System32\\cmd.exe', fileHashSha256: 'f'.repeat(64) },
      targetProcessInfo: { tgtProcImagePath: 'C:\\F0\\abc-t1003.exe' },
    } as never);
    expect(doc).toMatchObject({ account_id: '1', site_id: '2', group_id: '3', sha256: 'f'.repeat(64) });
    expect(doc?.evidence_filenames).toEqual(['cmd.exe', 'abc-t1003.exe']);
    expect(doc?.evidence_filepaths).toEqual(['c:\\windows\\system32\\cmd.exe', 'c:\\f0\\abc-t1003.exe']);
    expect(doc?.mitre_techniques).toEqual(['T1003.001']);
    expect(doc?.status).toBe('unresolved');
    expect(doc?.resolved_at).toBeNull();
  });

  it('maps a successful remediation onto the shared prevention vocabulary', () => {
    const doc = transformThreat({ id: 't3', threatInfo: {}, mitigationStatus: [{ action: 'remediate', status: 'success' }] } as never, 'https://acme.sentinelone.net');
    expect(doc.prevention_action).toBe('quarantined');
  });

  it('status filters match regardless of configured case', () => {
    const doc = transformCloudAlert({ alertInfo: { alertId: 'f1', incidentStatus: 'Unresolved' } } as never)!;
    expect(passesFilters(doc, { filters: { incident_statuses: ['unresolved'] } } as never)).toBe(true);
    expect(passesFilters(doc, { filters: { incident_statuses: ['resolved'] } } as never)).toBe(false);
  });
});

describe('threatPreventionAction (kill failed only on a failed stop attempt)', () => {
  const t = (report: Array<{ action: string; status: string }>, overall?: string) =>
    ({ id: '1', threatInfo: { mitigationStatus: overall }, mitigationStatus: report }) as never;
  it('kill / quarantine / remediate that failed → kill_failed', () => {
    expect(threatPreventionAction(t([{ action: 'kill', status: 'failed' }]))).toBe('kill_failed');
    expect(threatPreventionAction(t([{ action: 'quarantine', status: 'failed' }]))).toBe('kill_failed');
    expect(threatPreventionAction(t([{ action: 'remediate', status: 'failed' }]))).toBe('kill_failed');
  });
  it('a failed non-stop action (rollback, un-quarantine, network) is not a failed kill', () => {
    expect(threatPreventionAction(t([{ action: 'rollback', status: 'failed' }]))).toBeUndefined();
    expect(threatPreventionAction(t([{ action: 'un-quarantine', status: 'failed' }]))).toBeUndefined();
    expect(threatPreventionAction(t([{ action: 'network_quarantine', status: 'failed' }], 'not_mitigated'))).toBeUndefined();
  });
  it('a success wins over a failed attempt; no report = no action', () => {
    expect(threatPreventionAction(t([{ action: 'kill', status: 'failed' }, { action: 'quarantine', status: 'success' }]))).toBe('quarantined');
    expect(threatPreventionAction(t([], 'not_mitigated'))).toBeUndefined();
  });
});

describe('threatPreventionAction: only SentinelOne\'s own, immediate response counts', () => {
  const at = (iso: string) => ({ threatInfo: { identifiedAt: '2026-10-20T10:00:00.000Z', createdAt: '2026-10-20T10:00:01.000Z' }, mitigationStatus: [{ action: 'quarantine', status: 'success', mitigationStartedAt: iso }] }) as never;

  it('a quarantine that started with the detection is prevention', () => {
    expect(threatPreventionAction(at('2026-10-20T10:00:03.000Z'))).toBe('quarantined');
  });

  it('a quarantine an analyst or a rule ran hours later is not', () => {
    expect(threatPreventionAction(at('2026-10-20T14:00:00.000Z'))).toBeUndefined();
  });

  it('a late manual response does not fall back to the "mitigated" summary either', () => {
    const t = { threatInfo: { identifiedAt: '2026-10-20T10:00:00.000Z', mitigationStatus: 'mitigated' }, mitigationStatus: [{ action: 'kill', status: 'success', mitigationStartedAt: '2026-10-21T09:00:00.000Z' }] } as never;
    expect(threatPreventionAction(t)).toBeUndefined();
  });

  it('missing timestamps keep the report as-is (no data loss when S1 omits them)', () => {
    expect(threatPreventionAction({ threatInfo: {}, mitigationStatus: [{ action: 'kill', status: 'success' }] } as never)).toBe('process_killed');
  });
});

describe('SentinelOneSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { configured: true, base_url: 'https://acme.sentinelone.net', backfill_days: 30, scope: { account_ids: ['111'] } };
    mockCheckpoints = {};
    mockBulk.mockResolvedValue({ errors: false, items: [] });
    mockListThreats.mockResolvedValue({ data: [] });
    mockListAlerts.mockResolvedValue({ data: [] });
    mockRunEnrichment.mockResolvedValue({ scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors: [], durationMs: 0 });
    mockAutoMitigation = { mode: 'disabled', action: 'kill' };
    mockAutoResolveMode = 'disabled';
    mockAutoMitigationPass.mockResolvedValue({ mode: 'disabled', action: 'kill', candidates: 0, mitigated: 0, wouldMitigate: 0, skipped: 0, errors: [], durationMs: 0 });
    mockAutoResolvePass.mockResolvedValue({ mode: 'disabled', candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [], durationMs: 0 });
    mockPosturePass.mockResolvedValue({ exclusions: 1, policies: 2, agents: 3, agentHealth: null, errors: [], durationMs: 0 });
  });

  it('runs auto-mitigation, then auto-resolve, after the correlation pass, with the stored modes and scope', async () => {
    mockSettings = { ...mockSettings, permission_mode: 'response' };
    mockAutoMitigation = { mode: 'dry_run', action: 'quarantine' };
    mockAutoResolveMode = 'dry_run';
    const result = await new SentinelOneSyncService().syncAll();
    expect(autoMitigationCtor).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      mode: 'dry_run', action: 'quarantine', permissionMode: 'response', scope: { account_ids: ['111'] },
    }, expect.objectContaining({ listThreats: expect.any(Function) }));
    expect(autoResolveCtor).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'dry_run', { account_ids: ['111'] });
    expect(mockRunEnrichment.mock.invocationCallOrder[0]).toBeLessThan(mockAutoMitigationPass.mock.invocationCallOrder[0]);
    expect(mockAutoMitigationPass.mock.invocationCallOrder[0]).toBeLessThan(mockAutoResolvePass.mock.invocationCallOrder[0]);
    expect(result.autoResolve?.mode).toBe('disabled'); // value from the mocked pass
  });

  it('passes read_only to auto-mitigation when the integration is not in Response mode', async () => {
    mockAutoMitigation = { mode: 'enabled', action: 'kill' };
    await new SentinelOneSyncService().syncAll();
    expect(autoMitigationCtor.mock.calls[0][2]).toMatchObject({ permissionMode: 'read_only' });
  });

  it('a throwing auto-resolve / auto-mitigation pass never fails the sync', async () => {
    mockAutoMitigationPass.mockRejectedValueOnce(new Error('boom-m'));
    mockAutoResolvePass.mockRejectedValueOnce(new Error('boom-r'));
    const result = await new SentinelOneSyncService().syncAll();
    expect(result.autoMitigation?.errors).toEqual(['boom-m']);
    expect(result.autoResolve?.errors).toEqual(['boom-r']);
    expect(result.threats?.errors).toEqual([]);
  });

  it('runs the posture pass when due and records the checkpoint; skips it inside the interval', async () => {
    const result = await new SentinelOneSyncService().syncAll();
    expect(mockPosturePass).toHaveBeenCalledTimes(1);
    expect(result.posture).toMatchObject({ exclusions: 1, policies: 2, agents: 3 });
    expect(mockSaveCheckpoints.mock.calls.some((c) => typeof c[0].last_posture_sync === 'string')).toBe(true);

    mockPosturePass.mockClear();
    mockCheckpoints = { last_posture_sync: new Date().toISOString() };
    const again = await new SentinelOneSyncService().syncAll();
    expect(mockPosturePass).not.toHaveBeenCalled();
    expect(again.posture).toBeUndefined();

    // A partial pass (403 on some scopes) still records the checkpoint; an index failure retries.
    mockSaveCheckpoints.mockClear();
    mockCheckpoints = {};
    mockPosturePass.mockResolvedValueOnce({ exclusions: 1, policies: 0, agents: 0, agentHealth: null, errors: ['policies: x', 'agents: y', 'agent_health: z', 'policies: w', 'policies: v'], durationMs: 0 });
    await new SentinelOneSyncService().syncAll();
    expect(mockSaveCheckpoints.mock.calls.some((c) => typeof c[0].last_posture_sync === 'string')).toBe(true);
    mockSaveCheckpoints.mockClear();
    mockPosturePass.mockResolvedValueOnce({ exclusions: 0, policies: 0, agents: 0, agentHealth: null, errors: ['index: down'], durationMs: 0 });
    await new SentinelOneSyncService().syncAll();
    expect(mockSaveCheckpoints.mock.calls.some((c) => typeof c[0].last_posture_sync === 'string')).toBe(false);
  });

  it('initial sync backfills the configured window with scope params, then upserts by id', async () => {
    mockListThreats
      .mockResolvedValueOnce({ data: [threat('1'), threat('2')], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: [threat('3')] });
    mockListAlerts.mockResolvedValueOnce({ data: [alert('a1')] });

    const svc = new SentinelOneSyncService();
    const before = Date.now();
    const result = await svc.syncAll();

    expect(result.threats).toMatchObject({ fetched: 3, synced: 3, errors: [] });
    expect(result.cloud_detection_alerts).toMatchObject({ fetched: 1, synced: 1 });

    const firstParams = mockListThreats.mock.calls[0][0];
    expect(firstParams.accountIds).toEqual(['111']);
    const since = Date.parse(firstParams.createdAt__gte);
    expect(before - since).toBeGreaterThanOrEqual(30 * 86_400_000 - 5000);
    expect(before - since).toBeLessThan(31 * 86_400_000);
    expect(mockListThreats.mock.calls[1][0].cursor).toBe('next');

    const ops = mockBulk.mock.calls[0][0].operations;
    expect(ops[0]).toEqual({ update: { _index: 'achilles-sentinelone', _id: 'threat-1', retry_on_conflict: 3 } });
    expect(ops[1].doc_as_upsert).toBe(true);

    expect(mockSaveCheckpoints).toHaveBeenCalledWith(expect.objectContaining({ sync_version: SENTINELONE_SYNC_VERSION }));
    const saved = mockSaveCheckpoints.mock.calls[0][0];
    expect(saved.last_threat_sync).toBeTruthy();
    expect(saved.last_alert_sync).toBeTruthy();
  });

  it('incremental sync uses updatedAt__gte (threats) / createdAt__gte (alerts) from the checkpoint', async () => {
    mockCheckpoints = { last_threat_sync: '2026-10-22T10:00:00.000Z', last_alert_sync: '2026-10-22T09:00:00.000Z', sync_version: SENTINELONE_SYNC_VERSION };
    await new SentinelOneSyncService().syncAll();
    expect(mockListThreats.mock.calls[0][0].updatedAt__gte).toBe('2026-10-22T09:58:00.000Z');
    expect(mockListThreats.mock.calls[0][0].createdAt__gte).toBeUndefined();
    expect(mockListAlerts.mock.calls[0][0].createdAt__gte).toBe('2026-10-22T08:58:00.000Z');
  });

  it('removes items that stopped passing the filters instead of keeping a stale copy', async () => {
    mockSettings = { ...mockSettings, sources: ['threats'], filters: { incident_statuses: ['unresolved'] } };
    mockListThreats.mockResolvedValueOnce({ data: [threat('1'), threat('2', { incidentStatus: 'resolved' })] });
    const result = await new SentinelOneSyncService().syncAll();
    expect(result.threats).toMatchObject({ synced: 1, filtered: 1, errors: [] });
    const ops = mockBulk.mock.calls[0][0].operations;
    expect(ops).toContainEqual({ delete: { _index: 'achilles-sentinelone', _id: 'threat-2' } });
    expect(ops).toContainEqual({ update: { _index: 'achilles-sentinelone', _id: 'threat-1', retry_on_conflict: 3 } });
  });

  it('a permanently rejected doc is reported but does not pin the checkpoint; throttling does', async () => {
    mockSettings = { ...mockSettings, sources: ['threats'] };
    mockListThreats.mockResolvedValueOnce({ data: [threat('1'), threat('2')] });
    mockBulk.mockResolvedValueOnce({ errors: true, items: [
      { update: { _id: 'threat-1', status: 200 } },
      { update: { _id: 'threat-2', status: 400, error: { reason: 'failed to parse field [created_at]' } } },
    ] });
    const ok = await new SentinelOneSyncService().syncAll();
    expect(ok.threats).toMatchObject({ synced: 1, errors: ['threat-2: failed to parse field [created_at]'] });
    expect(mockSaveCheckpoints.mock.calls[0][0].last_threat_sync).toBeTruthy();

    mockSaveCheckpoints.mockClear();
    mockListThreats.mockResolvedValueOnce({ data: [threat('1')] });
    mockBulk.mockResolvedValueOnce({ errors: true, items: [{ update: { _id: 'threat-1', status: 429, error: { reason: 'rejected execution' } } }] });
    await new SentinelOneSyncService().syncAll();
    expect(mockSaveCheckpoints.mock.calls[0][0].last_threat_sync).toBeUndefined();
  });

  it('a scope change saved while the sync runs is not overwritten with the old scope\'s checkpoints', async () => {
    mockSettings = { ...mockSettings, sources: ['threats'] };
    mockListThreats.mockImplementationOnce(async () => {
      // The admin saves a new site scope while the backfill is fetching.
      mockSettings = { ...mockSettings, scope: { site_ids: ['999'] } };
      return { data: [threat('1')] };
    });
    const svc = new SentinelOneSyncService();
    const result = await svc.syncAll();
    expect(result.scopeChanged).toBe(true);
    expect(mockSaveCheckpoints).not.toHaveBeenCalled();
    expect(mockRunEnrichment).not.toHaveBeenCalled();
    expect(svc.isDue()).toBe(true);
  });

  it('does not record the doc-schema version until every enabled source re-synced cleanly', async () => {
    mockCheckpoints = { last_threat_sync: '2026-10-22T10:00:00.000Z', last_alert_sync: '2026-10-22T09:00:00.000Z', sync_version: SENTINELONE_SYNC_VERSION - 1 };
    mockListAlerts.mockRejectedValueOnce(new Error('HTTP 500'));
    await new SentinelOneSyncService().syncAll();
    const saved = mockSaveCheckpoints.mock.calls[0][0];
    expect(saved.last_threat_sync).toBeTruthy();
    expect(saved.last_alert_sync).toBeUndefined();
    expect(saved.sync_version).toBeUndefined();
  });

  it('applies severity / status segmentation filters', async () => {
    mockSettings = { ...mockSettings, sources: ['cloud_detection_alerts'], filters: { severities: ['critical', 'high'] } };
    mockListAlerts.mockResolvedValueOnce({ data: [alert('a1', 'High'), alert('a2', 'Low'), alert('a3', 'Critical')] });
    const result = await new SentinelOneSyncService().syncAll();
    expect(result.threats).toBeUndefined();
    expect(result.cloud_detection_alerts).toMatchObject({ fetched: 3, synced: 2, filtered: 1 });
    expect(mockListThreats).not.toHaveBeenCalled();
  });

  it('does not advance the checkpoint when the API fails', async () => {
    mockSettings = { ...mockSettings, sources: ['threats'] };
    mockListThreats.mockRejectedValueOnce(new Error('HTTP 401'));
    const svc = new SentinelOneSyncService();
    const result = await svc.syncAll();
    expect(result.threats?.errors[0]).toContain('401');
    expect(mockSaveCheckpoints.mock.calls[0][0].last_threat_sync).toBeUndefined();
    expect(svc.getSyncStatus().lastError?.message).toContain('401');
  });

  it('runs the correlation pass after the poll against achilles-sentinelone with sentinelone_* flags', async () => {
    mockRunEnrichment.mockResolvedValueOnce({ scanned: 4, detected: 1, stageDetected: 1, skipped: 0, batches: 1, alertsMarkedCorrelated: 2, errors: [], durationMs: 5 });
    const result = await new SentinelOneSyncService().syncAll();
    expect(enrichmentCtor).toHaveBeenCalledWith(expect.anything(), undefined, { alertIndex: 'achilles-sentinelone', flagPrefix: 'sentinelone', ignoreAchillesMitigated: true });
    expect(mockRunEnrichment).toHaveBeenCalledWith({ lookbackDays: 90 });
    expect(result.enrichment).toMatchObject({ detected: 1, alertsMarkedCorrelated: 2 });
    // Enrichment runs after both sources were polled.
    expect(mockRunEnrichment.mock.invocationCallOrder[0]).toBeGreaterThan(mockListAlerts.mock.invocationCallOrder[0]);
  });

  it('a failing correlation pass never fails the sync', async () => {
    mockRunEnrichment.mockRejectedValueOnce(new Error('es down'));
    const result = await new SentinelOneSyncService().syncAll();
    expect(result.enrichment?.errors).toEqual(['es down']);
    expect(mockSaveCheckpoints).toHaveBeenCalled();
  });

  it('bumps the sync version so v1 docs are re-normalized by a full backfill', async () => {
    expect(SENTINELONE_SYNC_VERSION).toBeGreaterThanOrEqual(2);
    mockCheckpoints = { last_threat_sync: '2026-10-22T10:00:00.000Z', last_alert_sync: '2026-10-22T10:00:00.000Z', sync_version: 1 };
    await new SentinelOneSyncService().syncAll();
    expect(mockListThreats.mock.calls[0][0].updatedAt__gte).toBeUndefined();
    expect(mockListThreats.mock.calls[0][0].createdAt__gte).toBeTruthy();
  });

  it('isDue honors the configured polling interval', async () => {
    mockSettings = { ...mockSettings, poll_interval_minutes: 10 };
    const svc = new SentinelOneSyncService();
    expect(svc.isDue()).toBe(true);
    await svc.syncAll();
    expect(svc.isDue()).toBe(false);
    expect(svc.isDue(Date.now() + 10 * 60_000 + 1)).toBe(true);
    mockSettings = null;
    expect(svc.isDue(Date.now() + 60 * 60_000)).toBe(false);
  });
});
