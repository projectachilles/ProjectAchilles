import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup ────────────────────────────────────────────────────
const mockIndex = vi.fn();
const mockGet = vi.fn();
const mockSearch = vi.fn();

// Must use function(){} (not arrow fn) for `new` compatibility
vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.index = mockIndex;
    this.get = mockGet;
    this.search = mockSearch;
    this.indices = {
      exists: vi.fn(),
      create: vi.fn(),
    };
  }),
}));

// Mock index-management so ensureRiskAcceptanceIndex doesn't hit ES
vi.mock('../index-management.js', () => ({
  RISK_ACCEPTANCE_INDEX: 'achilles-risk-acceptances',
  ensureRiskAcceptanceIndex: vi.fn().mockResolvedValue(undefined),
}));

const { Client } = await import('@elastic/elasticsearch');
const { RiskAcceptanceService } = await import('../risk-acceptance.service.js');

import type { RiskAcceptance } from '../risk-acceptance.service.js';

// ── Helpers ───────────────────────────────────────────────────────

function makeAcceptance(overrides?: Partial<RiskAcceptance>): RiskAcceptance {
  return {
    acceptance_id: 'acc-001',
    test_name: 'T1059-powershell',
    justification: 'Accepted for business reasons — compensating control in place.',
    accepted_by: 'user-123',
    accepted_by_name: 'Test User',
    accepted_at: '2026-02-15T10:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

function makeSearchResponse(docs: RiskAcceptance[], total?: number) {
  return {
    hits: {
      total: { value: total ?? docs.length, relation: 'eq' },
      hits: docs.map(doc => ({ _source: doc })),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('RiskAcceptanceService', () => {
  let service: InstanceType<typeof RiskAcceptanceService>;

  beforeEach(() => {
    vi.clearAllMocks();
    const client = new Client({ node: 'http://localhost:9200' });
    service = new RiskAcceptanceService(client);
  });

  // ── acceptRisk ──────────────────────────────────────────────────

  describe('acceptRisk()', () => {
    it('creates a document with correct fields and calls client.index', async () => {
      mockIndex.mockResolvedValue({ _id: 'generated-id', result: 'created' });

      const result = await service.acceptRisk({
        test_name: 'T1059-powershell',
        justification: 'Compensating control deployed.',
        accepted_by: 'user-123',
        accepted_by_name: 'Test User',
      });

      expect(result.test_name).toBe('T1059-powershell');
      expect(result.justification).toBe('Compensating control deployed.');
      expect(result.accepted_by).toBe('user-123');
      expect(result.accepted_by_name).toBe('Test User');
      expect(result.status).toBe('active');
      expect(result.acceptance_id).toBeDefined();
      expect(result.accepted_at).toBeDefined();

      expect(mockIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'achilles-risk-acceptances',
          id: result.acceptance_id,
          document: result,
          refresh: 'wait_for',
        }),
      );
    });

    it('stores optional control_id and hostname when provided', async () => {
      mockIndex.mockResolvedValue({ _id: 'generated-id', result: 'created' });

      const result = await service.acceptRisk({
        test_name: 'T1059-powershell',
        control_id: 'CH-DEF-001',
        hostname: 'workstation-01',
        justification: 'Compensating control deployed.',
        accepted_by: 'user-123',
        accepted_by_name: 'Test User',
      });

      expect(result.control_id).toBe('CH-DEF-001');
      expect(result.hostname).toBe('workstation-01');
    });

    it('omits control_id and hostname when not provided', async () => {
      mockIndex.mockResolvedValue({ _id: 'generated-id', result: 'created' });

      const result = await service.acceptRisk({
        test_name: 'T1059-powershell',
        justification: 'Compensating control deployed.',
        accepted_by: 'user-123',
        accepted_by_name: 'Test User',
      });

      expect(result.control_id).toBeUndefined();
      expect(result.hostname).toBeUndefined();
    });

    it('invalidates cache after accepting risk', async () => {
      mockIndex.mockResolvedValue({ result: 'created' });

      // Pre-populate cache by calling getActiveAcceptances
      mockSearch.mockResolvedValueOnce(makeSearchResponse([makeAcceptance()]));
      await service.getActiveAcceptances();

      // Accept a new risk — should invalidate cache
      await service.acceptRisk({
        test_name: 'T1059-new',
        justification: 'New acceptance after cache.',
        accepted_by: 'user-456',
        accepted_by_name: 'Another User',
      });

      // Next call to getActiveAcceptances should query ES again
      mockSearch.mockResolvedValueOnce(makeSearchResponse([]));
      await service.getActiveAcceptances();

      // mockSearch should have been called twice (initial populate + refresh after invalidation)
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });
  });

  // ── revokeRisk ──────────────────────────────────────────────────

  describe('revokeRisk()', () => {
    it('updates status to revoked with revocation fields', async () => {
      const existing = makeAcceptance({ status: 'active' });
      mockGet.mockResolvedValue({ _source: existing });
      mockIndex.mockResolvedValue({ result: 'updated' });

      const result = await service.revokeRisk('acc-001', {
        revoked_by: 'user-789',
        revoked_by_name: 'Admin User',
        revocation_reason: 'Compensating control removed — risk no longer accepted.',
      });

      expect(result.status).toBe('revoked');
      expect(result.revoked_by).toBe('user-789');
      expect(result.revoked_by_name).toBe('Admin User');
      expect(result.revocation_reason).toBe('Compensating control removed — risk no longer accepted.');
      expect(result.revoked_at).toBeDefined();

      expect(mockIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'achilles-risk-acceptances',
          id: 'acc-001',
          document: expect.objectContaining({ status: 'revoked' }),
          refresh: 'wait_for',
        }),
      );
    });

    it('throws if acceptance not found', async () => {
      const notFoundErr = new Error('Not found') as any;
      notFoundErr.statusCode = 404;
      mockGet.mockRejectedValue(notFoundErr);

      await expect(
        service.revokeRisk('nonexistent-id', {
          revoked_by: 'user-789',
          revoked_by_name: 'Admin',
          revocation_reason: 'Risk no longer relevant to operations.',
        }),
      ).rejects.toThrow('Risk acceptance not found: nonexistent-id');
    });

    it('throws if acceptance is already revoked', async () => {
      const revokedDoc = makeAcceptance({ status: 'revoked' });
      mockGet.mockResolvedValue({ _source: revokedDoc });

      await expect(
        service.revokeRisk('acc-001', {
          revoked_by: 'user-789',
          revoked_by_name: 'Admin',
          revocation_reason: 'Trying to revoke again for double-check.',
        }),
      ).rejects.toThrow('Risk acceptance already revoked: acc-001');
    });

    it('invalidates cache after revoking', async () => {
      const existing = makeAcceptance({ status: 'active' });
      mockGet.mockResolvedValue({ _source: existing });
      mockIndex.mockResolvedValue({ result: 'updated' });

      // Pre-populate cache
      mockSearch.mockResolvedValueOnce(makeSearchResponse([existing]));
      await service.getActiveAcceptances();

      await service.revokeRisk('acc-001', {
        revoked_by: 'user-789',
        revoked_by_name: 'Admin',
        revocation_reason: 'Risk accepted in error — revoke immediately.',
      });

      // Next call should hit ES again
      mockSearch.mockResolvedValueOnce(makeSearchResponse([]));
      await service.getActiveAcceptances();

      expect(mockSearch).toHaveBeenCalledTimes(2);
    });
  });

  // ── getAcceptanceById ───────────────────────────────────────────

  describe('getAcceptanceById()', () => {
    it('returns the document when found', async () => {
      const doc = makeAcceptance();
      mockGet.mockResolvedValue({ _source: doc });

      const result = await service.getAcceptanceById('acc-001');

      expect(result).toEqual(doc);
      expect(mockGet).toHaveBeenCalledWith({
        index: 'achilles-risk-acceptances',
        id: 'acc-001',
      });
    });

    it('returns null on 404', async () => {
      const notFoundErr = new Error('Not found') as any;
      notFoundErr.statusCode = 404;
      mockGet.mockRejectedValue(notFoundErr);

      const result = await service.getAcceptanceById('nonexistent');

      expect(result).toBeNull();
    });

    it('re-throws non-404 errors', async () => {
      const serverError = new Error('Internal server error') as any;
      serverError.statusCode = 500;
      mockGet.mockRejectedValue(serverError);

      await expect(service.getAcceptanceById('acc-001')).rejects.toThrow('Internal server error');
    });
  });

  // ── listAcceptances ─────────────────────────────────────────────

  describe('listAcceptances()', () => {
    it('returns paginated results with match_all when no filters', async () => {
      const docs = [makeAcceptance(), makeAcceptance({ acceptance_id: 'acc-002' })];
      mockSearch.mockResolvedValue(makeSearchResponse(docs, 2));

      const result = await service.listAcceptances();

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'achilles-risk-acceptances',
          size: 50,
          from: 0,
          query: { match_all: {} },
        }),
      );
    });

    it('applies status filter', async () => {
      mockSearch.mockResolvedValue(makeSearchResponse([makeAcceptance()]));

      await service.listAcceptances({ status: 'active' });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            bool: {
              filter: [{ term: { status: 'active' } }],
            },
          },
        }),
      );
    });

    it('applies test_name filter', async () => {
      mockSearch.mockResolvedValue(makeSearchResponse([]));

      await service.listAcceptances({ test_name: 'T1059-powershell' });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            bool: {
              filter: [{ term: { test_name: 'T1059-powershell' } }],
            },
          },
        }),
      );
    });

    it('applies both status and test_name filters together', async () => {
      mockSearch.mockResolvedValue(makeSearchResponse([]));

      await service.listAcceptances({ status: 'revoked', test_name: 'T1059-powershell' });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            bool: {
              filter: [
                { term: { status: 'revoked' } },
                { term: { test_name: 'T1059-powershell' } },
              ],
            },
          },
        }),
      );
    });

    it('handles pagination parameters', async () => {
      mockSearch.mockResolvedValue(makeSearchResponse([], 100));

      await service.listAcceptances({ page: 3, pageSize: 20 });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 20,
          from: 40, // (3-1) * 20
        }),
      );
    });

    it('handles numeric total (ES compat)', async () => {
      mockSearch.mockResolvedValue({
        hits: {
          total: 5,
          hits: [],
        },
      });

      const result = await service.listAcceptances();
      expect(result.total).toBe(5);
    });
  });

  // ── getActiveAcceptances ────────────────────────────────────────

  describe('getActiveAcceptances()', () => {
    it('returns active acceptances from ES', async () => {
      const docs = [makeAcceptance({ status: 'active' })];
      mockSearch.mockResolvedValue(makeSearchResponse(docs));

      const result = await service.getActiveAcceptances();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'achilles-risk-acceptances',
          size: 1000,
          query: { term: { status: 'active' } },
        }),
      );
    });

    it('returns cached results within TTL', async () => {
      const docs = [makeAcceptance()];
      mockSearch.mockResolvedValue(makeSearchResponse(docs));

      // First call — hits ES
      const first = await service.getActiveAcceptances();
      // Second call — should use cache
      const second = await service.getActiveAcceptances();

      expect(first).toEqual(second);
      expect(mockSearch).toHaveBeenCalledTimes(1); // Only one ES call
    });

    it('refreshes cache after TTL expiry', async () => {
      const docs = [makeAcceptance()];
      mockSearch.mockResolvedValue(makeSearchResponse(docs));

      // First call
      await service.getActiveAcceptances();

      // Manually expire the cache by invalidating it
      service.invalidateCache();

      // Second call — should hit ES again
      mockSearch.mockResolvedValue(makeSearchResponse([]));
      const result = await service.getActiveAcceptances();

      expect(result).toHaveLength(0);
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });
  });

  // ── getAcceptancesForControls ───────────────────────────────────

  describe('getAcceptancesForControls()', () => {
    it('returns empty object for empty input', async () => {
      const result = await service.getAcceptancesForControls([]);

      expect(result).toEqual({});
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('groups results by test_name', async () => {
      const doc1 = makeAcceptance({ test_name: 'T1059-powershell' });
      const doc2 = makeAcceptance({ acceptance_id: 'acc-002', test_name: 'T1059-powershell' });
      const doc3 = makeAcceptance({ acceptance_id: 'acc-003', test_name: 'T1486-ransomware' });

      mockSearch.mockResolvedValue(makeSearchResponse([doc1, doc2, doc3]));

      const result = await service.getAcceptancesForControls(['T1059-powershell', 'T1486-ransomware']);

      expect(result['T1059-powershell']).toHaveLength(2);
      expect(result['T1486-ransomware']).toHaveLength(1);
    });

    it('groups by test_name::control_id for bundle sub-controls', async () => {
      const doc1 = makeAcceptance({
        test_name: 'cyber-hygiene-baseline',
        control_id: 'CH-DEF-001',
      });
      const doc2 = makeAcceptance({
        acceptance_id: 'acc-002',
        test_name: 'cyber-hygiene-baseline',
        control_id: 'CH-DEF-002',
      });

      mockSearch.mockResolvedValue(makeSearchResponse([doc1, doc2]));

      const result = await service.getAcceptancesForControls(['cyber-hygiene-baseline']);

      expect(result['cyber-hygiene-baseline::CH-DEF-001']).toHaveLength(1);
      expect(result['cyber-hygiene-baseline::CH-DEF-002']).toHaveLength(1);
    });

    it('queries with correct terms filter', async () => {
      mockSearch.mockResolvedValue(makeSearchResponse([]));

      await service.getAcceptancesForControls(['test-a', 'test-b']);

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            bool: {
              filter: [
                { term: { status: 'active' } },
                { terms: { test_name: ['test-a', 'test-b'] } },
              ],
            },
          },
        }),
      );
    });
  });

  // ── buildExclusionFilter ────────────────────────────────────────

  describe('buildExclusionFilter()', () => {
    it('returns null when no active acceptances exist', async () => {
      mockSearch.mockResolvedValue(makeSearchResponse([]));

      const filter = await service.buildExclusionFilter();

      expect(filter).toBeNull();
    });

    it('builds term exclusion for global test acceptance', async () => {
      const doc = makeAcceptance({ test_name: 'T1059-powershell' });
      mockSearch.mockResolvedValue(makeSearchResponse([doc]));

      const filter = await service.buildExclusionFilter();

      expect(filter).toEqual({
        bool: {
          must_not: [
            { term: { 'f0rtika.test_name': 'T1059-powershell' } },
          ],
        },
      });
    });

    it('builds per-host exclusion', async () => {
      const doc = makeAcceptance({
        test_name: 'T1059-powershell',
        hostname: 'workstation-01',
      });
      mockSearch.mockResolvedValue(makeSearchResponse([doc]));

      const filter = await service.buildExclusionFilter();

      expect(filter).toEqual({
        bool: {
          must_not: [
            {
              bool: {
                must: [
                  { term: { 'f0rtika.test_name': 'T1059-powershell' } },
                  { term: { 'routing.hostname': 'workstation-01' } },
                ],
              },
            },
          ],
        },
      });
    });

    it('builds per-host + control_id exclusion', async () => {
      const doc = makeAcceptance({
        test_name: 'cyber-hygiene-baseline',
        control_id: 'CH-DEF-001',
        hostname: 'workstation-01',
      });
      mockSearch.mockResolvedValue(makeSearchResponse([doc]));

      const filter = await service.buildExclusionFilter();

      expect(filter).toEqual({
        bool: {
          must_not: [
            {
              bool: {
                must: [
                  { term: { 'f0rtika.test_name': 'cyber-hygiene-baseline' } },
                  { term: { 'routing.hostname': 'workstation-01' } },
                  { term: { 'f0rtika.control_id': 'CH-DEF-001' } },
                ],
              },
            },
          ],
        },
      });
    });

    it('builds global bundle sub-control exclusion (no hostname)', async () => {
      const doc = makeAcceptance({
        test_name: 'cyber-hygiene-baseline',
        control_id: 'CH-DEF-002',
      });
      mockSearch.mockResolvedValue(makeSearchResponse([doc]));

      const filter = await service.buildExclusionFilter();

      expect(filter).toEqual({
        bool: {
          must_not: [
            {
              bool: {
                must: [
                  { term: { 'f0rtika.test_name': 'cyber-hygiene-baseline' } },
                  { term: { 'f0rtika.control_id': 'CH-DEF-002' } },
                ],
              },
            },
          ],
        },
      });
    });

    it('handles mixed acceptance types', async () => {
      const globalAcc = makeAcceptance({ acceptance_id: 'a1', test_name: 'T1059-powershell' });
      const hostAcc = makeAcceptance({
        acceptance_id: 'a2',
        test_name: 'T1486-ransomware',
        hostname: 'srv-01',
      });
      const controlAcc = makeAcceptance({
        acceptance_id: 'a3',
        test_name: 'baseline',
        control_id: 'CH-DEF-003',
      });

      mockSearch.mockResolvedValue(makeSearchResponse([globalAcc, hostAcc, controlAcc]));

      const filter = await service.buildExclusionFilter();

      expect(filter!.bool.must_not).toHaveLength(3);
      // Global — simple term
      expect(filter!.bool.must_not[0]).toEqual({
        term: { 'f0rtika.test_name': 'T1059-powershell' },
      });
      // Per-host — bool.must with test_name + hostname
      expect(filter!.bool.must_not[1]).toEqual({
        bool: {
          must: [
            { term: { 'f0rtika.test_name': 'T1486-ransomware' } },
            { term: { 'routing.hostname': 'srv-01' } },
          ],
        },
      });
      // Global sub-control — bool.must with test_name + control_id
      expect(filter!.bool.must_not[2]).toEqual({
        bool: {
          must: [
            { term: { 'f0rtika.test_name': 'baseline' } },
            { term: { 'f0rtika.control_id': 'CH-DEF-003' } },
          ],
        },
      });
    });
  });

  // ── invalidateCache ─────────────────────────────────────────────

  describe('invalidateCache()', () => {
    it('clears cache so next call fetches fresh data', async () => {
      // Populate cache
      mockSearch.mockResolvedValueOnce(makeSearchResponse([makeAcceptance()]));
      const first = await service.getActiveAcceptances();
      expect(first).toHaveLength(1);

      // Invalidate
      service.invalidateCache();

      // Next call should query ES again with fresh data
      mockSearch.mockResolvedValueOnce(makeSearchResponse([]));
      const second = await service.getActiveAcceptances();
      expect(second).toHaveLength(0);

      expect(mockSearch).toHaveBeenCalledTimes(2);
    });
  });
});
