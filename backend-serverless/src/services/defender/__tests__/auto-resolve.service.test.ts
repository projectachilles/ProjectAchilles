// Mirrors backend/src/services/defender/__tests__/auto-resolve.service.test.ts.
// Serverless AutoResolveService has identical semantics to docker's.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index-management.js', () => ({
  DEFENDER_INDEX: 'achilles-defender',
}));

const { DefenderAutoResolveService } = await import('../auto-resolve.service.js');
const { GraphPatchError } = await import('../graph-client.js');

describe('DefenderAutoResolveService (serverless)', () => {
  const mockSearch = vi.fn();
  const mockUpdate = vi.fn();
  const mockUpdateAlert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createService = (mode: 'disabled' | 'dry_run' | 'enabled') => {
    const esClient = { search: mockSearch, update: mockUpdate } as any;
    const graphClient = { updateAlert: mockUpdateAlert } as any;
    return new DefenderAutoResolveService(esClient, graphClient, mode);
  };

  const candidateHit = (id: string, alertId: string, testUuid: string) => ({
    _id: id,
    _index: 'achilles-defender',
    _source: {
      doc_type: 'alert',
      alert_id: alertId,
      status: 'new',
      f0rtika: {
        achilles_correlated: true,
        achilles_test_uuid: testUuid,
        achilles_matched_at: '2026-04-14T12:00:00Z',
      },
    },
  });

  const searchResponse = (hits: any[]) => ({
    hits: { total: { value: hits.length }, hits },
  });

  it('disabled mode is a complete no-op', async () => {
    const service = createService('disabled');
    const result = await service.runAutoResolvePass();
    expect(result.mode).toBe('disabled');
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockUpdateAlert).not.toHaveBeenCalled();
  });

  it('enabled mode PATCHes candidates and writes receipts', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();
    expect(result.patched).toBe(2);
    expect(mockUpdateAlert).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);

    const firstPatch = mockUpdateAlert.mock.calls[0];
    expect(firstPatch[0]).toBe('alert-1');
    expect(firstPatch[1]).toMatchObject({
      status: 'resolved',
      classification: 'informationalExpectedActivity',
      determination: 'securityTesting',
    });
  });

  it('dry_run mode writes receipts but does not call Graph', async () => {
    const service = createService('dry_run');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();
    expect(result.wouldPatch).toBe(1);
    expect(mockUpdateAlert).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][0].doc.f0rtika.auto_resolve_mode).toBe('dry_run');
  });

  it('403 halts the pass', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlert.mockRejectedValueOnce(
      new GraphPatchError('forbidden — SecurityAlert.ReadWrite.All required', 403, 'Forbidden'),
    );

    const result = await service.runAutoResolvePass();
    expect(result.patched).toBe(0);
    expect(result.errors[0]).toContain('403');
    expect(mockUpdateAlert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404 writes receipt with not_found and continues', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-deleted', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlert
      .mockRejectedValueOnce(new GraphPatchError('not found', 404, ''))
      .mockResolvedValueOnce(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();
    expect(result.patched).toBe(1);
    expect(mockUpdate.mock.calls[0][0].doc.f0rtika.auto_resolve_error).toBe('not_found');
  });

  it('transient error writes NO receipt (next pass retries)', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlert.mockRejectedValueOnce(new GraphPatchError('server error', 500, ''));

    const result = await service.runAutoResolvePass();
    expect(result.patched).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('maxPerPass caps the ES query size', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([]));
    await service.runAutoResolvePass({ maxPerPass: 5 });
    expect(mockSearch.mock.calls[0][0].size).toBe(5);
  });

  it('skips candidates with missing test_uuid', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', ''),
        candidateHit('doc-2', 'alert-2', 'bundle-A'),
      ]),
    );
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();
    expect(result.skipped).toBe(1);
    expect(result.patched).toBe(1);
  });

  it('modeOverride takes precedence over constructor mode', async () => {
    const service = createService('disabled');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass({ modeOverride: 'enabled' });
    expect(result.mode).toBe('enabled');
    expect(result.patched).toBe(1);
  });

  it('ES scan error is captured into result, not thrown', async () => {
    const service = createService('enabled');
    mockSearch.mockRejectedValueOnce(new Error('cluster transient'));
    const result = await service.runAutoResolvePass();
    expect(result.errors[0]).toContain('cluster transient');
    expect(result.candidates).toBe(0);
  });

  it('idempotent: second pass with auto_resolved filter finds 0 candidates', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    await service.runAutoResolvePass();

    mockSearch.mockResolvedValueOnce(searchResponse([]));
    const result2 = await service.runAutoResolvePass();
    expect(result2.candidates).toBe(0);
    const qs = JSON.stringify(mockSearch.mock.calls[1][0].query);
    expect(qs).toContain('auto_resolved');
  });
});
