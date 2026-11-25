import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

// Mock Graph client
const mockGetSecureScores = vi.fn();
const mockGetControlProfiles = vi.fn();
const mockGetAlerts = vi.fn();

vi.mock('../graph-client.js', () => ({
  MicrosoftGraphClient: class {
    getSecureScores = mockGetSecureScores;
    getControlProfiles = mockGetControlProfiles;
    getAlerts = mockGetAlerts;
  },
}));

// Mock integrations settings.
// Auto-resolve mode is mutable via the exported setter so individual tests
// can flip it without re-mocking the whole module.
let mockAutoResolveMode: 'disabled' | 'dry_run' | 'enabled' = 'disabled';
const mockGetDefenderSyncTimestamps = vi.fn().mockReturnValue({});
const mockSaveDefenderSyncTimestamps = vi.fn();
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getDefenderCredentials = () => ({
      tenant_id: 'test-tenant-id',
      client_id: 'test-client-id',
      client_secret: 'test-secret',
    });
    isDefenderConfigured = () => true;
    getAutoResolveMode = () => mockAutoResolveMode;
    getDefenderSyncTimestamps = mockGetDefenderSyncTimestamps;
    saveDefenderSyncTimestamps = mockSaveDefenderSyncTimestamps;
  },
}));

// Mock index management
vi.mock('../index-management.js', () => ({
  ensureDefenderIndex: vi.fn().mockResolvedValue(undefined),
  ensureDefenderIndexMappings: vi.fn().mockResolvedValue(undefined),
  DEFENDER_INDEX: 'achilles-defender',
}));

// Mock analytics settings + client
const mockBulk = vi.fn();
const mockDeleteByQuery = vi.fn();

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = () => ({ configured: true, connectionType: 'node', node: 'http://localhost:9200' });
    isConfigured = () => true;
  },
}));

vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({
    bulk: mockBulk,
    deleteByQuery: mockDeleteByQuery,
  }),
}));

// Mock enrichment service (records its constructor arguments; a test can set the pass result)
const mockEnrichmentCtor = vi.fn();
let mockEnrichmentResult: Record<string, unknown> | undefined;
vi.mock('../enrichment.service.js', () => ({
  DefenderEnrichmentService: class {
    constructor(...args: unknown[]) {
      mockEnrichmentCtor(...args);
    }
    async runEnrichmentPass() {
      return mockEnrichmentResult ?? {
        scanned: 0,
        detected: 0,
        skipped: 0,
        batches: 0,
        alertsMarkedCorrelated: 0,
        removedFlagDocs: [],
        errors: [],
        durationMs: 0,
      };
    }
  },
}));

// Mock auto-resolve service. Exposes the call count via a shared spy so
// tests can assert that syncAll() and runAutoResolvePass() actually invoke it.
const mockAutoResolveRun = vi.fn().mockResolvedValue({
  mode: 'disabled',
  candidates: 0,
  patched: 0,
  wouldPatch: 0,
  skipped: 0,
  errors: [],
  durationMs: 0,
});
vi.mock('../auto-resolve.service.js', () => ({
  DefenderAutoResolveService: class {
    runAutoResolvePass = mockAutoResolveRun;
  },
}));

// The agent-kill reconciliation reads SQLite; stub it and record the call order.
const mockAgentKill = vi.fn(async () => ({ candidates: 0, reconciled: 0, vendorsAdded: 0, errors: [] as string[] }));
vi.mock('../../edr/agent-kill-reconcile.service.js', () => ({
  runAgentKillReconciliation: () => mockAgentKill(),
  failedAgentKillPass: (err: unknown) => ({ candidates: 0, reconciled: 0, vendorsAdded: 0, errors: [err instanceof Error ? err.message : String(err)] }),
}));

// The launch-block reconciliation (exit 260 + EDR prevention alert); stub it and record the call order.
const mockLaunchBlock = vi.fn(async () => ({ evidenceAlerts: 0, candidates: 0, resolved: 0, errors: [] as string[] }));
vi.mock('../../edr/launch-block-reconcile.service.js', () => ({
  runLaunchBlockReconciliation: () => mockLaunchBlock(),
  failedLaunchBlockPass: (err: unknown) => ({ evidenceAlerts: 0, candidates: 0, resolved: 0, errors: [err instanceof Error ? err.message : String(err)] }),
}));

