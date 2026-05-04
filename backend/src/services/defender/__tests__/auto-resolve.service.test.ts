import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index-management.js', () => ({
  DEFENDER_INDEX: 'achilles-defender',
}));

const { DefenderAutoResolveService } = await import('../auto-resolve.service.js');
const { GraphPatchError } = await import('../graph-client.js');

describe('DefenderAutoResolveService', () => {
  const mockSearch = vi.fn();
  const mockUpdate = vi.fn();
  const mockUpdateAlert = vi.fn();
  const mockAddAlertComment = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: comment post succeeds. Individual tests override for failure.
    mockAddAlertComment.mockResolvedValue(undefined);
  });

  const createService = (mode: 'disabled' | 'dry_run' | 'enabled') => {
    const esClient = { search: mockSearch, update: mockUpdate } as any;
    const graphClient = { updateAlert: mockUpdateAlert, addAlertComment: mockAddAlertComment } as any;
    return new DefenderAutoResolveService(esClient, graphClient, mode);
  };

  const candidateHit = (id: string, alertId: string, testUuid: string, extra: Record<string, any> = {}) => ({
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
        ...extra,
      },
    },
  });

  const searchResponse = (hits: any[]) => ({
    hits: { total: { value: hits.length }, hits },
  });

  // ─── disabled mode ───────────────────────────────────────────────

  it('disabled mode is a complete no-op (zero ES, zero Graph)', async () => {
    const service = createService('disabled');

    const result = await service.runAutoResolvePass();

    expect(result.mode).toBe('disabled');
    expect(result.candidates).toBe(0);
    expect(result.patched).toBe(0);
    expect(result.wouldPatch).toBe(0);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockUpdateAlert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ─── enabled mode — happy path ───────────────────────────────────

  it('enabled mode PATCHes each candidate and writes a receipt', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({ result: 'updated' });

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(2);
    expect(result.wouldPatch).toBe(0);
    expect(result.candidates).toBe(2);
    expect(result.errors).toEqual([]);

    // Both alerts got PATCHed with the expected payload shape
    expect(mockUpdateAlert).toHaveBeenCalledTimes(2);
    const firstPatchArgs = mockUpdateAlert.mock.calls[0];
    expect(firstPatchArgs[0]).toBe('alert-1');
    expect(firstPatchArgs[1]).toMatchObject({
      status: 'resolved',
      classification: 'informationalExpectedActivity',
      determination: 'securityTesting',
    });
    // The PATCH body MUST NOT carry `comments` — alerts_v2 silently drops it.
    // Comments go through addAlertComment() instead (separate endpoint).
    expect(firstPatchArgs[1].comments).toBeUndefined();

    // Comment was sent via the dedicated /comments endpoint with the
    // expected text. One call per PATCHed alert.
    expect(mockAddAlertComment).toHaveBeenCalledTimes(2);
    const firstCommentArgs = mockAddAlertComment.mock.calls[0];
    expect(firstCommentArgs[0]).toBe('alert-1');
    expect(firstCommentArgs[1]).toContain('bundle-A');
    expect(firstCommentArgs[1]).toContain('Achilles test');

    // Receipt written for each
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    const firstReceipt = mockUpdate.mock.calls[0][0];
    expect(firstReceipt.index).toBe('achilles-defender');
    expect(firstReceipt.id).toBe('doc-1');
    expect(firstReceipt.doc.f0rtika.auto_resolved).toBe(true);
    expect(firstReceipt.doc.f0rtika.auto_resolve_mode).toBe('enabled');
    expect(firstReceipt.doc.f0rtika.auto_resolve_error).toBeUndefined();
  });

  // ─── dry-run mode ────────────────────────────────────────────────

  // ─── comment failure is non-fatal ────────────────────────────────

  // The audit-trail comment is posted via a SEPARATE Graph endpoint
  // (alerts_v2 PATCH silently drops `comments` from the body). If the
  // comment POST fails for any reason — 403, 5xx, network, etc. — the
  // resolve PATCH has ALREADY succeeded and the alert is correctly
  // classified. Failing the whole pass on a comment-write error would
  // produce zero net benefit (alert still resolved in Defender) and
  // miss a receipt write (causing infinite re-PATCH attempts on every
  // 5-min cycle). So comment failure must be non-fatal: log + continue
  // to the receipt write.
  it('comment post failure does NOT undo the resolve or block the receipt', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]),
    );
    mockUpdateAlert.mockResolvedValue(undefined);   // PATCH succeeds
    mockAddAlertComment.mockRejectedValue(new Error('Graph 503: service unavailable')); // comment fails
    mockUpdate.mockResolvedValue({ result: 'updated' });

    const result = await service.runAutoResolvePass();

    // Resolve was successful — patched count must reflect the PATCH success
    expect(result.patched).toBe(1);
    expect(result.errors).toEqual([]); // comment error is logged, not surfaced

    // Comment was attempted (we still TRY)
    expect(mockAddAlertComment).toHaveBeenCalledTimes(1);

    // Receipt was still written despite comment failure — this is
    // critical, otherwise the next pass would see the alert as a
    // candidate again and re-PATCH it forever.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const receipt = mockUpdate.mock.calls[0][0];
    expect(receipt.doc.f0rtika.auto_resolved).toBe(true);
    expect(receipt.doc.f0rtika.auto_resolve_mode).toBe('enabled');
  });

  it('dry_run mode writes receipts but does NOT call Graph PATCH', async () => {
    const service = createService('dry_run');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdate.mockResolvedValue({ result: 'updated' });

    const result = await service.runAutoResolvePass();

    expect(result.wouldPatch).toBe(2);
    expect(result.patched).toBe(0);
    expect(mockUpdateAlert).not.toHaveBeenCalled();
    // Comment endpoint must not be hit in dry_run either — the whole point
    // of dry_run is zero side-effects on Defender state.
    expect(mockAddAlertComment).not.toHaveBeenCalled();

    // Receipt written with mode='dry_run' so next pass skips them
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    const receipt = mockUpdate.mock.calls[0][0];
    expect(receipt.doc.f0rtika.auto_resolve_mode).toBe('dry_run');
    expect(receipt.doc.f0rtika.auto_resolved).toBe(true);
  });

  // ─── idempotency ─────────────────────────────────────────────────

  it('idempotent: second pass with the same receipts sees 0 candidates', async () => {
    const service = createService('enabled');

    // Pass 1: one candidate
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    await service.runAutoResolvePass();

    // Pass 2: candidate query filters out auto_resolved:true, returns empty
    mockSearch.mockResolvedValueOnce(searchResponse([]));
    const result2 = await service.runAutoResolvePass();

    expect(result2.candidates).toBe(0);
    expect(result2.patched).toBe(0);

    // The candidate query on pass 2 must include must_not auto_resolved
    const queryStr = JSON.stringify(mockSearch.mock.calls[1][0].query);
    expect(queryStr).toContain('auto_resolved');
  });

  // ─── status whitelist (only 'new' alerts are candidates) ─────────

  // The candidate query whitelists `status: 'new'` — not a must_not on
  // 'resolved'. This excludes 'inProgress' (someone is actively triaging),
  // 'resolved' (already handled by a human or Defender), 'unknown', and any
  // future status values Defender might add. Failing closed on the status
  // dimension is the conservative posture: the customer can grant
  // SecurityAlert.ReadWrite.All and flip to enabled mode without worrying
  // that auto-resolve will reach into alerts a SOC analyst is mid-triage on.
  it('candidate query whitelists status="new" (not just excluding "resolved")', async () => {
    const service = createService('dry_run');
    mockSearch.mockResolvedValueOnce(searchResponse([]));

    await service.runAutoResolvePass();

    const query = mockSearch.mock.calls[0][0].query;
    const filter = query.bool.filter;
    const mustNot = query.bool.must_not;

    // The status='new' clause MUST be in `filter` (whitelist), not in `must_not`.
    expect(filter).toContainEqual({ term: { status: 'new' } });

    // And must_not must NOT carry a status:'resolved' clause anymore — that
    // was the prior, looser policy. Pinning this prevents accidental drift
    // back to a behavior that would PATCH inProgress alerts.
    const mustNotJson = JSON.stringify(mustNot);
    expect(mustNotJson).not.toContain('"status"');

    // Sanity: existing receipt-based dedup is still in must_not.
    expect(mustNot).toContainEqual({ term: { 'f0rtika.auto_resolved': true } });
  });

  // ─── 403 halts the pass ──────────────────────────────────────────

  it('403 halts the pass — no further candidates are processed', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
        candidateHit('doc-3', 'alert-3', 'bundle-C'),
      ]),
    );
    // First PATCH fails with 403 — should short-circuit
    mockUpdateAlert.mockRejectedValueOnce(
      new GraphPatchError('forbidden — SecurityAlert.ReadWrite.All required', 403, 'Forbidden'),
    );

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('403');
    // Only the first PATCH was attempted
    expect(mockUpdateAlert).toHaveBeenCalledTimes(1);
    // No receipt written — we want to retry once permission is granted
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ─── 404 writes a skip-forever receipt ───────────────────────────

  it('404 writes a receipt with auto_resolve_error=not_found and continues to next candidate', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-deleted', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlert
      .mockRejectedValueOnce(new GraphPatchError('not found', 404, 'NotFound'))
      .mockResolvedValueOnce(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(1); // the second one
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('not_found');

    // Receipt for alert-deleted records the error so we don't retry
    const firstReceipt = mockUpdate.mock.calls[0][0];
    expect(firstReceipt.id).toBe('doc-1');
    expect(firstReceipt.doc.f0rtika.auto_resolve_error).toBe('not_found');
    expect(firstReceipt.doc.f0rtika.auto_resolved).toBe(true);
  });

  // ─── transient error — no receipt, retry next pass ───────────────

  it('transient error (500) is recorded but writes NO receipt, so next pass retries', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlert.mockRejectedValueOnce(new GraphPatchError('server error', 500, 'err'));

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ─── max-per-pass cap ────────────────────────────────────────────

  it('maxPerPass caps the query size', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([]));

    await service.runAutoResolvePass({ maxPerPass: 10 });

    expect(mockSearch.mock.calls[0][0].size).toBe(10);
  });

  // ─── malformed candidate skipped ─────────────────────────────────

  it('skips candidates with missing test_uuid or alert_id', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        // Missing alert_id in source
        {
          _id: 'doc-bad',
          _index: 'achilles-defender',
          _source: { doc_type: 'alert', f0rtika: { achilles_correlated: true, achilles_test_uuid: 'bundle-X' } },
        },
        // Missing test_uuid in f0rtika
        candidateHit('doc-2', 'alert-2', ''),
        // Good one
        candidateHit('doc-3', 'alert-3', 'bundle-A'),
      ]),
    );
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(1);
    expect(result.skipped).toBe(1); // the doc-2 missing test_uuid
    // doc-bad is dropped at candidate-construction (no alert_id → filtered in findCandidates)
    expect(result.candidates).toBe(2); // only 2 passed the findCandidates filter
  });

  // ─── modeOverride for test ergonomics ────────────────────────────

  it('modeOverride takes precedence over constructor mode', async () => {
    const service = createService('disabled'); // would be a no-op
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass({ modeOverride: 'enabled' });

    expect(result.mode).toBe('enabled');
    expect(result.patched).toBe(1);
  });

  // ─── ES scan failure captured ────────────────────────────────────

  it('captures ES scan errors into result.errors rather than throwing', async () => {
    const service = createService('enabled');
    mockSearch.mockRejectedValueOnce(new Error('cluster transient'));

    const result = await service.runAutoResolvePass();

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('cluster transient');
    expect(result.candidates).toBe(0);
  });

  // ─── receipt-write failure is non-fatal ──────────────────────────

  it('receipt-write failure does not throw; pass continues', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlert.mockResolvedValue(undefined);
    mockUpdate.mockRejectedValueOnce(new Error('mapping conflict')); // first receipt fails
    mockUpdate.mockResolvedValueOnce({}); // second succeeds

    const result = await service.runAutoResolvePass();

    // Both PATCHes still counted — the PATCH already succeeded before the receipt failed
    expect(result.patched).toBe(2);
  });

  // ─── result shape invariant ──────────────────────────────────────

  it('result.candidates equals patched + wouldPatch + skipped + (errored non-halt)', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'), // → patched
        candidateHit('doc-2', 'alert-2', 'bundle-B'), // → error (transient, no receipt)
        candidateHit('doc-3', 'alert-3', ''),         // → skipped (missing testUuid)
      ]),
    );
    mockUpdateAlert
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new GraphPatchError('boom', 500, 'e'));
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();

    expect(result.candidates).toBe(3);
    expect(result.patched).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  // ─── durationMs is populated ─────────────────────────────────────

  it('returns a numeric durationMs', async () => {
    const service = createService('disabled');
    const result = await service.runAutoResolvePass();
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
