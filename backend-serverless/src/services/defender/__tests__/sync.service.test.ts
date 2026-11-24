// Fork-scope test: prevention-action derivation in transformAlert plus the
// ALERT_SYNC_VERSION 3→4 full re-sync trigger. Mirrors
// backend/src/services/defender/__tests__/sync.service.test.ts (prevention
// disposition describe) — the fork has no broader defender sync suite.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockGetAlerts = vi.fn();

vi.mock('../graph-client.js', () => ({
  MicrosoftGraphClient: class {
    getAlerts = mockGetAlerts;
    getSecureScores = vi.fn().mockResolvedValue([]);
    getControlProfiles = vi.fn().mockResolvedValue([]);
  },
}));

const mockGetDefenderSyncTimestamps = vi.fn().mockReturnValue({});
const mockSaveDefenderSyncTimestamps = vi.fn();
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getDefenderCredentials = async () => ({
      authMethod: 'client_secret',
      tenant_id: 'test-tenant-id',
      client_id: 'test-client-id',
      client_secret: 'test-secret',
    });
    isDefenderConfigured = async () => true;
    getAutoResolveMode = async () => 'disabled';
    getDefenderSyncTimestamps = mockGetDefenderSyncTimestamps;
    saveDefenderSyncTimestamps = mockSaveDefenderSyncTimestamps;
  },
}));

vi.mock('../index-management.js', () => ({
  ensureDefenderIndex: vi.fn().mockResolvedValue(undefined),
  ensureDefenderIndexMappings: vi.fn().mockResolvedValue(undefined),
  DEFENDER_INDEX: 'achilles-defender',
}));

const mockBulk = vi.fn();

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = async () => ({ configured: true, connectionType: 'node', node: 'http://localhost:9200', indexPattern: 'achilles-results-*' });
  },
}));

vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({
    bulk: mockBulk,
  }),
}));

vi.mock('../enrichment.service.js', () => ({
  DefenderEnrichmentService: class {
    async runEnrichmentPass() {
      callOrder.push('enrichment');
      return { scanned: 0, detected: 0, stageDetected: 0, skipped: 0, batches: 0, alertsMarkedCorrelated: 0, errors: [], durationMs: 0 };
    }
  },
}));

// Mock the completed-stage clean-up: it runs just before the enrichment pass.
const callOrder: string[] = [];
const mockCleanup = vi.fn(async (..._args: unknown[]) => {
  callOrder.push('cleanup');
  return { matched: 0, sent: 0, cleared: 0, errors: [] as string[] };
});
vi.mock('../../edr/completedStageCleanup.js', () => ({
  clearPreventionOnCompletedResults: (...args: unknown[]) => mockCleanup(...args),
}));

vi.mock('../auto-resolve.service.js', () => ({
  DefenderAutoResolveService: class {
    runAutoResolvePass = vi.fn().mockResolvedValue({
      mode: 'disabled', candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [], durationMs: 0,
    });
  },
}));

const { DefenderSyncService } = await import('../sync.service.js');

// ── Fixtures ─────────────────────────────────────────────────────────

const alertWithEvidence = (evidence: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  id: 'alert-prev',
  title: 'Prevention test',
  description: '',
  severity: 'high',
  status: 'new',
  category: 'Malware',
  serviceSource: 'microsoftDefenderForEndpoint',
  createdDateTime: '2026-10-01T12:00:00Z',
  lastUpdateDateTime: '2026-10-01T12:05:00Z',
  mitreTechniques: [],
  recommendedActions: '',
  evidence,
  ...extra,
});

const fileEvidence = (status: string) => ({
  '@odata.type': '#microsoft.graph.security.processEvidence',
  remediationStatus: status,
  verdict: 'malicious',
  imageFile: { fileName: 'stage.exe', filePath: 'C:\\F0\\stage.exe' },
});
const deviceEvidence = (status: string) => ({
  '@odata.type': '#microsoft.graph.security.deviceEvidence',
  remediationStatus: status,
  verdict: 'malicious',
  deviceDnsName: 'WIN-LAB-01',
});

// ── Tests ────────────────────────────────────────────────────────────

