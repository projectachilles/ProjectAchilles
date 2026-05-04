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
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getDefenderCredentials = () => ({
      tenant_id: 'test-tenant-id',
      client_id: 'test-client-id',
      client_secret: 'test-secret',
    });
    isDefenderConfigured = () => true;
    getAutoResolveMode = () => mockAutoResolveMode;
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

// Mock enrichment service
vi.mock('../enrichment.service.js', () => ({
  DefenderEnrichmentService: class {
    async runEnrichmentPass() {
      return {
        scanned: 0,
        detected: 0,
        skipped: 0,
        batches: 0,
        alertsMarkedCorrelated: 0,
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

const { DefenderSyncService } = await import('../sync.service.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('DefenderSyncService', () => {
  let service: InstanceType<typeof DefenderSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DefenderSyncService();

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

    it('extracts evidence_filepaths from fileDetails, imageFile, and parentProcess', async () => {
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
      ]));
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
      expect(mockGetAlerts).toHaveBeenCalledWith(
        expect.stringContaining('createdDateTime ge'),
      );

      // Second sync — should include lastUpdateDateTime filter (incremental)
      mockGetAlerts.mockClear();
      await service.syncAlerts();
      expect(mockGetAlerts).toHaveBeenCalledWith(
        expect.stringContaining('lastUpdateDateTime ge'),
      );
    });
  });

  // ── syncAll ────────────────────────────────────────────────────

  describe('syncAll', () => {
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
});