const { DefenderSyncService } = await import('../sync.service.js');
const { ensureDefenderIndex } = await import('../index-management.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('DefenderSyncService', () => {
  let service: InstanceType<typeof DefenderSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DefenderSyncService();
    mockGetDefenderSyncTimestamps.mockReturnValue({});

    // Default: no errors in bulk responses
    mockBulk.mockResolvedValue({ errors: false, items: [] });
    mockDeleteByQuery.mockResolvedValue({ deleted: 0 });
  });

  // ── syncSecureScores ───────────────────────────────────────────

  describe('syncSecureScores', () => {
    it('syncs scores to ES', async () => {
      mockGetSecureScores.mockResolvedValue([
        {
          id: 'score-1',
          azureTenantId: 'test-tenant-id',
          createdDateTime: '2026-02-27T10:00:00Z',
          currentScore: 42.5,
          maxScore: 100,
          averageComparativeScores: [{ basis: 'TotalScore', averageScore: 50 }],
          controlScores: [
            { controlName: 'MFARegistrationV2', controlCategory: 'Identity', score: 10, maxScore: 10 },
          ],
        },
      ]);

      const result = await service.syncSecureScores();
      expect(result.synced).toBe(1);
      expect(result.errors).toHaveLength(0);

      expect(mockBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({ index: { _index: 'achilles-defender', _id: 'score-2026-02-27' } }),
          ]),
        }),
      );
    });

    it('returns empty result when no scores', async () => {
      mockGetSecureScores.mockResolvedValue([]);

      const result = await service.syncSecureScores();
      expect(result.synced).toBe(0);
      expect(mockBulk).not.toHaveBeenCalled();
    });

    it('reports Graph API errors', async () => {
      mockGetSecureScores.mockRejectedValue(new Error('Graph API down'));

      const result = await service.syncSecureScores();
      expect(result.synced).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Graph API down');
    });
  });

  // ── syncControlProfiles ────────────────────────────────────────

  describe('syncControlProfiles', () => {
    it('deletes old profiles then re-indexes', async () => {
      mockGetControlProfiles.mockResolvedValue([
        {
          id: 'AdminMFAV2',
          controlCategory: 'Identity',
          title: 'Require MFA for admin roles',
          implementationCost: 'Low',
          userImpact: 'Low',
          rank: 1,
          threats: ['Account breach'],
          remediation: 'Enable MFA for admins',
          remediationImpact: 'Reduced risk',
          actionUrl: 'https://example.com',
          maxScore: 10,
          tier: 'Core',
          deprecated: false,
        },
      ]);

      const result = await service.syncControlProfiles();
      expect(result.synced).toBe(1);
      expect(mockDeleteByQuery).toHaveBeenCalled();
      expect(mockBulk).toHaveBeenCalled();
    });
  });

  // ── syncAlerts ─────────────────────────────────────────────────

  describe('syncAlerts', () => {
    it('writes a full 90-day re-sync in bulk batches of 500 alerts', async () => {
      mockGetAlerts.mockResolvedValue(Array.from({ length: 1200 }, (_, i) => ({
        id: `a-${i}`, title: 't', description: '', severity: 'low', status: 'new', category: '',
        serviceSource: '', createdDateTime: '2026-11-01T00:00:00Z', lastUpdateDateTime: '2026-11-01T00:00:00Z',
        mitreTechniques: [], recommendedActions: '', evidence: [],
      })));
      mockBulk.mockImplementation(async ({ operations }: { operations: unknown[] }) => ({ errors: false, items: operations.filter((_, i) => i % 2 === 0).map(() => ({ update: {} })) }));

      const result = await service.syncAlerts();

      expect(mockBulk.mock.calls.map((c) => c[0].operations.length / 2)).toEqual([500, 500, 200]);
      expect(result.synced).toBe(1200);
      expect(mockGetAlerts.mock.calls[0]).toHaveLength(1); // no $top cap
    });

    it('syncs alerts to ES', async () => {
      mockGetAlerts.mockResolvedValue([
        {
          id: 'alert-123',
          title: 'Suspicious login',
          description: 'Unusual login activity detected',
          severity: 'high',
          status: 'new',
          category: 'InitialAccess',
          serviceSource: 'microsoftDefenderForIdentity',
          createdDateTime: '2026-02-27T12:00:00Z',
          lastUpdateDateTime: '2026-02-27T12:05:00Z',
          mitreTechniques: ['T1078'],
          recommendedActions: 'Review the sign-in',
          evidence: [],
        },
      ]);

      const result = await service.syncAlerts();
      expect(result.synced).toBe(1);

      // Use `update` with `doc_as_upsert:true` so f0rtika.* annotations from
      // the enrichment + auto-resolve passes survive subsequent re-syncs.
      // See sync.service.ts for the rationale (a plain `index` op replaces the
      // whole doc and would wipe correlation flags whenever Defender re-emits
      // the alert).
      const operations = mockBulk.mock.calls[0][0].operations;
      expect(operations[0]).toMatchObject({
        update: { _id: 'alert-alert-123', retry_on_conflict: 3 },
      });
      expect(operations[1]).toMatchObject({ doc_as_upsert: true });
      expect(operations[1].doc).toMatchObject({ alert_id: 'alert-123' });
    });

    it('extracts evidence_filepaths from fileDetails, imageFile, and the parent process (alerts_v2 parentProcessImageFile)', async () => {
      // Issue #2 / Option B: capture file paths so AV-only alerts (whose
      // evidence carries only a dropped-file path under a bundle-named
      // sandbox dir) become correlatable via path-substring matching.
      mockGetAlerts.mockResolvedValue([
        {
          id: 'alert-paths',
          title: 'EICAR file detected',
          description: '',
          severity: 'informational',
          status: 'resolved',
          category: 'Malware',
          serviceSource: 'microsoftDefenderForEndpoint',
          createdDateTime: '2026-05-03T19:01:05Z',
          lastUpdateDateTime: '2026-05-03T19:12:15Z',
          mitreTechniques: [],
          recommendedActions: '',
          evidence: [
            { fileDetails: { fileName: 'EICAR.txt', filePath: 'C:\\Users\\fortika-test\\BlueHammerSandbox' } },
            { imageFile: { fileName: 'orchestrator.exe', filePath: 'C:\\F0\\tasks\\task-abc-1\\orchestrator.exe' } },
            { parentProcess: { imageFile: { fileName: 'achilles-agent.exe', filePath: 'C:\\Program Files\\F0rtika\\achilles-agent.exe' } } },
            // The shape alerts_v2 actually sends (live, Nov 2026).
            { imageFile: { fileName: 'cmd.exe', filePath: 'C:\\Windows\\System32\\cmd.exe' }, parentProcessImageFile: { fileName: 'b1-t1021.002.exe', filePath: 'C:\\F0\\b1-t1021.002.exe' } },
          ],
        },
      ]);

      await service.syncAlerts();
      // operations[1] is now `{ doc: <alertDoc>, doc_as_upsert: true }`,
      // not the doc directly — see the syncAlerts test above for the rationale.
      const doc = mockBulk.mock.calls[0][0].operations[1].doc;
      expect(doc.evidence_filepaths).toEqual(expect.arrayContaining([
        'c:\\users\\fortika-test\\bluehammersandbox',
        'c:\\f0\\tasks\\task-abc-1\\orchestrator.exe',
        'c:\\program files\\f0rtika\\achilles-agent.exe',
        'c:\\f0\\b1-t1021.002.exe',
      ]));
      expect(doc.evidence_filenames).toEqual(expect.arrayContaining(['achilles-agent.exe', 'cmd.exe', 'b1-t1021.002.exe']));
    });

    // Regression: the auto-resolve pillar depends on f0rtika.achilles_correlated
    // and f0rtika.auto_resolved* surviving across alert syncs. Defender re-emits
    // open alerts every time lastUpdateDateTime ticks (evidence enrichment, etc.),
    // and the previous `index`-based bulk op silently wiped the f0rtika subtree.
    // The fix is `update` + `doc_as_upsert:true`, which leaves top-level fields
    // not present in `doc` (i.e., f0rtika) untouched. This test pins that contract.
    it('uses update+doc_as_upsert so f0rtika annotations are not in the request body', async () => {
      mockGetAlerts.mockResolvedValue([
        {
          id: 'alert-1',
          title: 'Test',
          description: '',
          severity: 'low',
          status: 'new',
          category: 'Malware',
          serviceSource: 'microsoftDefenderForEndpoint',
          createdDateTime: '2026-05-04T12:00:00Z',
          lastUpdateDateTime: '2026-05-04T12:05:00Z',
          mitreTechniques: [],
          recommendedActions: '',
          evidence: [],
        },
      ]);

      await service.syncAlerts();

      const operations = mockBulk.mock.calls[0][0].operations;
      // Action line must be `update`, not `index` — `index` would replace the
      // whole doc and clobber f0rtika.* written by enrichment/auto-resolve.
      expect(operations[0].update).toBeDefined();
      expect(operations[0].index).toBeUndefined();

      // Body must use `doc_as_upsert:true` and must NOT carry an f0rtika field.
      // ES merges only the top-level keys present in `doc`; omitting f0rtika is
      // what guarantees the existing achilles_correlated / auto_resolved
      // receipts on the live doc survive this update.
      expect(operations[1].doc_as_upsert).toBe(true);
      expect(operations[1].doc.f0rtika).toBeUndefined();
    });

    it('uses incremental filter on second sync', async () => {
      mockGetAlerts.mockResolvedValue([]);

      // First sync — 90-day lookback filter (no persisted lastAlertSync)
      await service.syncAlerts();
      const lookback = Date.parse(mockGetAlerts.mock.calls[0][0].replace('lastUpdateDateTime ge ', ''));
      expect(Math.abs(lookback - (Date.now() - 90 * 86400_000))).toBeLessThan(60_000);

      // Second sync — from the checkpoint the first one recorded (incremental)
      const checkpoint = service.getSyncStatus().lastAlertSync;
      mockGetAlerts.mockClear();
      await service.syncAlerts();
      expect(mockGetAlerts).toHaveBeenCalledWith(`lastUpdateDateTime ge ${checkpoint}`);
    });

    // An alert opened more than 90 days ago that Defender still adds evidence
    // to is in the window by its update time, not by its creation time.
    it('the full re-sync selects alerts by update time over the look-back', async () => {
      mockGetAlerts.mockResolvedValue([]);

      await service.syncAlerts();

      expect(mockGetAlerts.mock.calls[0][0]).toMatch(/^lastUpdateDateTime ge /);
      expect(mockGetAlerts.mock.calls[0][0]).not.toContain('createdDateTime');
    });

    it('sync_version 3 (pre-prevention fields) forces a full re-sync', async () => {
      // ALERT_SYNC_VERSION=4 added prevention_action / remediation_status /
      // portal_url — existing deployments must re-fetch the full window once
      // so alert docs gain the new fields.
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
        expect.stringMatching(/^lastUpdateDateTime ge /),
      );
      expect(mockGetAlerts).not.toHaveBeenCalledWith('lastUpdateDateTime ge 2026-09-01T00:00:00Z');
    });
  });

  // ── Evidence items with their times (sync v9) ──────────────────

  describe('evidence items (sync v9)', () => {
    const alertWithEvidence = (evidence: Array<Record<string, unknown>>) => ({
      id: 'alert-items',
      title: 'Items test',
      description: '',
      severity: 'high',
      status: 'new',
      category: 'Execution',
      serviceSource: 'microsoftDefenderForEndpoint',
      createdDateTime: '2026-11-25T00:49:14Z',
      lastUpdateDateTime: '2026-11-25T01:00:30Z',
      mitreTechniques: [],
      recommendedActions: '',
      evidence,
    });

    const syncOneAndGetDoc = async (alert: Record<string, unknown>) => {
      mockGetAlerts.mockResolvedValue([alert]);
      await service.syncAlerts();
      return mockBulk.mock.calls[0][0].operations[1].doc;
    };

    const processEv = {
      '@odata.type': '#microsoft.graph.security.processEvidence',
      verdict: 'malicious',
      remediationStatus: 'blocked',
      imageFile: { fileName: 'A1B2-T1059.exe', filePath: 'C:\\F0\\A1B2-T1059.exe' },
      parentProcessImageFile: { fileName: 'A1B2.exe', filePath: 'C:\\F0\\A1B2.exe' },
      processCreationDateTime: '2026-11-25T00:47:49.830Z',
      createdDateTime: '2026-11-25T00:49:14.250Z',
    };
    const fileEv = {
      '@odata.type': '#microsoft.graph.security.fileEvidence',
      verdict: 'malicious',
      remediationStatus: 'prevented',
      fileDetails: { fileName: 'A1B2-T1204.exe', filePath: 'C:\\F0' },
      createdDateTime: '2026-11-25T01:00:18.570Z',
    };
    const fileItem = (n: number) => ({
      '@odata.type': '#microsoft.graph.security.fileEvidence',
      verdict: 'suspicious',
      remediationStatus: 'active',
      fileDetails: { fileName: `file-${n}.exe`, filePath: 'C:\\F0' },
      createdDateTime: '2026-11-25T01:00:00Z',
    });

    it('keeps each file-naming evidence item with its times', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        processEv,
        fileEv,
        { '@odata.type': '#microsoft.graph.security.deviceEvidence', verdict: 'malicious', remediationStatus: 'blocked', deviceDnsName: 'win-host-01', createdDateTime: '2026-11-25T00:49:14.250Z' },
      ]));

      expect(doc.evidence_items).toEqual([
        {
          file: 'a1b2-t1059.exe',
          path: 'c:\\f0\\a1b2-t1059.exe',
          parent: 'a1b2.exe',
          parent_path: 'c:\\f0\\a1b2.exe',
          kind: 'process',
          verdict: 'malicious',
          action: 'process_killed',
          started_at: '2026-11-25T00:47:49.830Z',
          added_at: '2026-11-25T00:49:14.250Z',
        },
        {
          file: 'a1b2-t1204.exe',
          path: 'c:\\f0',
          parent: null,
          parent_path: null,
          kind: 'file',
          verdict: 'malicious',
          action: 'blocked',
          started_at: null,
          added_at: '2026-11-25T01:00:18.570Z',
        },
      ]);
      // The alert-wide fields are what they were before v9.
      expect(doc.evidence_filenames).toEqual(['a1b2-t1059.exe', 'a1b2.exe', 'a1b2-t1204.exe']);
      expect(doc.evidence_filepaths).toEqual(['c:\\f0\\a1b2-t1059.exe', 'c:\\f0\\a1b2.exe', 'c:\\f0']);
      expect(doc.evidence_file_verdicts).toEqual([
        { file: 'a1b2-t1059.exe', verdict: 'malicious', action: 'process_killed' },
        { file: 'a1b2-t1204.exe', verdict: 'malicious', action: 'blocked' },
      ]);
      expect(doc.evidence_child_actions).toEqual([{ parent: 'a1b2.exe', action: 'process_killed' }]);
    });

    it('an item without a verdict or a prevention status stores null for both', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        { '@odata.type': '#microsoft.graph.security.processEvidence', remediationStatus: 'active', imageFile: { fileName: 'cmd.exe' }, createdDateTime: '2026-11-25T00:49:14.250Z' },
      ]));
      expect(doc.evidence_items).toEqual([{
        file: 'cmd.exe', path: null, parent: null, parent_path: null, kind: 'process',
        verdict: null, action: null, started_at: null, added_at: '2026-11-25T00:49:14.250Z',
      }]);
    });

    it('evidence without a file name (device, ip, azureResource) adds no item', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        { '@odata.type': '#microsoft.graph.security.deviceEvidence', verdict: 'malicious', remediationStatus: 'active', deviceDnsName: 'win-host-01', createdDateTime: '2026-11-25T00:49:14Z' },
        { '@odata.type': '#microsoft.graph.security.ipEvidence', verdict: 'unknown', remediationStatus: 'none', ipAddress: '192.0.2.10', createdDateTime: '2026-11-25T00:49:14Z' },
        { '@odata.type': '#microsoft.graph.security.azureResourceEvidence', verdict: 'unknown', remediationStatus: 'none', resourceName: 'vm-01', createdDateTime: '2026-11-25T00:49:14Z' },
        fileEv,
      ]));
      expect(doc.evidence_items.map((i: { file: string }) => i.file)).toEqual(['a1b2-t1204.exe']);
    });

    // The write is a partial update: an absent key would keep the value an
    // earlier sync stored.
    it('an alert with no file-naming evidence writes evidence_items: [] (not an absent field)', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        { '@odata.type': '#microsoft.graph.security.deviceEvidence', verdict: 'malicious', remediationStatus: 'active', deviceDnsName: 'win-host-01', createdDateTime: '2026-11-25T00:49:14Z' },
      ]));
      expect(doc).toHaveProperty('evidence_items');
      expect(doc.evidence_items).toEqual([]);

      mockBulk.mockClear();
      const empty = await syncOneAndGetDoc(alertWithEvidence([]));
      expect(empty.evidence_items).toEqual([]);
    });

    it('1,000 file-naming items are kept', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence(Array.from({ length: 1000 }, (_, n) => fileItem(n))));
      expect(doc.evidence_items).toHaveLength(1000);
    });

    it('1,001 file-naming items store evidence_items: null with one warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const doc = await syncOneAndGetDoc(alertWithEvidence(Array.from({ length: 1001 }, (_, n) => fileItem(n))));
        expect(doc).toHaveProperty('evidence_items', null);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('alert-items');
        // The alert-wide fields are still written.
        expect(doc.evidence_filenames).toHaveLength(1001);
      } finally {
        warn.mockRestore();
      }
    });

    it('a file-naming item without createdDateTime stores evidence_items: null', async () => {
      const { createdDateTime: _omit, ...noTime } = fileEv;
      const doc = await syncOneAndGetDoc(alertWithEvidence([processEv, noTime]));
      expect(doc).toHaveProperty('evidence_items', null);
      expect(doc.evidence_file_verdicts).toHaveLength(2);
    });

    it('a file-naming item whose createdDateTime does not parse stores evidence_items: null, as one with none', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([processEv, { ...fileEv, createdDateTime: 'not-a-date' }]));
      expect(doc).toHaveProperty('evidence_items', null);
      // The alert-wide fields are still written.
      expect(doc.evidence_file_verdicts).toHaveLength(2);
    });

    // A process item with no usable start is judged by when Defender added it
    // (edr/runEvidence.ts), so it is kept with started_at: null.
    it.each([
      ['empty', ''],
      ['not a date', 'not-a-date'],
      ['Defender\'s placeholder', '0001-01-01T00:00:00Z'],
      ['before 2000-01-01', '1999-12-31T23:59:59Z'],
    ])('a process item whose processCreationDateTime is %s is kept with started_at: null', async (_label, started) => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([{ ...processEv, processCreationDateTime: started }]));
      expect(doc.evidence_items).toHaveLength(1);
      expect(doc.evidence_items[0]).toMatchObject({ file: 'a1b2-t1059.exe', kind: 'process', started_at: null, added_at: '2026-11-25T00:49:14.250Z' });
    });

    it('a process item started at 2000-01-01T00:00:00Z keeps its start', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([{ ...processEv, processCreationDateTime: '2000-01-01T00:00:00Z' }]));
      expect(doc.evidence_items[0].started_at).toBe('2000-01-01T00:00:00Z');
    });

    it('evidence without a file name needs no createdDateTime', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        processEv,
        { '@odata.type': '#microsoft.graph.security.deviceEvidence', verdict: 'malicious', remediationStatus: 'active', deviceDnsName: 'win-host-01' },
      ]));
      expect(doc.evidence_items).toHaveLength(1);
    });
  });

  // ── evidenceItemsReady (the v9 re-sync has completed) ──────────

  describe('evidenceItemsReady', () => {
    const lastSaved = () => mockSaveDefenderSyncTimestamps.mock.calls.at(-1)?.[0];
    const restartWith = (persisted: Record<string, unknown>) => {
      mockGetDefenderSyncTimestamps.mockReturnValue(persisted);
      return new DefenderSyncService();
    };

    it('false after a version mismatch (state from before v9)', () => {
      const svc = restartWith({ last_alert_sync: '2026-11-20T00:00:00Z', last_score_sync: '2026-11-20T00:00:00Z', sync_version: 8 });
      expect(svc.evidenceItemsReady()).toBe(false);
    });

    it('false when a score sync persisted sync_version 9 before any alert sync, and a restart still re-syncs', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      await service.syncSecureScores();

      expect(lastSaved()).toMatchObject({ sync_version: 9 });
      expect(lastSaved()).not.toHaveProperty('evidence_items_version');
      expect(service.evidenceItemsReady()).toBe(false);

      const restarted = restartWith({ ...lastSaved(), last_alert_sync: '2026-11-24T00:00:00Z' });
      expect(restarted.evidenceItemsReady()).toBe(false);
      mockGetAlerts.mockResolvedValue([]);
      await restarted.syncAlerts();
      expect(mockGetAlerts.mock.calls[0][0]).not.toBe('lastUpdateDateTime ge 2026-11-24T00:00:00Z');
    });

    it('true after a full look-back alert sync completes without error, and persisted as evidence_items_version 9', async () => {
      mockGetAlerts.mockResolvedValue([]);
      await service.syncAlerts();

      expect(service.evidenceItemsReady()).toBe(true);
      expect(lastSaved()).toMatchObject({ sync_version: 9, evidence_items_version: 9 });
    });

    it('kept on later saves (a score sync after the alert sync)', async () => {
      mockGetAlerts.mockResolvedValue([]);
      mockGetSecureScores.mockResolvedValue([]);
      await service.syncAlerts();
      await service.syncSecureScores();

      expect(lastSaved()).toMatchObject({ evidence_items_version: 9 });
      expect(service.evidenceItemsReady()).toBe(true);
    });

    const writeError = () => ({ errors: true, items: [{ update: { _id: 'alert-a-1', error: { reason: 'mapper_parsing_exception' } } }] });
    const fullFilter = /^lastUpdateDateTime ge /;

    it('a full look-back with a write error holds the checkpoint, so the next sync is a full look-back again; clean, it makes it true', async () => {
      mockGetAlerts.mockResolvedValue([alertWithId('a-1')]);
      mockBulk.mockResolvedValueOnce(writeError());
      const first = await service.syncAlerts();
      expect(first.errors).toHaveLength(1);
      expect(service.evidenceItemsReady()).toBe(false);
      expect(service.getSyncStatus().lastAlertSync).toBeNull();
      expect(mockSaveDefenderSyncTimestamps).not.toHaveBeenCalled();

      mockBulk.mockResolvedValueOnce({ errors: false, items: [{ update: { result: 'updated' } }] });
      const second = await service.syncAlerts();
      expect(second.errors).toHaveLength(0);
      expect(mockGetAlerts).toHaveBeenCalledTimes(2);
      const lookback = Date.parse(mockGetAlerts.mock.calls[1][0].replace('lastUpdateDateTime ge ', ''));
      expect(Math.abs(lookback - (Date.now() - 90 * 86400_000))).toBeLessThan(60_000);
      expect(service.evidenceItemsReady()).toBe(true);
      expect(service.getSyncStatus().lastAlertSync).not.toBeNull();
      expect(lastSaved()).toMatchObject({ evidence_items_version: 9 });
    });

    it('three full look-backs in a row with write errors: the checkpoint moves, one warning, the fourth sync is incremental and it stays false', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockGetAlerts.mockResolvedValue([alertWithId('a-1')]);
        mockBulk.mockResolvedValue(writeError());
        for (let i = 0; i < 3; i++) await service.syncAlerts();
        for (let i = 0; i < 3; i++) {
          const lookback = Date.parse(mockGetAlerts.mock.calls[i][0].replace('lastUpdateDateTime ge ', ''));
          expect(Math.abs(lookback - (Date.now() - 90 * 86400_000))).toBeLessThan(60_000);
        }
        const checkpoint = service.getSyncStatus().lastAlertSync;
        expect(checkpoint).not.toBeNull();
        expect(lastSaved()).toMatchObject({ last_alert_sync: checkpoint });
        expect(lastSaved()).not.toHaveProperty('evidence_items_version');

        mockBulk.mockResolvedValue({ errors: false, items: [{ update: { result: 'updated' } }] });
        await service.syncAlerts();
        expect(mockGetAlerts.mock.calls[3][0]).toBe(`lastUpdateDateTime ge ${checkpoint}`);
        expect(service.evidenceItemsReady()).toBe(false);

        const resync = warn.mock.calls.filter((c) => String(c[0]).includes('Full alert re-sync ended with errors'));
        expect(resync).toHaveLength(1);
        expect(String(resync[0][0])).toContain('3 times');
        expect(String(resync[0][0])).toContain('per-run crediting stays off until the next restart');
      } finally {
        warn.mockRestore();
      }
    });

    it('a clean full look-back resets the count of failed ones', async () => {
      mockGetAlerts.mockResolvedValue([alertWithId('a-1')]);
      mockBulk.mockResolvedValueOnce(writeError()).mockResolvedValueOnce(writeError());
      await service.syncAlerts();
      await service.syncAlerts();
      expect(service.getSyncStatus().lastAlertSync).toBeNull();
      await service.syncAlerts(); // clean
      expect(service.evidenceItemsReady()).toBe(true);
      expect(mockGetAlerts.mock.calls.map((c) => c[0])).toEqual([
        expect.stringMatching(fullFilter), expect.stringMatching(fullFilter), expect.stringMatching(fullFilter),
      ]);
    });

    it('an incremental sync with a write error still moves its checkpoint (unchanged)', async () => {
      const svc = restartWith({ last_alert_sync: '2026-11-24T00:00:00Z', sync_version: 9, evidence_items_version: 9 });
      mockGetAlerts.mockResolvedValue([alertWithId('a-1')]);
      mockBulk.mockResolvedValueOnce(writeError());
      const result = await svc.syncAlerts();

      expect(result.errors).toHaveLength(1);
      expect(mockGetAlerts).toHaveBeenCalledWith('lastUpdateDateTime ge 2026-11-24T00:00:00Z');
      const checkpoint = svc.getSyncStatus().lastAlertSync;
      expect(checkpoint).not.toBe('2026-11-24T00:00:00Z');
      expect(lastSaved()).toMatchObject({ last_alert_sync: checkpoint, evidence_items_version: 9 });
      expect(svc.evidenceItemsReady()).toBe(true);

      await svc.syncAlerts();
      expect(mockGetAlerts.mock.calls[1][0]).toBe(`lastUpdateDateTime ge ${checkpoint}`);
    });

    it('false when the full look-back alert fetch fails', async () => {
      mockGetAlerts.mockRejectedValueOnce(new Error('Graph API down'));
      await service.syncAlerts();
      expect(service.evidenceItemsReady()).toBe(false);
    });

    it('still true after a restart that loads evidence_items_version 9, which keeps the incremental checkpoint', async () => {
      const svc = restartWith({ last_alert_sync: '2026-11-24T00:00:00Z', sync_version: 9, evidence_items_version: 9 });
      expect(svc.evidenceItemsReady()).toBe(true);

      mockGetAlerts.mockResolvedValue([]);
      await svc.syncAlerts();
      expect(mockGetAlerts).toHaveBeenCalledWith('lastUpdateDateTime ge 2026-11-24T00:00:00Z');
      expect(svc.evidenceItemsReady()).toBe(true);
      expect(lastSaved()).toMatchObject({ evidence_items_version: 9 });
    });

    it('a mismatched evidence_items_version forces the full re-sync (an interrupted first re-sync is repeated)', async () => {
      const svc = restartWith({ last_alert_sync: '2026-11-24T00:00:00Z', sync_version: 9 });
      mockGetAlerts.mockResolvedValue([]);
      await svc.syncAlerts();

      expect(mockGetAlerts.mock.calls[0][0]).toMatch(/^lastUpdateDateTime ge /);
      expect(mockGetAlerts).not.toHaveBeenCalledWith('lastUpdateDateTime ge 2026-11-24T00:00:00Z');
      expect(svc.evidenceItemsReady()).toBe(true);
    });

    function alertWithId(id: string) {
      return {
        id, title: 't', description: '', severity: 'low', status: 'new', category: '',
        serviceSource: '', createdDateTime: '2026-11-01T00:00:00Z', lastUpdateDateTime: '2026-11-01T00:00:00Z',
        mitreTechniques: [], recommendedActions: '', evidence: [],
      };
    }
  });

  // ── Prevention disposition (remediationStatus → prevention_action) ──

  describe('prevention disposition', () => {
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
      // Device evidence says remediated, but the file evidence (the process
      // actually blocked) says prevented — file evidence wins.
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

    it('records Defender\'s own verdict and action per evidence file (file + process evidence merged)', async () => {
      // Live shape (Nov 2026): one antivirus alert, two test files; Defender
      // blocked one and only detected the other.
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        { '@odata.type': '#microsoft.graph.security.fileEvidence', verdict: 'malicious', remediationStatus: 'active', fileDetails: { fileName: 'A-T1518.001.exe', filePath: 'C:\\F0' } },
        { '@odata.type': '#microsoft.graph.security.processEvidence', verdict: 'malicious', remediationStatus: 'blocked', imageFile: { fileName: 'A-T1518.001.exe', filePath: 'C:\\F0\\A-T1518.001.exe' } },
        { '@odata.type': '#microsoft.graph.security.fileEvidence', verdict: 'malicious', remediationStatus: 'active', fileDetails: { fileName: 'B-T1572.exe', filePath: 'C:\\F0' } },
        { '@odata.type': '#microsoft.graph.security.processEvidence', verdict: 'suspicious', remediationStatus: 'active', imageFile: { fileName: 'powershell.exe' }, parentProcess: { imageFile: { fileName: 'A.exe' } } },
        deviceEvidence('active'),
      ]));
      expect(doc.evidence_file_verdicts).toEqual([
        { file: 'a-t1518.001.exe', verdict: 'malicious', action: 'process_killed' },
        { file: 'b-t1572.exe', verdict: 'malicious', action: null },
        { file: 'powershell.exe', verdict: 'suspicious', action: null },
      ]);
      // The alert-wide action stays as before.
      expect(doc.prevention_action).toBe('process_killed');
    });

    it('keeps a blocked child process\'s action under its parent file (alerts_v2 parentProcessImageFile)', async () => {
      // Live alerts_v2 processEvidence keys (Nov 2026): imageFile,
      // parentProcessImageFile, processCreationDateTime, ... (no parentProcess).
      const doc = await syncOneAndGetDoc(alertWithEvidence([
        { '@odata.type': '#microsoft.graph.security.processEvidence', verdict: 'malicious', remediationStatus: 'blocked', imageFile: { fileName: 'cmd.exe', filePath: 'C:\\Windows\\System32\\cmd.exe' }, parentProcessImageFile: { fileName: 'A-T1003.exe', filePath: 'C:\\F0\\A-T1003.exe' }, processCreationDateTime: '2026-11-04T12:48:12Z' },
        { '@odata.type': '#microsoft.graph.security.processEvidence', verdict: 'malicious', remediationStatus: 'active', imageFile: { fileName: 'A-T1003.exe' }, parentProcessImageFile: { fileName: 'A.exe', filePath: null } },
        { '@odata.type': '#microsoft.graph.security.fileEvidence', verdict: 'malicious', remediationStatus: 'prevented', fileDetails: { fileName: 'A-T1204.exe', filePath: 'C:\\F0' } },
      ]));
      // The parent's file is evidence too: the alert fired on cmd.exe, only
      // the parent names the test (same lineage rule as the other EDRs).
      expect(doc.evidence_filenames).toEqual(['cmd.exe', 'a-t1003.exe', 'a.exe', 'a-t1204.exe']);
      expect(doc.evidence_filepaths).toEqual(expect.arrayContaining(['c:\\f0\\a-t1003.exe']));
      // The kill of cmd.exe belongs to the file that started it; a file
      // evidence block has no parent.
      expect(doc.evidence_child_actions).toEqual([{ parent: 'a-t1003.exe', action: 'process_killed' }]);
    });

    it('always writes evidence_child_actions (empty when nothing was blocked) and the alert\'s activity window', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([fileEvidence('active')], {
        firstActivityDateTime: '2026-11-04T12:48:12.7541221Z',
        lastActivityDateTime: '2026-11-04T12:55:36.5542455Z',
      }));
      expect(doc.evidence_child_actions).toEqual([]);
      expect(doc.first_activity_at).toBe('2026-11-04T12:48:12.7541221Z');
      expect(doc.last_activity_at).toBe('2026-11-04T12:55:36.5542455Z');
    });

    it('an alert without activity times stores null (the time gate then uses created_at)', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([fileEvidence('active')]));
      expect(doc.first_activity_at).toBeNull();
      expect(doc.last_activity_at).toBeNull();
    });

    it('captures alertWebUrl as portal_url', async () => {
      const doc = await syncOneAndGetDoc(alertWithEvidence([], {
        alertWebUrl: 'https://security.microsoft.com/alerts/alert-prev?tid=abc',
      }));
      expect(doc.portal_url).toBe('https://security.microsoft.com/alerts/alert-prev?tid=abc');
    });
  });

  // ── syncAll ────────────────────────────────────────────────────

  describe('syncAll', () => {
    it('syncAll runs the reconciliation after enrichment', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);
      mockAgentKill.mockResolvedValueOnce({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });
      const enrichment = vi.spyOn(service, 'runEnrichmentPass');
      const autoResolve = vi.spyOn(service, 'runAutoResolvePass');

      const result = await service.syncAll();

      expect(mockAgentKill).toHaveBeenCalledTimes(1);
      expect(enrichment.mock.invocationCallOrder[0]).toBeLessThan(mockAgentKill.mock.invocationCallOrder[0]);
      expect(mockAgentKill.mock.invocationCallOrder[0]).toBeLessThan(autoResolve.mock.invocationCallOrder[0]);
      expect(result.agentKill).toEqual({ candidates: 1, reconciled: 1, vendorsAdded: 0, errors: [] });
    });

    it('syncAll runs the launch-block reconciliation after the agent-kill pass, before auto-resolve', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);
      mockLaunchBlock.mockResolvedValueOnce({ evidenceAlerts: 1, candidates: 1, resolved: 1, errors: [] });
      const autoResolve = vi.spyOn(service, 'runAutoResolvePass');

      const result = await service.syncAll();

      expect(mockAgentKill.mock.invocationCallOrder[0]).toBeLessThan(mockLaunchBlock.mock.invocationCallOrder[0]);
      expect(mockLaunchBlock.mock.invocationCallOrder[0]).toBeLessThan(autoResolve.mock.invocationCallOrder[0]);
      expect(result.launchBlock).toEqual({ evidenceAlerts: 1, candidates: 1, resolved: 1, errors: [] });
    });

    it('a rejecting launch-block reconciliation never fails the sync', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);
      mockLaunchBlock.mockRejectedValueOnce(new Error('boom'));

      const result = await service.syncAll();

      expect(result.launchBlock?.errors).toEqual(['boom']);
      expect(result.autoResolve).toBeDefined();
    });

    it('a rejecting reconciliation never fails the sync', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);
      mockAgentKill.mockRejectedValueOnce(new Error('boom'));

      const result = await service.syncAll();

      expect(result.agentKill?.errors).toEqual(['boom']);
      expect(result.autoResolve).toBeDefined();
    });

    it('runs all three syncs, enrichment, and auto-resolve passes', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);

      const result = await service.syncAll();

      expect(result.scores).toBeDefined();
      expect(result.controls).toBeDefined();
      expect(result.alerts).toBeDefined();
      expect(result.enrichment).toBeDefined();
      expect(result.enrichment.scanned).toBe(0);
      expect(result.enrichment.detected).toBe(0);
      expect(result.autoResolve).toBeDefined();
      expect(result.autoResolve.mode).toBe('disabled');
      expect(result.timestamp).toBeDefined();
    });
  });

  // ── runEnrichmentPass (public — docker 5-min cadence) ──────────

  describe('runEnrichmentPass', () => {
    it('is callable independently of syncAll and returns a zero result when no eligible docs', async () => {
      // Server.ts invokes this on every 5-min alert interval so correlation
      // isn't frozen between container boots. Guard against regressions that
      // would re-privatize it.
      const result = await service.runEnrichmentPass();

      expect(result).toMatchObject({
        scanned: expect.any(Number),
        detected: expect.any(Number),
        skipped: expect.any(Number),
        batches: expect.any(Number),
        alertsMarkedCorrelated: expect.any(Number),
        errors: expect.any(Array),
        durationMs: expect.any(Number),
      });
    });

    it('logs how many flags the run-evidence re-check removed', async () => {
      mockEnrichmentResult = {
        scanned: 9, detected: 1, stageDetected: 1, skipped: 0, batches: 1, alertsMarkedCorrelated: 0,
        stageDetectionsRemoved: 2, detectionsRemoved: 3, preventionsRemoved: 4, removedFlagDocs: [], errors: [], durationMs: 5,
      };
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await service.runEnrichmentPass();
        const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[Defender-Enrichment]'));
        expect(line).toContain('stageDetectionsRemoved=2');
        expect(line).toContain('detectionsRemoved=3');
        expect(line).toContain('preventionsRemoved=4');
      } finally {
        log.mockRestore();
        mockEnrichmentResult = undefined;
      }
    });

    describe('the results the run-evidence re-check removed flags on', () => {
      const pass = (over: Record<string, unknown>) => ({
        scanned: 9, detected: 0, stageDetected: 0, skipped: 0, batches: 1, alertsMarkedCorrelated: 0,
        stageDetectionsRemoved: 0, detectionsRemoved: 0, preventionsRemoved: 0, removedFlagDocs: [], errors: [], durationMs: 5,
        ...over,
      });
      const linesOf = async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          await service.runEnrichmentPass();
          return log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[Defender]') || l.startsWith('[Defender-Enrichment]'));
        } finally {
          log.mockRestore();
          mockEnrichmentResult = undefined;
        }
      };

      it('logs one line naming them', async () => {
        mockEnrichmentResult = pass({ detectionsRemoved: 2, removedFlagDocs: ['t1::T1003', 't2'] });
        const lines = await linesOf();
        expect(lines).toContain('[Defender] Run-evidence re-check removed flags on: t1::T1003, t2');
      });

      it('says how many more were removed past the 20 listed', async () => {
        const ids = Array.from({ length: 20 }, (_, n) => `t${n + 1}`);
        mockEnrichmentResult = pass({ detectionsRemoved: 23, removedFlagDocs: ids, removedFlagDocsOmitted: 3 });
        const lines = await linesOf();
        expect(lines).toContain(`[Defender] Run-evidence re-check removed flags on: ${ids.join(', ')} (+3 more)`);
      });

      it('logs no such line when none were removed', async () => {
        mockEnrichmentResult = pass({});
        const lines = await linesOf();
        expect(lines.some((l) => l.includes('Run-evidence re-check'))).toBe(false);
        expect(lines.some((l) => l.startsWith('[Defender-Enrichment]'))).toBe(true);
      });
    });

    it('credits by run only once the v9 evidence-items re-sync has completed', async () => {
      mockEnrichmentCtor.mockClear();
      expect(service.evidenceItemsReady()).toBe(false);
      await service.runEnrichmentPass();
      expect(mockEnrichmentCtor.mock.calls.at(-1)?.[2]).toEqual({ runScopedEvidence: false });

      mockGetAlerts.mockResolvedValue([]);
      await service.syncAlerts();
      expect(service.evidenceItemsReady()).toBe(true);
      await service.runEnrichmentPass();
      expect(mockEnrichmentCtor.mock.calls.at(-1)?.[2]).toEqual({ runScopedEvidence: true });
    });
  });

  // ── runAutoResolvePass (Wave 5 — public, called from server.ts) ──

  describe('runAutoResolvePass', () => {
    beforeEach(() => {
      mockAutoResolveMode = 'disabled';
      mockAutoResolveRun.mockClear();
    });

    it("returns a 'disabled' result without instantiating the inner service when mode is disabled", async () => {
      mockAutoResolveMode = 'disabled';

      const result = await service.runAutoResolvePass();

      expect(result.mode).toBe('disabled');
      expect(result.candidates).toBe(0);
      // Inner service NOT invoked — the wrapper short-circuits before instantiation
      expect(mockAutoResolveRun).not.toHaveBeenCalled();
    });

    it('runs the inner service when mode is dry_run', async () => {
      mockAutoResolveMode = 'dry_run';
      mockAutoResolveRun.mockResolvedValueOnce({
        mode: 'dry_run', candidates: 2, patched: 0, wouldPatch: 2,
        skipped: 0, errors: [], durationMs: 5,
      });

      const result = await service.runAutoResolvePass();

      expect(mockAutoResolveRun).toHaveBeenCalledTimes(1);
      expect(result.mode).toBe('dry_run');
      expect(result.wouldPatch).toBe(2);
    });

    it('captures inner-service errors into the result rather than throwing', async () => {
      mockAutoResolveMode = 'enabled';
      mockAutoResolveRun.mockRejectedValueOnce(new Error('graph offline'));

      const result = await service.runAutoResolvePass();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('graph offline');
    });

    it('syncAll() invokes runAutoResolvePass — single call per sync cycle', async () => {
      mockAutoResolveMode = 'enabled';
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);

      await service.syncAll();

      expect(mockAutoResolveRun).toHaveBeenCalledTimes(1);
    });
  });

  // ── getSyncStatus ──────────────────────────────────────────────

  describe('getSyncStatus', () => {
    it('tracks sync timestamps', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);

      const statusBefore = service.getSyncStatus();
      expect(statusBefore.lastScoreSync).toBeNull();

      await service.syncSecureScores();

      const statusAfter = service.getSyncStatus();
      expect(statusAfter.lastScoreSync).not.toBeNull();
    });
  });

  // ── Setup failures (ES privileges, missing creds) ──────────────
  // Regression: an ES key without create_index made ensureDefenderIndex()
  // throw before the try block, so every sync rejected, the timers'
  // .catch(() => {}) swallowed it, and /sync/status stayed all-null for months.

  describe('setup failures', () => {
    const PRIV_ERROR = 'security_exception: action [indices:admin/create] is unauthorized for API key id [abc]';

    it('syncAlerts returns an index-setup failure as a result error instead of throwing', async () => {
      vi.mocked(ensureDefenderIndex).mockRejectedValueOnce(new Error(PRIV_ERROR));

      const result = await service.syncAlerts();

      expect(result.synced).toBe(0);
      expect(result.errors[0]).toContain('indices:admin/create');
      expect(mockGetAlerts).not.toHaveBeenCalled();
    });

    it('records lastError and lastAttemptAt for the failing stage', async () => {
      vi.mocked(ensureDefenderIndex).mockRejectedValueOnce(new Error(PRIV_ERROR));

      await service.syncAlerts();
      const status = service.getSyncStatus();

      expect(status.lastAttemptAt).not.toBeNull();
      expect(status.lastError).toMatchObject({ stage: 'alerts' });
      expect(status.lastError?.message).toContain('indices:admin/create');
      expect(status.lastAlertSync).toBeNull();
    });

    it('clears lastError once the same stage succeeds', async () => {
      vi.mocked(ensureDefenderIndex).mockRejectedValueOnce(new Error(PRIV_ERROR));
      await service.syncAlerts();
      expect(service.getSyncStatus().lastError).not.toBeNull();

      mockGetAlerts.mockResolvedValue([]);
      await service.syncAlerts();
      expect(service.getSyncStatus().lastError).toBeNull();
    });

    it('syncAll resolves and records lastSyncResult even when every stage fails setup', async () => {
      vi.mocked(ensureDefenderIndex).mockRejectedValue(new Error(PRIV_ERROR));

      const result = await service.syncAll();

      expect(result.scores.errors).toHaveLength(1);
      expect(result.controls.errors).toHaveLength(1);
      expect(result.alerts.errors).toHaveLength(1);
      expect(service.getSyncStatus().lastSyncResult).toEqual(result);

      vi.mocked(ensureDefenderIndex).mockResolvedValue(undefined);
    });
  });
});