describe('DefenderSyncService (serverless) — prevention disposition', () => {
  let service: InstanceType<typeof DefenderSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DefenderSyncService();
    mockGetDefenderSyncTimestamps.mockReturnValue({});
    mockBulk.mockResolvedValue({ errors: false, items: [] });
  });

  const syncOneAndGetDoc = async (alert: Record<string, unknown>) => {
    mockGetAlerts.mockResolvedValue([alert]);
    await service.syncAlerts();
    return mockBulk.mock.calls[0][0].operations[1].doc;
  };

  it('blocked (blocked while executing) → process_killed', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([fileEvidence('blocked')]));
    expect(doc.prevention_action).toBe('process_killed');
    expect(doc.remediation_status).toBe('blocked');
  });

  it('prevented (prevented from executing) → blocked', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([fileEvidence('prevented')]));
    expect(doc.prevention_action).toBe('blocked');
    expect(doc.remediation_status).toBe('prevented');
  });

  it('remediated (completed) → quarantined', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([fileEvidence('remediated')]));
    expect(doc.prevention_action).toBe('quarantined');
    expect(doc.remediation_status).toBe('remediated');
  });

  it('strongest completed action wins across evidence items (remediated > blocked > prevented)', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([
      fileEvidence('prevented'),
      fileEvidence('remediated'),
      fileEvidence('blocked'),
    ]));
    expect(doc.prevention_action).toBe('quarantined');
    expect(doc.remediation_status).toBe('remediated');
  });

  it('prefers filename/path-carrying evidence over other evidence', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([
      deviceEvidence('remediated'),
      fileEvidence('prevented'),
    ]));
    expect(doc.prevention_action).toBe('blocked');
    expect(doc.remediation_status).toBe('prevented');
  });

  it('falls back to non-file evidence when no file evidence has a prevention-ish status', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([deviceEvidence('blocked')]));
    expect(doc.prevention_action).toBe('process_killed');
    expect(doc.remediation_status).toBe('blocked');
  });

  it('detection-only statuses (active/running/none/unremediated) yield no prevention fields', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([
      fileEvidence('active'),
      deviceEvidence('unremediated'),
      deviceEvidence('none'),
    ]));
    expect(doc.prevention_action).toBeUndefined();
    expect(doc.remediation_status).toBeUndefined();
    expect(doc.portal_url).toBeUndefined();
  });

  it('captures alertWebUrl as portal_url', async () => {
    const doc = await syncOneAndGetDoc(alertWithEvidence([], {
      alertWebUrl: 'https://security.microsoft.com/alerts/alert-prev?tid=abc',
    }));
    expect(doc.portal_url).toBe('https://security.microsoft.com/alerts/alert-prev?tid=abc');
  });

  it('sync_version 3 (pre-prevention fields) forces a full re-sync', async () => {
    // ALERT_SYNC_VERSION=4 added prevention_action / remediation_status /
    // portal_url — existing deployments must re-fetch the full window once.
    mockGetDefenderSyncTimestamps.mockReturnValue({
      last_alert_sync: '2026-09-01T00:00:00Z',
      sync_version: 3,
    });
    mockGetAlerts.mockResolvedValue([]);

    const freshService = new DefenderSyncService();
    await freshService.syncAlerts();

    // lastAlertSync must NOT have been adopted — the filter is the 90-day
    // lookback, not the stale checkpoint.
    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.stringContaining('createdDateTime ge'),
    );
  });
});

describe('DefenderSyncService (serverless) — enrichment step', () => {
  let service: InstanceType<typeof DefenderSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DefenderSyncService();
    mockGetDefenderSyncTimestamps.mockReturnValue({});
    mockGetAlerts.mockResolvedValue([]);
    mockBulk.mockResolvedValue({ errors: false, items: [] });
  });

  it('runs the completed-stage clean-up with the ES client and the results index pattern, before the enrichment pass', async () => {
    callOrder.length = 0;
    await service.syncAll();
    expect(mockCleanup).toHaveBeenCalledTimes(1);
    expect(mockCleanup).toHaveBeenCalledWith(expect.objectContaining({ bulk: mockBulk }), 'achilles-results-*');
    expect(callOrder).toEqual(['cleanup', 'enrichment']);
  });

  it('logs the clean-up when it matched something and warns its first errors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const errors = ['bulk[0]: e0', 'bulk[1]: e1', 'bulk[2]: e2', 'bulk[3]: e3', 'bulk[4]: e4', 'bulk[5]: e5'];
      mockCleanup.mockResolvedValueOnce({ matched: 7, sent: 6, cleared: 0, errors });
      await service.syncAll();
      expect(log).toHaveBeenCalledWith('[Completed-Stage-Cleanup] matched=7 sent=6 cleared=0');
      const cleanupWarnings = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[Completed-Stage-Cleanup-ERROR]'));
      expect(cleanupWarnings).toEqual(errors.slice(0, 5).map((e) => `[Completed-Stage-Cleanup-ERROR] ${e}`));
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
