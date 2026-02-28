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

// Mock integrations settings
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    getDefenderCredentials = () => ({
      tenant_id: 'test-tenant-id',
      client_id: 'test-client-id',
      client_secret: 'test-secret',
    });
    isDefenderConfigured = () => true;
  },
}));

// Mock index management
vi.mock('../index-management.js', () => ({
  ensureDefenderIndex: vi.fn().mockResolvedValue(undefined),
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

      // Verify the _id uses alert- prefix
      const operations = mockBulk.mock.calls[0][0].operations;
      expect(operations[0]).toMatchObject({
        index: { _id: 'alert-alert-123' },
      });
    });

    it('uses incremental filter on second sync', async () => {
      mockGetAlerts.mockResolvedValue([]);

      // First sync — no filter
      await service.syncAlerts();
      expect(mockGetAlerts).toHaveBeenCalledWith(undefined);

      // Second sync — should include lastUpdateDateTime filter
      mockGetAlerts.mockClear();
      await service.syncAlerts();
      expect(mockGetAlerts).toHaveBeenCalledWith(
        expect.stringContaining('lastUpdateDateTime ge'),
      );
    });
  });

  // ── syncAll ────────────────────────────────────────────────────

  describe('syncAll', () => {
    it('runs all three syncs', async () => {
      mockGetSecureScores.mockResolvedValue([]);
      mockGetControlProfiles.mockResolvedValue([]);
      mockGetAlerts.mockResolvedValue([]);

      const result = await service.syncAll();

      expect(result.scores).toBeDefined();
      expect(result.controls).toBeDefined();
      expect(result.alerts).toBeDefined();
      expect(result.timestamp).toBeDefined();
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
