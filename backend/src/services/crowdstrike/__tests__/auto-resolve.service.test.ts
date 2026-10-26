import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../index-management.js', () => ({
  CROWDSTRIKE_INDEX: 'achilles-crowdstrike',
}));

const { CrowdStrikeAutoResolveService } = await import('../auto-resolve.service.js');
const { FalconApiError } = await import('../falcon-client.js');

describe('CrowdStrikeAutoResolveService', () => {
  const mockSearch = vi.fn();
  const mockUpdate = vi.fn();
  const mockUpdateAlerts = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createService = (mode: 'disabled' | 'dry_run' | 'enabled') => {
    const esClient = { search: mockSearch, update: mockUpdate } as any;
    const falconClient = { updateAlerts: mockUpdateAlerts } as any;
    return new CrowdStrikeAutoResolveService(esClient, falconClient, mode);
  };

  const candidateHit = (id: string, alertId: string, testUuid: string, extra: Record<string, any> = {}) => ({
    _id: id,
    _index: 'achilles-crowdstrike',
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

  // Default successful PATCH envelope: no per-item errors.
  const patchOk = (resourcesAffected = 1) => ({ resourcesAffected, errors: [] });

  // ─── disabled mode ───────────────────────────────────────────────

  it('disabled mode is a complete no-op (zero ES, zero Falcon)', async () => {
    const service = createService('disabled');

    const result = await service.runAutoResolvePass();

    expect(result.mode).toBe('disabled');
    expect(result.candidates).toBe(0);
    expect(result.patched).toBe(0);
    expect(result.wouldPatch).toBe(0);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockUpdateAlerts).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ─── enabled mode — happy path ───────────────────────────────────

  it('enabled mode PATCHes each candidate with status=closed + comment and writes a receipt', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-1', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlerts.mockResolvedValue(patchOk());
    mockUpdate.mockResolvedValue({ result: 'updated' });

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(2);
    expect(result.wouldPatch).toBe(0);
    expect(result.candidates).toBe(2);
    expect(result.errors).toEqual([]);

    // Both alerts got PATCHed with the exact v3 body: composite_ids,
    // update_status='closed', and the audit-trail comment in ONE call
    // (CrowdStrike has no separate comments endpoint like Graph's).
    expect(mockUpdateAlerts).toHaveBeenCalledTimes(2);
    const firstPatchArgs = mockUpdateAlerts.mock.calls[0];
    expect(firstPatchArgs[0]).toEqual(['alert-1']);
    expect(firstPatchArgs[1]).toEqual({
      status: 'closed',
      comment: 'Achilles test bundle-A — authorized continuous validation. Resolved automatically by Project Achilles.',
    });

    // Receipt written for each
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    const firstReceipt = mockUpdate.mock.calls[0][0];
    expect(firstReceipt.index).toBe('achilles-crowdstrike');
    expect(firstReceipt.id).toBe('doc-1');
    expect(firstReceipt.doc.f0rtika.auto_resolved).toBe(true);
    expect(firstReceipt.doc.f0rtika.auto_resolve_mode).toBe('enabled');
    expect(firstReceipt.doc.f0rtika.auto_resolve_error).toBeUndefined();
  });

  // ─── dry-run mode ────────────────────────────────────────────────

  it('dry_run mode writes receipts but does NOT call Falcon PATCH', async () => {
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
    expect(mockUpdateAlerts).not.toHaveBeenCalled();

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
    mockUpdateAlerts.mockResolvedValue(patchOk());
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
  // 'closed'. This excludes 'in_progress' (someone is actively triaging),
  // 'reopened' (a human deliberately reopened it), 'closed' (already
  // handled), and any future status values CrowdStrike might add. Failing
  // closed on the status dimension is the conservative posture: the customer
  // can grant the Alerts: write scope and flip to enabled mode without
  // worrying that auto-resolve will reach into alerts a SOC analyst is
  // mid-triage on.
  it('candidate query whitelists status="new" (not just excluding "closed")', async () => {
    const service = createService('dry_run');
    mockSearch.mockResolvedValueOnce(searchResponse([]));

    await service.runAutoResolvePass();

    const query = mockSearch.mock.calls[0][0].query;
    const filter = query.bool.filter;
    const mustNot = query.bool.must_not;

    // The status='new' clause MUST be in `filter` (whitelist), not in `must_not`.
    expect(filter).toContainEqual({ term: { status: 'new' } });

    // And must_not must NOT carry a status clause — that would be the
    // looser blocklist policy. Pinning this prevents accidental drift
    // back to a behavior that would PATCH in_progress alerts.
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
    mockUpdateAlerts.mockRejectedValueOnce(
      new FalconApiError("forbidden — 'Alerts: write' scope required", 403, 'Forbidden'),
    );

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('403');
    // Only the first PATCH was attempted
    expect(mockUpdateAlerts).toHaveBeenCalledTimes(1);
    // No receipt written — we want to retry once permission is granted
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ─── 404 writes a skip-forever receipt ───────────────────────────

  it('404 (thrown) writes a receipt with auto_resolve_error=not_found and continues to next candidate', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-deleted', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlerts
      .mockRejectedValueOnce(new FalconApiError('not found', 404, 'NotFound'))
      .mockResolvedValueOnce(patchOk());
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

  // ─── 200-with-per-item-errors envelope ───────────────────────────

  // CrowdStrike's PATCH /alerts/entities/alerts/v3 returns HTTP 200 with
  // per-item failures in errors[] — the auto-resolve pass must inspect the
  // envelope (PatchAlertsResult), not just rely on the call not throwing.
  it('per-item errors[] in the 200 envelope produce error receipts (mapped not_found)', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(
      searchResponse([
        candidateHit('doc-1', 'alert-gone', 'bundle-A'),
        candidateHit('doc-2', 'alert-2', 'bundle-B'),
      ]),
    );
    mockUpdateAlerts
      // First call: HTTP 200 but the item failed with a 404 code in the envelope
      .mockResolvedValueOnce({
        resourcesAffected: 0,
        errors: [{ code: 404, id: 'alert-gone', message: 'alert not found' }],
      })
      // Second call: clean
      .mockResolvedValueOnce(patchOk());
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(1); // only the second alert
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('not_found');

    // Error receipt for alert-gone so it isn't rescanned forever
    const firstReceipt = mockUpdate.mock.calls[0][0];
    expect(firstReceipt.id).toBe('doc-1');
    expect(firstReceipt.doc.f0rtika.auto_resolve_error).toBe('not_found');
    expect(firstReceipt.doc.f0rtika.auto_resolved).toBe(true);
    expect(firstReceipt.doc.f0rtika.auto_resolve_mode).toBe('enabled');
  });

  it('per-item errors with non-404 codes are recorded verbatim-ish in the receipt', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlerts.mockResolvedValueOnce({
      resourcesAffected: 0,
      errors: [{ code: 409, id: 'alert-1', message: 'alert is locked by another workflow' }],
    });
    mockUpdate.mockResolvedValue({});

    const result = await service.runAutoResolvePass();

    expect(result.patched).toBe(0);
    expect(result.errors.length).toBe(1);
    const receipt = mockUpdate.mock.calls[0][0];
    expect(receipt.doc.f0rtika.auto_resolve_error).toContain('409');
    expect(receipt.doc.f0rtika.auto_resolve_error).toContain('locked');
  });

  // ─── transient error — no receipt, retry next pass ───────────────

  it('transient error (500) is recorded but writes NO receipt, so next pass retries', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([candidateHit('doc-1', 'alert-1', 'bundle-A')]));
    mockUpdateAlerts.mockRejectedValueOnce(new FalconApiError('server error', 500, 'err'));

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
          _index: 'achilles-crowdstrike',
          _source: { doc_type: 'alert', f0rtika: { achilles_correlated: true, achilles_test_uuid: 'bundle-X' } },
        },
        // Missing test_uuid in f0rtika
        candidateHit('doc-2', 'alert-2', ''),
        // Good one
        candidateHit('doc-3', 'alert-3', 'bundle-A'),
      ]),
    );
    mockUpdateAlerts.mockResolvedValue(patchOk());
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
    mockUpdateAlerts.mockResolvedValue(patchOk());
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
    mockUpdateAlerts.mockResolvedValue(patchOk());
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
    mockUpdateAlerts
      .mockResolvedValueOnce(patchOk())
      .mockRejectedValueOnce(new FalconApiError('boom', 500, 'e'));
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

  // Regression guard (EDR-killed agent runs): kill-matched alerts carry only
  // achilles_agent_kill_task_id, never achilles_correlated, so the candidate
  // query must keep requiring achilles_correlated:true to leave them alone.
  it('ignores alerts that only carry achilles_agent_kill_task_id', async () => {
    const service = createService('enabled');
    mockSearch.mockResolvedValueOnce(searchResponse([]));

    await service.runAutoResolvePass();

    const q = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(q).toContain('"f0rtika.achilles_correlated":true');
    expect(q).not.toContain('achilles_agent_kill_task_id');
  });
});
