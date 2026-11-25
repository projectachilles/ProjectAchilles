import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../evidence-correlation.js', async () => {
  const actual = await vi.importActual('../evidence-correlation.js');
  return actual;
});

vi.mock('../index-management.js', () => ({
  DEFENDER_INDEX: 'achilles-defender',
}));

const { DefenderEnrichmentService } = await import('../enrichment.service.js');
const {
  buildAlertTimeWindowQuery, defenderAlertTimeQuery, buildDefenderEvidenceQuery, buildStageDefenderEvidenceQuery,
} = await import('../evidence-correlation.js');
const { RUN_RULE } = await import('../../edr/alert-enrichment.service.js');

describe('DefenderEnrichmentService', () => {
  const mockSearch = vi.fn();
  const mockMsearch = vi.fn();
  const mockBulk = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createService = () => {
    const mockClient = {
      search: mockSearch,
      msearch: mockMsearch,
      bulk: mockBulk,
    } as any;
    return new DefenderEnrichmentService(mockClient, 'achilles-results-*');
  };

  const makeScanResponse = (hits: any[]) => ({
    hits: { total: { value: hits.length }, hits },
  });

  const makeMsearchResponse = (responses: any[]) => ({ responses });

  const makeBulkResponse = (items: Array<{ ok: boolean; reason?: string }>) => ({
    errors: items.some((i) => !i.ok),
    items: items.map((i) => ({
      update: i.ok
        ? { _index: 'achilles-results-acme', result: 'updated' }
        : { error: { reason: i.reason ?? 'err' } },
    })),
  });

  const eligibleDoc = (id: string, uuid: string) => ({
    _id: id,
    _index: 'achilles-results-acme',
    _source: {
      f0rtika: { test_uuid: uuid, test_name: 'T', category: 'intel-driven' },
      routing: { event_time: '2026-03-27T07:52:54Z', hostname: 'LT-ACME-L50' },
    },
    sort: ['2026-03-27T07:52:54Z', 1],
  });

  // 1. Happy path
  it('scans, msearches, and bulk-updates hits', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 1 } } }]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    const result = await service.runEnrichmentPass({ batchSize: 200 });

    expect(result.scanned).toBe(1);
    expect(result.detected).toBe(1);
    expect(result.batches).toBe(1);
    expect(result.errors).toEqual([]);
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('flags an error-category doc (999, EDR-killed stage) when alert evidence matches', async () => {
    // Production scenario (customer tenant, 2026-10-12): CrowdStrike killed the T1486
    // stage at launch (exit 0xE0000027, coerced to 999) and raised a ProcRansomware
    // alert with the exact stage binary in evidence. The doc is error-category but
    // eligible for scanning; a match must flag it like any conclusive doc.
    const service = createService();
    const base = eligibleDoc('d-killed', 'a::T1486');
    const killedStageDoc = {
      ...base,
      _source: { ...base._source, event: { ERROR: 999 } },
    };
    mockSearch.mockResolvedValueOnce(makeScanResponse([killedStageDoc]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 1 } } }]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    const result = await service.runEnrichmentPass({ batchSize: 200 });

    expect(result.scanned).toBe(1);
    expect(result.detected).toBe(1);
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  // 2. CH excluded
  it('eligibility filter excludes cyber-hygiene', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass();

    const scanQuery = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(scanQuery).toContain('cyber-hygiene');
  });

  // 3. Conclusive only
  it('eligibility filter includes conclusive error codes', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass();
    const scanQuery = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(scanQuery).toContain('101');
    expect(scanQuery).toContain('105');
    expect(scanQuery).toContain('126');
    expect(scanQuery).toContain('127');
  });

  it('eligibility filter includes error-category codes (EDR-killed stages) and excludes 260', async () => {
    // EDR-killed stages land as error-category codes (999/259/0/1) — they must be
    // SCANNED so matching alert evidence can flag them (docs/edr-killed-stage-detection.md).
    // 260 (BlockedPreExecution) stays out: ASR/app-control policy blocks are not detections.
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass();

    const query = mockSearch.mock.calls[0][0].query as any;
    const termsClause = query.bool.filter.find((f: any) => f.terms?.['event.ERROR']);
    expect(termsClause.terms['event.ERROR']).toEqual([0, 1, 101, 105, 126, 127, 259, 999]);
    expect(termsClause.terms['event.ERROR']).not.toContain(260);
  });

  // 4. Already-detected excluded
  it('eligibility filter excludes already-detected docs', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass();
    const scanQuery = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(scanQuery).toContain('defender_detected');
  });

  // 5. Lookback
  it('eligibility filter respects lookbackDays option', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass({ lookbackDays: 30 });
    const scanQuery = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(scanQuery).toContain('now-30d');
  });

  // 6. Pagination with search_after
  it('paginates using search_after when batch is full', async () => {
    const service = createService();
    // First batch: 1 doc (batchSize=1), triggers next scan
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 0 } } }]));
    // Second batch: 1 doc
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d2', 'b::T2')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 0 } } }]));
    // Third scan: empty, stop
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));

    await service.runEnrichmentPass({ batchSize: 1 });

    // Second scan should include search_after
    expect(mockSearch.mock.calls[1][0].search_after).toBeDefined();
  });

  // 7. Terminates when fewer than batchSize
  it('terminates cleanly when scan returns fewer than batchSize docs', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 0 } } }]));

    const result = await service.runEnrichmentPass({ batchSize: 10 });

    expect(result.scanned).toBe(1);
    // Only 1 search call (scan) + 1 msearch, no second scan since hits < batchSize
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  // 8. msearch body construction
  it('msearch body contains one sub-query per eligible doc', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(
      makeScanResponse([
        eligibleDoc('d1', 'a::T1'),
        eligibleDoc('d2', 'b::T2'),
        eligibleDoc('d3', 'c::T3'),
      ]),
    );
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([
        { hits: { total: { value: 0 } } },
        { hits: { total: { value: 0 } } },
        { hits: { total: { value: 0 } } },
      ]),
    );

    await service.runEnrichmentPass();

    const msearchCall = mockMsearch.mock.calls[0][0];
    // searches alternates header+body: 3 docs → 6 entries
    expect(msearchCall.searches).toHaveLength(6);
  });

  // 9. Skips docs where helper returns null
  it('skips docs where the helper returns null', async () => {
    const service = createService();
    const goodDoc = eligibleDoc('d1', 'a::T1');
    const badDoc = {
      _id: 'd2',
      _index: 'achilles-results-acme',
      _source: { f0rtika: { test_uuid: '' }, routing: {} },
      sort: ['2026-03-27T07:52:54Z', 2],
    };
    mockSearch.mockResolvedValueOnce(makeScanResponse([goodDoc, badDoc]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 0 } } }]));

    const result = await service.runEnrichmentPass();

    expect(result.scanned).toBe(2);
    expect(result.skipped).toBe(1);
    // msearch should have ONE sub-query (2 entries: header+body), not two
    expect(mockMsearch.mock.calls[0][0].searches).toHaveLength(2);
  });

  // 10. Partial msearch failure
  it('partial msearch failure does not block successful sub-queries', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(
      makeScanResponse([eligibleDoc('d1', 'a::T1'), eligibleDoc('d2', 'b::T2')]),
    );
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([
        { error: { type: 'search_phase_execution_exception', reason: 'boom' } },
        { hits: { total: { value: 1 } } },
      ]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // 11. Bulk update shape
  it('bulk update uses partial doc format (not full replacement)', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 1 } } }]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    await service.runEnrichmentPass();

    const bulkCall = mockBulk.mock.calls[0][0];
    const payload = bulkCall.operations[1];
    expect(payload).toHaveProperty('doc');
    expect(payload.doc.f0rtika.defender_detected).toBe(true);
  });

  // 12. Bulk update uses source index
  it('bulk update targets the source index of each doc', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      { ...eligibleDoc('d1', 'a::T1'), _index: 'achilles-results-acme' },
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 1 } } }]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    await service.runEnrichmentPass();

    const header = mockBulk.mock.calls[0][0].operations[0];
    expect(header.update._index).toBe('achilles-results-acme');
    expect(header.update._id).toBe('d1');
  });

  // 13. Empty msearch → no bulk
  it('empty msearch response issues no bulk update', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 0 } } }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });

  // 14. Empty scan → immediate termination
  it('empty scan response terminates immediately', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));

    const result = await service.runEnrichmentPass();

    expect(result.scanned).toBe(0);
    expect(result.batches).toBe(0);
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  // 15. Defender index 404
  it('caught Defender index 404 during msearch is recorded and pass continues', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockRejectedValueOnce(
      Object.assign(new Error('index_not_found_exception'), { statusCode: 404 }),
    );

    const result = await service.runEnrichmentPass();

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.detected).toBe(0);
  });

  // 16. Idempotency
  it('running pass twice: second pass is a no-op if first already processed everything', async () => {
    const service = createService();
    // Run 1: finds and updates doc
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 1 } } }]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));
    await service.runEnrichmentPass();

    // Run 2: scan returns empty (doc now has defender_detected:true, excluded by filter)
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    const result2 = await service.runEnrichmentPass();

    expect(result2.scanned).toBe(0);
    expect(result2.detected).toBe(0);
  });

  // 17. Duration cap
  it('honors maxDurationMs and stops between batches', async () => {
    const service = createService();
    let calls = 0;
    mockSearch.mockImplementation(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 100));
      return makeScanResponse([eligibleDoc(`d${calls}`, `a::T${calls}`)]);
    });
    mockMsearch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return makeMsearchResponse([{ hits: { total: { value: 0 } } }]);
    });

    const result = await service.runEnrichmentPass({ batchSize: 1, maxDurationMs: 250 });

    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.batches).toBeLessThanOrEqual(2);
  });

  // 18. Result shape
  it('returns EnrichmentPassResult with all required fields', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));

    const result = await service.runEnrichmentPass();

    expect(result).toMatchObject({
      scanned: expect.any(Number),
      detected: expect.any(Number),
      skipped: expect.any(Number),
      batches: expect.any(Number),
      errors: expect.any(Array),
      durationMs: expect.any(Number),
    });
  });

  // 19. Bulk partial failure
  it('bulk update partial failure: successes still counted, failures recorded', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleDoc('d1', 'a::T1'),
      eligibleDoc('d2', 'b::T2'),
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 1 } } },
      { hits: { total: { value: 1 } } },
    ]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([
      { ok: true },
      { ok: false, reason: 'mapping_exception' },
    ]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Wave 2 — alert-side correlation writes
  // ─────────────────────────────────────────────────────────────

  // Helper: msearch response where a test doc matches alerts (with ids).
  const makeMsearchHits = (alertIds: string[]) => ({
    hits: {
      total: { value: alertIds.length },
      hits: alertIds.map((id) => ({ _id: id, _index: 'achilles-defender' })),
    },
  });

  it('emits alert-side bulk updates alongside test-doc updates when alerts match', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'bundle-uuid-A::T1204.002')]));
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makeMsearchHits(['alert-1', 'alert-2'])]),
    );
    // 1 test doc update + 2 alert-side updates = 3 update items
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.alertsMarkedCorrelated).toBe(2);

    const ops = mockBulk.mock.calls[0][0].operations;
    // Operation order: test-header, test-doc, alert1-header, alert1-doc, alert2-header, alert2-doc
    expect(ops).toHaveLength(6);

    // Test-doc update (unchanged behavior)
    expect(ops[0]).toEqual({ update: { _index: 'achilles-results-acme', _id: 'd1' } });
    expect(ops[1].doc.f0rtika.defender_detected).toBe(true);

    // Alert-side updates (new)
    expect(ops[2]).toEqual({ update: { _index: 'achilles-defender', _id: 'alert-1' } });
    expect(ops[3].doc.f0rtika.achilles_correlated).toBe(true);
    expect(ops[3].doc.f0rtika.achilles_test_uuid).toBe('bundle-uuid-A');
    expect(typeof ops[3].doc.f0rtika.achilles_matched_at).toBe('string');

    expect(ops[4]).toEqual({ update: { _index: 'achilles-defender', _id: 'alert-2' } });
    expect(ops[5].doc.f0rtika.achilles_test_uuid).toBe('bundle-uuid-A');
  });

  it('strips the `::<technique>` suffix from test_uuid for the alert-side achilles_test_uuid', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(
      makeScanResponse([eligibleDoc('d1', '92b0b4f6-a09b-4c7b-b593-31ce461f804c::T1204.002')]),
    );
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([makeMsearchHits(['alert-1'])]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    await service.runEnrichmentPass();

    const ops = mockBulk.mock.calls[0][0].operations;
    expect(ops[3].doc.f0rtika.achilles_test_uuid).toBe('92b0b4f6-a09b-4c7b-b593-31ce461f804c');
    expect(ops[3].doc.f0rtika.achilles_test_uuid).not.toContain('::');
  });

  it('deduplicates alert-side updates when multiple test docs match the same alert', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(
      makeScanResponse([
        eligibleDoc('d1', 'bundle-X::T1'),
        eligibleDoc('d2', 'bundle-X::T2'),
      ]),
    );
    // Both test docs match the same single alert (the orchestrator binary on the same host)
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([
        makeMsearchHits(['shared-alert-id']),
        makeMsearchHits(['shared-alert-id']),
      ]),
    );
    // 2 test updates + 1 alert update (dedup) = 3 items
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(2);
    expect(result.alertsMarkedCorrelated).toBe(1);

    const ops = mockBulk.mock.calls[0][0].operations;
    // Exactly 2 test-doc updates (4 entries) + 1 alert-side update (2 entries) = 6
    expect(ops).toHaveLength(6);

    // Collect all alert-side update headers
    const alertHeaders = ops.filter(
      (op: any) => op.update && op.update._index === 'achilles-defender',
    );
    expect(alertHeaders).toHaveLength(1);
    expect(alertHeaders[0].update._id).toBe('shared-alert-id');
  });

  it('emits no alert-side updates when msearch returns total>0 but empty hits array', async () => {
    // Defensive: some ES responses report totals without hits (e.g., aggregations).
    // Without hit ids we can't address an alert — skip alert-side writes gracefully.
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([{ hits: { total: { value: 1 }, hits: [] } }]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.alertsMarkedCorrelated).toBe(0);

    const ops = mockBulk.mock.calls[0][0].operations;
    // Only the test-doc update — no alert ops when hits array is empty
    expect(ops).toHaveLength(2);
  });

  it('msearch sub-query returns alert hits (size > 0) with _source limited to prevention_action', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 0 } } }]));

    await service.runEnrichmentPass();

    const searches = mockMsearch.mock.calls[0][0].searches;
    // searches[0] is the header, searches[1] is the body
    expect(searches[1].size).toBeGreaterThan(0);
    // Full _source is not pulled — only prevention_action (needed to flip
    // the prevention flags), the correlation receipt (re-check dedup) and
    // the evidence lists (multi-test alerts are no stage evidence); nothing else.
    expect(searches[1]._source).toEqual(['prevention_action', 'f0rtika.achilles_correlated', 'evidence_filenames', 'evidence_filepaths', 'evidence_file_verdicts', 'evidence_child_actions']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Stage-specific enrichment (defender_stage_detected)
  // ──────────────────────────────────────────────────────────────────────────

  // Doc with a control_id — exercises BOTH the wide and stage queries.
  const eligibleStageDoc = (id: string, bundleUuid: string, controlId: string) => ({
    _id: id,
    _index: 'achilles-results-acme',
    _source: {
      f0rtika: {
        test_uuid: `${bundleUuid}::${controlId}`,
        test_name: 'T',
        category: 'intel-driven',
        control_id: controlId,
      },
      routing: { event_time: '2026-05-12T12:19:13Z', hostname: 'LAP-PF1A47F0' },
    },
    sort: ['2026-05-12T12:19:13Z', 1],
  });

  it('queues TWO sub-queries per doc (wide + stage) when control_id is present', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', '6a2351ac-654a-4112-b378-e6919beef70d', 'T1562.001'),
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 0 } } }, // wide: no hits
      { hits: { total: { value: 0 } } }, // stage: no hits
    ]));

    await service.runEnrichmentPass();

    const searches = mockMsearch.mock.calls[0][0].searches;
    // 4 entries = 2 sub-queries × (header + body)
    expect(searches).toHaveLength(4);

    // First sub-query should reference filepath wildcards (wide query feature).
    // Second sub-query should reference the stage-binary prefix and NOT filepath.
    // The queries themselves (the request _source lists evidence fields for every sub-query).
    const firstBody  = JSON.stringify(searches[1].query);
    const secondBody = JSON.stringify(searches[3].query);
    expect(firstBody).toContain('evidence_filepaths');
    expect(secondBody).not.toContain('evidence_filepaths');
    expect(secondBody).toContain('6a2351ac-654a-4112-b378-e6919beef70d-t1562.001');
  });

  it('sets defender_stage_detected only when the narrow query matches', async () => {
    // Wide matches (bundle-level evidence found) but stage does NOT (no
    // per-stage binary in evidence). This is the TclBanker shape: alert
    // carries Stage 4's binary, so the wide query matches all stages via
    // bundle UUID, but the stage query only matches Stage 4's doc.
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', 'bf448c7a-307e-4458-ba36-341d6d8e671b', 'T1071.001'), // stage that should NOT match
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 1 }, hits: [{ _id: 'alert-a' }] } }, // wide: matches via UUID
      { hits: { total: { value: 0 } } },                              // stage: no per-stage binary match
    ]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([
      { ok: true },  // test-doc update
      { ok: true },  // alert-doc correlation update
    ]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.stageDetected).toBe(0);

    // The test-doc patch must include defender_detected but NOT defender_stage_detected.
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.defender_detected).toBe(true);
    expect(testPatch.defender_stage_detected).toBeUndefined();
  });

  it('sets both flags when the narrow stage query matches', async () => {
    // TclBanker Stage 4 (T1053.005) — evidence binary `<uuid>-t1053.005.exe`
    // matches both the wide and the stage query.
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', 'bf448c7a-307e-4458-ba36-341d6d8e671b', 'T1053.005'),
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 1 }, hits: [{ _id: 'alert-a' }] } }, // wide
      { hits: { total: { value: 1 }, hits: [{ _id: 'alert-a' }] } }, // stage (same alert)
    ]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([
      { ok: true }, // test patch
      { ok: true }, // alert correlation (deduped across both sub-queries)
    ]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.stageDetected).toBe(1);
    // Alert dedupe across sub-queries: the same alert_id from both queries
    // results in a single alert-side update.
    expect(result.alertsMarkedCorrelated).toBe(1);

    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.defender_detected).toBe(true);
    expect(testPatch.defender_stage_detected).toBe(true);
  });

  it('eligibility query selects docs missing EITHER flag (backfill path)', async () => {
    // A doc with defender_detected:true but no defender_stage_detected MUST
    // be re-scanned so the stage flag can be computed. The eligibility query
    // is a should[…] over missing-flag clauses with minimum_should_match:1.
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass();
    const scanQuery = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(scanQuery).toContain('defender_detected');
    expect(scanQuery).toContain('defender_stage_detected');
    expect(scanQuery).toContain('minimum_should_match');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Prevention-action detection (defender_prevented) — mirrors the
  // CrowdStrike enrichment rules (docs/defender-prevention-action-detection.md)
  // ──────────────────────────────────────────────────────────────────────────

  // msearch hit carrying a prevention_action in _source.
  const makePreventingMsearchHits = (alertIds: string[], action: string) => ({
    hits: {
      total: { value: alertIds.length },
      hits: alertIds.map((id) => ({ _id: id, _index: 'achilles-defender', _source: { prevention_action: action } })),
    },
  });

  it('stage-match alert with prevention_action blocked → test doc gains defender_prevented + action', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', 'bf448c7a-307e-4458-ba36-341d6d8e671b', 'T1053.005'),
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 0 } } },                                 // wide: no match
      makePreventingMsearchHits(['alert-a'], 'blocked'),                 // stage: preventing alert
    ]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(0);       // wide query did not match
    expect(result.stageDetected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.defender_detected).toBeUndefined();
    expect(testPatch.defender_stage_detected).toBe(true);
    expect(testPatch.defender_prevented).toBe(true);
    expect(testPatch.defender_prevention_action).toBe('blocked');
  });

  it('wide-match on a non-conclusive doc (exit 999) qualifies → defender_prevented set', async () => {
    // A stage killed mid-flight lands as 999 — wide matches MAY claim
    // prevention for it (docs/defender-prevention-action-detection.md).
    const service = createService();
    const base = eligibleDoc('d1', 'bundle-A::T1');
    const killedDoc = { ...base, _source: { ...base._source, event: { ERROR: 999 } } };
    mockSearch.mockResolvedValueOnce(makeScanResponse([killedDoc]));
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makePreventingMsearchHits(['alert-1'], 'process_killed')]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.defender_detected).toBe(true);
    expect(testPatch.defender_prevented).toBe(true);
    expect(testPatch.defender_prevention_action).toBe('process_killed');
  });

  it('wide-match on a conclusive-executed doc (exit 101) does NOT claim prevention', async () => {
    // The stage ran to completion on its own — a bundle-level alert match
    // carrying a prevention disposition belongs to a sibling stage's kill,
    // not to this one.
    const service = createService();
    const base = eligibleDoc('d1', 'bundle-A::T1');
    const executedDoc = { ...base, _source: { ...base._source, event: { ERROR: 101 } } };
    mockSearch.mockResolvedValueOnce(makeScanResponse([executedDoc]));
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makePreventingMsearchHits(['alert-1'], 'process_killed')]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.defender_detected).toBe(true);
    expect(testPatch.defender_prevented).toBeUndefined();
    expect(testPatch.defender_prevention_action).toBeUndefined();
  });

  it('detection-only matched alert → detected flags only, NO prevented fields', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'a::T1')]));
    // Alert hit with no prevention_action in _source (detection-only)
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makeMsearchHits(['alert-1'])]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.defender_detected).toBe(true);
    expect(testPatch.defender_prevented).toBeUndefined();
    expect(testPatch.defender_prevention_action).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Resolution-watermark re-fires (docs/edr-alert-refire-watermark.md)
  //
  // Defender aggregates repeat detections into one alert: a re-fire of an
  // already-resolved aggregated alert bumps lastUpdateDateTime but keeps
  // status=resolved. Branch (c) of buildAlertTimeWindowQuery re-admits these
  // when the update lands >60s after resolved_at.
  // ──────────────────────────────────────────────────────────────────────────

  // Evaluate the time-window clause the way ES would — same branch semantics
  // as the evidence-correlation tests (branch c's Painless watermark script
  // simulated: terminal + timestamp > resolved_at + 60s, both fields
  // required). The msearch mock then returns the alert only when the real
  // query would admit it, tying the window rule to the flag writes.
  const windowAdmits = (
    eventTime: string,
    alert: { timestamp?: string; created_at?: string; status?: string; resolved_at?: string },
  ): boolean => {
    const t = new Date(eventTime).getTime();
    const clause = buildAlertTimeWindowQuery(
      new Date(t - 5 * 60 * 1000).toISOString(),
      new Date(t + 30 * 60 * 1000).toISOString(),
    );
    const inWindow = (iso: string, gte: string, lte: string) => iso >= gte && iso <= lte;
    return ((clause.bool as any).should as any[]).some((s: any) => {
      if ('range' in s) {
        const [field, range] = Object.entries(s.range)[0] as [string, { gte: string; lte: string }];
        const val = (alert as any)[field];
        return typeof val === 'string' && inWindow(val, range.gte, range.lte);
      }
      if ('bool' in s) {
        const filters = s.bool.filter ?? [];
        const range = filters.find((f: any) => 'range' in f)?.range?.timestamp;
        const val = alert.timestamp;
        if (!range || typeof val !== 'string' || !inWindow(val, range.gte, range.lte)) return false;
        const excluded = s.bool.must_not?.[0]?.terms?.status ?? [];
        if (excluded.length) {
          return !(alert.status && excluded.includes(alert.status));
        }
        // Branch (c) — terminal + watermark
        const terms = filters.find((f: any) => 'terms' in f)?.terms?.status ?? [];
        if (!alert.status || !terms.includes(alert.status)) return false;
        if (typeof alert.resolved_at !== 'string') return false;
        return Date.parse(val) > Date.parse(alert.resolved_at) + 60_000;
      }
      return false;
    });
  };

  // Born-resolved aggregated alert: AV remediation completes at creation, so
  // resolved_at == created_at and there is no lifecycle bump path — every
  // post-creation update is evidence activity.
  const BORN_RESOLVED_ALERT = {
    _id: 'alert-born-resolved',
    created_at: '2026-05-10T09:00:00Z',
    resolved_at: '2026-05-10T09:00:00Z',
    status: 'resolved',
  };
  const STAGE_EVENT_TIME = '2026-05-12T12:19:13Z'; // eligibleStageDoc fixture time

  it('born-resolved aggregated alert whose timestamp re-fired during the run sets detected flags on the new doc', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', 'bf448c7a-307e-4458-ba36-341d6d8e671b', 'T1053.005'),
    ]));

    // The alert re-fired 3 minutes into the new run (status stays resolved).
    const alert = { ...BORN_RESOLVED_ALERT, timestamp: '2026-05-12T12:22:00Z' };
    // Sanity: the watermark rule admits this alert into the run's window.
    expect(windowAdmits(STAGE_EVENT_TIME, alert)).toBe(true);

    const hitResponse = makeMsearchHits([BORN_RESOLVED_ALERT._id]);
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([hitResponse, hitResponse])); // wide + stage
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    expect(result.stageDetected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    expect(ops[1].doc.f0rtika.defender_detected).toBe(true);
    expect(ops[1].doc.f0rtika.defender_stage_detected).toBe(true);
  });

  it('the same alert WITHOUT the post-resolution bump does not match (no flags)', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', 'bf448c7a-307e-4458-ba36-341d6d8e671b', 'T1053.005'),
    ]));

    // No re-fire: timestamp never moved past resolution.
    const alert = { ...BORN_RESOLVED_ALERT, timestamp: '2026-05-10T09:00:00Z' };
    expect(windowAdmits(STAGE_EVENT_TIME, alert)).toBe(false);

    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 0 }, hits: [] } },
      { hits: { total: { value: 0 }, hits: [] } },
    ]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(0);
    expect(result.stageDetected).toBe(0);
    expect(mockBulk).not.toHaveBeenCalled();
  });
});

// A Defender alert stays open for days and collects the evidence of every
// later run. With `runScopedEvidence` (the v9 re-sync has completed), a
// result is credited only from the alert's evidence items of its own run
// (edr/runEvidence.ts), at stage and test level.
describe('DefenderEnrichmentService — credit by run (runScopedEvidence)', () => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk } as any;
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [] });
  });

  // UUID-shaped: the test-level matcher only knows Achilles binaries by a UUID name.
  const B = 'b1000000-0000-4000-8000-0000000000b1';
  const STAGE_FILE = `${B}-t1003.exe`;
  const IN_RUN = '2026-10-20T09:59:20Z';
  const EARLIER = '2026-10-14T09:06:46Z';

  const resultDoc = (exit: number, over: { f0rtika?: Record<string, unknown>; routing?: Record<string, unknown> } = {}) => ({
    _id: 'r1',
    _index: 'achilles-results-org',
    _source: {
      f0rtika: { test_uuid: `${B}::T1003`, control_id: 'T1003', ...over.f0rtika },
      routing: { event_time: '2026-10-20T10:00:00Z', hostname: 'win-host-01', run_started_at: '2026-10-20T09:58:50Z', ...over.routing },
      event: { ERROR: exit },
    },
    sort: ['2026-10-20T10:00:00Z'],
  });
  const singleDoc = (routing: Record<string, unknown> = {}) => {
    const d = resultDoc(101, { f0rtika: { test_uuid: B }, routing });
    delete (d._source.f0rtika as Record<string, unknown>).control_id;
    return d;
  };

  type Item = {
    file: string; path: string | null; parent: string | null; parent_path: string | null;
    kind: 'process' | 'file'; verdict: string | null; action: string | null; started_at: string | null; added_at: string;
  };
  /** A process item of the stage binary, started at `started`. */
  const item = (started: string, over: Partial<Item> = {}): Item => ({
    file: STAGE_FILE, path: 'c:\\f0', parent: `${B}.exe`, parent_path: 'c:\\f0', kind: 'process',
    verdict: 'suspicious', action: null, started_at: started, added_at: new Date(Date.parse(started) + 90_000).toISOString(),
    ...over,
  });
  const rank: Record<string, number> = { malicious: 3, suspicious: 2, quarantined: 3, process_killed: 2, blocked: 1 };
  /** An alert as the v9 sync stores it: alert-wide fields over its whole history, plus the items. */
  const alertSource = (items: Item[] | null, extra: Record<string, unknown> = {}) => {
    const all = items ?? [];
    const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];
    const verdicts = new Map<string, { file: string; verdict: string; action: string | null }>();
    for (const i of all) {
      if (!i.verdict) continue;
      const prev = verdicts.get(i.file);
      verdicts.set(i.file, {
        file: i.file,
        verdict: prev && rank[prev.verdict] >= rank[i.verdict] ? prev.verdict : i.verdict,
        action: prev && (rank[prev.action ?? ''] ?? 0) >= (rank[i.action ?? ''] ?? 0) ? prev.action : i.action,
      });
    }
    const actions = all.map((i) => i.action).filter((a): a is string => !!a).sort((a, b) => rank[b] - rank[a]);
    return {
      evidence_filenames: uniq(all.flatMap((i) => [i.file, i.parent])),
      evidence_filepaths: uniq(all.flatMap((i) => [i.path, i.parent_path])),
      evidence_file_verdicts: [...verdicts.values()],
      evidence_child_actions: all.filter((i) => i.kind === 'process' && i.parent && i.action).map((i) => ({ parent: i.parent, action: i.action })),
      prevention_action: actions[0] ?? null,
      evidence_items: items,
      ...extra,
    };
  };
  const alertHits = (src: Record<string, unknown>) => ({ hits: { total: { value: 1 }, hits: [{ _id: 'alert-1', _source: src }] } });
  const none = { hits: { total: { value: 0 }, hits: [] } };

  type Mode = 'on' | 'off' | 'default constructor';
  const make = (mode: Mode) =>
    mode === 'default constructor'
      ? new DefenderEnrichmentService(client, 'achilles-results-*')
      : new DefenderEnrichmentService(client, 'achilles-results-*', { runScopedEvidence: mode === 'on' });

  /**
   * One pass over `doc`; returns the result doc's update (undefined when none).
   * Also checks that production fetches the fields the fixtures carry: the
   * scan reads whole result docs (routing.run_started_at included) and the
   * alert sub-queries ask for `evidence_items` exactly when run-scoped.
   */
  const pass = async (doc: unknown, responses: unknown[], mode: Mode = 'on') => {
    search.mockResolvedValueOnce({ hits: { hits: [doc] } });
    msearch.mockResolvedValueOnce({ responses });
    await make(mode).runEnrichmentPass({ batchSize: 200 });
    expect(search.mock.calls[0][0]._source).toBeUndefined();
    const bodies = (msearch.mock.calls[0][0].searches as any[]).filter((_, i) => i % 2 === 1);
    for (const b of bodies) expect(b._source.includes('evidence_items')).toBe(mode === 'on');
    const ops = (bulk.mock.calls[0]?.[0].operations ?? []) as any[];
    const at = ops.findIndex((o) => o.update?._id === 'r1');
    return at >= 0 ? (ops[at + 1].doc.f0rtika as Record<string, unknown>) : undefined;
  };

  it('an alert whose stage-file evidence is all from an earlier run gives no stage or test credit (exit 101)', async () => {
    const old = alertSource([item(EARLIER)]);
    const f = await pass(resultDoc(101), [alertHits(old), alertHits(old)]);
    expect(f?.defender_stage_detected).toBeUndefined();
    expect(f?.defender_detected).toBeUndefined();
  });

  it('the stage sub-response matched, the wide one has only earlier-run items too: no defender_detected', async () => {
    const stageAlert = alertSource([item(EARLIER), item(IN_RUN, { file: 'net.exe', path: 'c:\\windows\\system32', parent: 'explorer.exe', parent_path: 'c:\\windows' })]);
    const wideAlert = alertSource([item(EARLIER)]);
    const f = await pass(resultDoc(101), [alertHits(wideAlert), alertHits(stageAlert)]);
    expect(f?.defender_stage_detected).toBeUndefined();
    expect(f?.defender_detected).toBeUndefined();
  });

  it('one in-run item for the stage file: stage and test detected', async () => {
    const a = alertSource([item(EARLIER), item(IN_RUN)]);
    const f = await pass(resultDoc(101), [alertHits(a), alertHits(a)]);
    expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
  });

  it('exit 999, the kill is on an earlier run\'s item, the in-run item has no action: detected, not prevented', async () => {
    const a = alertSource([
      item(EARLIER, { verdict: 'malicious', action: 'process_killed' }),
      item(IN_RUN, { verdict: 'suspicious', action: null }),
    ]);
    expect(a.prevention_action).toBe('process_killed');
    const f = await pass(resultDoc(999), [alertHits(a), alertHits(a)]);
    expect(f).toMatchObject({ defender_stage_detected: true, defender_stage_prevented: false });
    expect(f?.defender_prevented).toBeUndefined();
    expect(f?.defender_prevention_action).toBeUndefined();
  });

  it('exit 999, the kill is on an in-run item: stage prevented', async () => {
    const a = alertSource([
      item(EARLIER, { verdict: 'suspicious' }),
      item(IN_RUN, { verdict: 'malicious', action: 'process_killed' }),
    ]);
    const f = await pass(resultDoc(999), [alertHits(a), alertHits(a)]);
    expect(f).toMatchObject({
      defender_stage_detected: true,
      defender_stage_prevented: true,
      defender_prevented: true,
      defender_prevention_action: 'process_killed',
    });
  });

  it('a single-binary test: an in-run item naming its binary detects it; only earlier-run items do not', async () => {
    const binary = (started: string) => item(started, { file: `${B}.exe`, parent: 'explorer.exe', parent_path: 'c:\\windows' });
    const inRun = await pass(singleDoc(), [alertHits(alertSource([binary(IN_RUN)]))]);
    expect(inRun).toMatchObject({ defender_detected: true });

    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [] });
    const old = await pass(singleDoc(), [alertHits(alertSource([binary(EARLIER)]))]);
    expect(old?.defender_detected).toBeUndefined();
  });

  it('the stage file only as the parent of an in-run net.exe item: stage detected', async () => {
    const a = alertSource([
      item(EARLIER),
      item(IN_RUN, { file: 'net.exe', path: 'c:\\windows\\system32', parent: STAGE_FILE, parent_path: 'c:\\f0' }),
    ]);
    const f = await pass(resultDoc(101), [alertHits(a), alertHits(a)]);
    expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
  });

  it('test level by path: an in-run file under the bundle-named folder detects the test; from an earlier run it does not', async () => {
    const bundle = { f0rtika: { bundle_name: 'BlueHammer Early-Stage Behavioral Pattern' } };
    const dropped = (added: string) => item(added, {
      file: 'payload.bin', path: 'c:\\users\\public\\bluehammersandbox', parent: null, parent_path: null,
      kind: 'file', started_at: null, added_at: added,
    });
    const inRun = await pass(resultDoc(101, bundle), [alertHits(alertSource([item(EARLIER), dropped('2026-10-20T10:05:00Z')])), none]);
    expect(inRun).toMatchObject({ defender_detected: true });

    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [] });
    const old = await pass(resultDoc(101, bundle), [alertHits(alertSource([item(EARLIER), dropped('2026-10-14T09:10:00Z')])), none]);
    expect(old?.defender_detected).toBeUndefined();

    // The path rule is for the test level only: the stage sub-query answered
    // with the same path-only alert gives the stage nothing.
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [] });
    const pathOnly = alertHits(alertSource([item(EARLIER), dropped('2026-10-20T10:05:00Z')]));
    const both = await pass(resultDoc(101, bundle), [pathOnly, pathOnly]);
    expect(both).toMatchObject({ defender_detected: true });
    expect(both).not.toHaveProperty('defender_stage_detected');
  });

  it('a result without routing.run_started_at keeps today\'s rule (credited by an earlier run\'s alert)', async () => {
    const a = alertSource([item(EARLIER)]);
    const f = await pass(resultDoc(101, { routing: { run_started_at: undefined } }), [alertHits(a), alertHits(a)]);
    expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
  });

  it('an alert with evidence_items: null keeps today\'s rule', async () => {
    const a = { ...alertSource([item(EARLIER)]), evidence_items: null };
    const f = await pass(resultDoc(101), [alertHits(a), alertHits(a)]);
    expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
  });

  it('the alert sub-queries fetch evidence_items only when run-scoped', async () => {
    await pass(resultDoc(101), [none, none], 'on');
    const on = msearch.mock.calls[0][0].searches[1]._source;
    expect(on).toEqual(['prevention_action', 'f0rtika.achilles_correlated', 'evidence_filenames', 'evidence_filepaths', 'evidence_file_verdicts', 'evidence_child_actions', 'evidence_items']);

    vi.clearAllMocks();
    await pass(resultDoc(101), [none, none], 'off');
    expect(msearch.mock.calls[0][0].searches[1]._source).not.toContain('evidence_items');

    vi.clearAllMocks();
    await pass(resultDoc(101), [none, none], 'default constructor');
    expect(msearch.mock.calls[0][0].searches[1]._source).not.toContain('evidence_items');
  });

  it('runScopedEvidence off (default constructor): an earlier run\'s alert credits as today', async () => {
    const a = alertSource([item(EARLIER)]);
    const f = await pass(resultDoc(101), [alertHits(a), alertHits(a)], 'default constructor');
    expect(f).toEqual({
      defender_detected: true,
      defender_stage_detected: true,
      defender_stage_prevented: false,
      defender_stage_rule: 'single_test',
      defender_evidence_rule: 'file_verdict',
    });
  });

  it('runScopedEvidence off: an earlier run\'s kill still prevents an error stage, as today', async () => {
    const a = alertSource([
      item(EARLIER, { verdict: 'malicious', action: 'process_killed' }),
      item(IN_RUN, { verdict: 'suspicious', action: null }),
    ]);
    const f = await pass(resultDoc(999), [alertHits(a), alertHits(a)], 'off');
    expect(f).toMatchObject({ defender_stage_prevented: true, defender_prevented: true, defender_prevention_action: 'process_killed' });
  });

  // Stored results are re-checked once under the run rule (marker
  // defender_run_rule: 'run_activity'): a flag only an earlier run's evidence
  // supported is removed, through the existing one-time downgrade blocks.
  describe('re-check of stored results (RUN_RULE)', () => {
    /** Bulk answers every operation with `result` (ES: 'noop' when the update changes nothing). */
    const answerBulk = (result: 'updated' | 'noop') =>
      bulk.mockImplementation(async ({ operations }: { operations: any[] }) => ({
        items: operations.filter((o) => 'update' in o).map((o) => ({ update: { _id: o.update._id, result } })),
      }));
    /** A result an earlier pass flagged under the older rules (their markers on). */
    const stored = (exit: number, f0rtika: Record<string, unknown> = {}, routing: Record<string, unknown> = {}) =>
      resultDoc(exit, {
        f0rtika: {
          defender_detected: true,
          defender_stage_detected: true,
          defender_stage_prevented: false,
          defender_stage_rule: 'single_test',
          defender_evidence_rule: 'file_verdict',
          ...f0rtika,
        },
        routing,
      });
    const recheck = async (doc: unknown, responses: unknown[], mode: Mode = 'on') => {
      search.mockResolvedValueOnce({ hits: { hits: [doc] } });
      if (responses.length > 0) msearch.mockResolvedValueOnce({ responses });
      const result = await make(mode).runEnrichmentPass({ batchSize: 200 });
      const ops = (bulk.mock.calls[0]?.[0].operations ?? []) as any[];
      const at = ops.findIndex((o) => o.update?._id === 'r1');
      const f = at >= 0 ? (ops[at + 1].doc.f0rtika as Record<string, unknown>) : undefined;
      return { f, result };
    };
    const removed = (r: { stageDetectionsRemoved: number; detectionsRemoved: number; preventionsRemoved: number }) =>
      [r.stageDetectionsRemoved, r.detectionsRemoved, r.preventionsRemoved];
    const eligibleClauses = () => {
      const query = search.mock.calls.at(-1)![0].query as any;
      return query.bool.filter.at(-1).bool.should as unknown[];
    };
    beforeEach(() => {
      answerBulk('updated');
    });

    it("RUN_RULE is 'run_activity'", () => {
      expect(RUN_RULE).toBe('run_activity');
    });

    it("the eligibility clause excludes only results marked 'run_activity'", async () => {
      search.mockResolvedValue({ hits: { hits: [] } });
      await make('on').runEnrichmentPass();
      const clause = eligibleClauses().find((c) => JSON.stringify(c).includes('defender_run_rule')) as any;
      expect(clause.bool.must_not).toEqual([{ term: { 'f0rtika.defender_run_rule': 'run_activity' } }]);
    });

    it('the scan selects a flagged result with a run start that lacks the marker; the clause is absent when off', async () => {
      search.mockResolvedValue({ hits: { hits: [] } });
      await make('on').runEnrichmentPass();
      const clause = {
        bool: {
          filter: [
            {
              bool: {
                should: [
                  { term: { 'f0rtika.defender_detected': true } },
                  { term: { 'f0rtika.defender_stage_detected': true } },
                ],
                minimum_should_match: 1,
              },
            },
            { exists: { field: 'routing.run_started_at' } },
          ],
          must_not: [{ term: { 'f0rtika.defender_run_rule': 'run_activity' } }],
        },
      };
      expect(eligibleClauses()).toContainEqual(clause);

      for (const mode of ['off', 'default constructor'] as const) {
        await make(mode).runEnrichmentPass();
        expect(JSON.stringify(eligibleClauses())).not.toContain('defender_run_rule');
      }
    });

    it('every stage and wide alert item is from an earlier run (exit 101): both detection flags go, the marker is written', async () => {
      const old = alertSource([item(EARLIER)]);
      const { f, result } = await recheck(stored(101), [alertHits(old), alertHits(old)]);
      expect(f).toEqual({
        defender_stage_detected: false,
        defender_stage_prevented: false,
        defender_detected: false,
        // The existing blocks also clear prevention when the flags go (none was stored here).
        defender_prevented: false,
        defender_prevention_action: null,
        defender_run_rule: 'run_activity',
      });
      expect(removed(result)).toEqual([1, 1, 0]);
    });

    it('exit 999 prevented by an earlier run\'s kill: the prevention flags go too', async () => {
      const old = alertSource([item(EARLIER, { verdict: 'malicious', action: 'process_killed' })]);
      const doc = stored(999, {
        defender_stage_prevented: true,
        defender_prevented: true,
        defender_prevention_action: 'process_killed',
        defender_prevention_rule: 'in_run',
      });
      const { f, result } = await recheck(doc, [alertHits(old), alertHits(old)]);
      expect(f).toEqual({
        defender_stage_detected: false,
        defender_stage_prevented: false,
        defender_detected: false,
        defender_prevented: false,
        defender_prevention_action: null,
        defender_run_rule: 'run_activity',
      });
      expect(removed(result)).toEqual([1, 1, 1]);
    });

    it('exit 999, the stage\'s own kill was an earlier run\'s, a sibling stage\'s kill is in-run: only the stage prevention goes, and it counts', async () => {
      const a = alertSource([
        item(EARLIER, { verdict: 'malicious', action: 'process_killed' }),
        item(IN_RUN),
        item(IN_RUN, { file: `${B}-t1059.exe`, verdict: 'malicious', action: 'process_killed' }),
      ]);
      const doc = stored(999, {
        defender_stage_prevented: true,
        defender_prevented: true,
        defender_prevention_action: 'process_killed',
        defender_prevention_rule: 'in_run',
      });
      const { f, result } = await recheck(doc, [alertHits(a), alertHits(a)]);
      expect(f).toEqual({ defender_stage_prevented: false, defender_run_rule: 'run_activity' });
      expect(removed(result)).toEqual([0, 0, 1]);
    });

    it('a result that also lacks the older markers: the removals count whichever rule armed the block', async () => {
      const old = alertSource([item(EARLIER)]);
      const doc = stored(101, { defender_stage_rule: undefined, defender_evidence_rule: undefined });
      const { f, result } = await recheck(doc, [alertHits(old), alertHits(old)]);
      expect(f).toMatchObject({
        defender_stage_detected: false,
        defender_detected: false,
        defender_stage_rule: 'single_test',
        defender_evidence_rule: 'file_verdict',
        defender_run_rule: 'run_activity',
      });
      expect(removed(result)).toEqual([1, 1, 0]);
    });

    it('one in-run item still counts: only the marker is written', async () => {
      const a = alertSource([item(EARLIER), item(IN_RUN)]);
      const { f, result } = await recheck(stored(101), [alertHits(a), alertHits(a)]);
      expect(f).toEqual({ defender_run_rule: 'run_activity' });
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('no alert for it is in the index: only the marker is written', async () => {
      const doc = stored(999, { defender_prevented: true, defender_prevention_action: 'process_killed', defender_prevention_rule: 'in_run' });
      const { f, result } = await recheck(doc, [none, none]);
      expect(f).toEqual({ defender_run_rule: 'run_activity' });
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('the only matching alert has evidence_items: null: today\'s rule counts it, only the marker is written', async () => {
      const a = { ...alertSource([item(EARLIER)]), evidence_items: null };
      const { f, result } = await recheck(stored(101), [alertHits(a), alertHits(a)]);
      expect(f).toEqual({ defender_run_rule: 'run_activity' });
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('a result without routing.run_started_at is neither re-checked nor marked', async () => {
      const old = alertSource([item(EARLIER)]);
      const { f, result } = await recheck(stored(101, {}, { run_started_at: undefined }), [alertHits(old), alertHits(old)]);
      expect(f).toBeUndefined();
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('a result already re-checked (marker on) is not re-checked again', async () => {
      const old = alertSource([item(EARLIER)]);
      const { f, result } = await recheck(stored(101, { defender_run_rule: 'run_activity' }), [alertHits(old), alertHits(old)]);
      expect(f).toBeUndefined();
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('runScopedEvidence off: a stored result is not re-checked, not marked, and the counters stay 0', async () => {
      const old = alertSource([item(EARLIER)]);
      for (const mode of ['off', 'default constructor'] as const) {
        vi.clearAllMocks();
        answerBulk('updated');
        const { f, result } = await recheck(stored(101), [alertHits(old), alertHits(old)], mode);
        expect(f).toBeUndefined();
        expect(removed(result)).toEqual([0, 0, 0]);
      }
    });

    it('a new result flagged this pass gets the marker in the same update', async () => {
      const a = alertSource([item(IN_RUN)]);
      const { f, result } = await recheck(resultDoc(101), [alertHits(a), alertHits(a)]);
      expect(f).toEqual({
        defender_detected: true,
        defender_stage_detected: true,
        defender_stage_prevented: false,
        defender_stage_rule: 'single_test',
        defender_evidence_rule: 'file_verdict',
        defender_run_rule: 'run_activity',
      });
      expect(result).toMatchObject({ detected: 1, stageDetected: 1 });
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('a result no alert flags is not marked (nothing for the run rule to re-check)', async () => {
      const { f } = await recheck(resultDoc(101), [none, none]);
      expect(f).toBeUndefined();
    });

    it('exit 101 with an in-run kill: the re-check writes no prevention', async () => {
      const kill = alertSource([item(IN_RUN, { verdict: 'malicious', action: 'process_killed' })]);
      const { f } = await recheck(stored(101), [alertHits(kill), alertHits(kill)]);
      expect(f).toEqual({ defender_run_rule: 'run_activity' });

      vi.clearAllMocks();
      answerBulk('updated');
      const fresh = await recheck(resultDoc(101), [alertHits(kill), alertHits(kill)]);
      expect(fresh.f?.defender_prevented).toBeUndefined();
      expect(fresh.f?.defender_stage_prevented).toBe(false);
      expect(fresh.f?.defender_prevention_action).toBeUndefined();
      expect(fresh.f?.defender_run_rule).toBe('run_activity');
    });

    it('an update Elasticsearch answers noop is not counted as a removal', async () => {
      answerBulk('noop');
      const old = alertSource([item(EARLIER)]);
      const { f, result } = await recheck(stored(101), [alertHits(old), alertHits(old)]);
      expect(f).toMatchObject({ defender_stage_detected: false, defender_detected: false });
      expect(removed(result)).toEqual([0, 0, 0]);
    });

    it('a sub-query that failed this pass: the wide check still runs, but no marker (the next pass re-checks the stage)', async () => {
      const old = alertSource([item(EARLIER)]);
      const { f } = await recheck(stored(101), [alertHits(old), { error: { type: 'search_phase_execution_exception' } }]);
      expect(f).toMatchObject({ defender_detected: false });
      expect(f?.defender_stage_detected).toBeUndefined();
      expect(f?.defender_run_rule).toBeUndefined();
    });

    // Fix round 1. The marker vouches for flags evaluated by run: a pass
    // without a run view that sets a detection flag on a marked result clears
    // it (null), so the run rule re-checks that result once the flag is back.
    describe('the marker never outlives the flags it vouches for', () => {
      /** A result the run rule already downgraded (marker on, both detection flags false). */
      const downgraded = (routing: Record<string, unknown> = {}) =>
        stored(101, { defender_detected: false, defender_stage_detected: false, defender_run_rule: 'run_activity' }, routing);
      /** The stored doc after a partial update (ES merges the fields; null is stored as null). */
      const merged = (doc: ReturnType<typeof stored>, f: Record<string, unknown>) => ({
        ...doc,
        _source: { ...doc._source, f0rtika: { ...doc._source.f0rtika, ...f } },
      });

      it('a flag-off pass that re-flags a marked result clears the marker; the next flag-on pass re-checks it with counters', async () => {
        const old = alertSource([item(EARLIER)]);
        const doc = downgraded();
        const off = await recheck(doc, [alertHits(old), alertHits(old)], 'off');
        expect(off.f).toMatchObject({ defender_detected: true, defender_stage_detected: true, defender_run_rule: null });
        expect(removed(off.result)).toEqual([0, 0, 0]);

        vi.clearAllMocks();
        answerBulk('updated');
        const reflagged = merged(doc, off.f!);
        expect(reflagged._source.f0rtika).toMatchObject({ defender_detected: true, defender_run_rule: null });
        const on = await recheck(reflagged, [alertHits(old), alertHits(old)], 'on');
        expect(on.f).toMatchObject({
          defender_stage_detected: false,
          defender_detected: false,
          defender_run_rule: 'run_activity',
        });
        expect(removed(on.result)).toEqual([1, 1, 0]);
      });

      it('flag on but no run window: re-flagging a marked result also clears the marker', async () => {
        const old = alertSource([item(EARLIER)]);
        const { f } = await recheck(downgraded({ run_started_at: '2026-10-20T11:00:00Z' }), [alertHits(old), alertHits(old)], 'on');
        expect(f).toMatchObject({ defender_detected: true, defender_stage_detected: true, defender_run_rule: null });
      });

      // Final fix wave A2. The 72-hour late-prevention clause can set a
      // prevention flag on a marked, detected result in a flag-off pass, from
      // an earlier run's action: that clears the marker too.
      it('a flag-off pass that sets a prevention flag on a marked result clears the marker; the next flag-on pass removes it', async () => {
        const a = alertSource([
          item(EARLIER, { verdict: 'malicious', action: 'process_killed' }),
          item(IN_RUN, { verdict: 'suspicious', action: null }),
        ]);
        const doc = stored(999, { defender_prevention_rule: 'in_run', defender_run_rule: 'run_activity' });
        const off = await recheck(doc, [alertHits(a), alertHits(a)], 'off');
        expect(off.f).toEqual({
          defender_prevented: true,
          defender_prevention_action: 'process_killed',
          defender_stage_prevented: true,
          defender_run_rule: null,
        });

        vi.clearAllMocks();
        answerBulk('updated');
        const prevented = merged(doc, off.f!);
        const on = await recheck(prevented, [alertHits(a), alertHits(a)], 'on');
        // Selected again: the run clause matches a flagged result whose marker is not 'run_activity'.
        expect(JSON.stringify(eligibleClauses())).toContain('defender_run_rule');
        expect(on.f).toEqual({
          defender_stage_prevented: false,
          defender_prevented: false,
          defender_prevention_action: null,
          defender_run_rule: 'run_activity',
        });
        expect(removed(on.result)).toEqual([0, 0, 1]);
      });

      it('a flag-off pass that sets a prevention flag on an unmarked result writes no defender_run_rule key', async () => {
        const a = alertSource([item(EARLIER, { verdict: 'malicious', action: 'process_killed' })]);
        const { f } = await recheck(stored(999, { defender_prevention_rule: 'in_run' }), [alertHits(a), alertHits(a)], 'off');
        expect(f).toMatchObject({ defender_prevented: true, defender_stage_prevented: true });
        expect(f).not.toHaveProperty('defender_run_rule');
      });

      it('the other three vendors\' updates never carry a _run_rule key, prevention flags included', async () => {
        const { CrowdStrikeEnrichmentService } = await import('../../crowdstrike/enrichment.service.js');
        const { SentinelOneEnrichmentService } = await import('../../sentinelone/enrichment.service.js');
        const { SophosEnrichmentService } = await import('../../sophos/enrichment.service.js');
        const vendors = [
          ['crowdstrike', (c: any) => new CrowdStrikeEnrichmentService(c, 'achilles-results-*')],
          ['sentinelone', (c: any) => new SentinelOneEnrichmentService(c, 'achilles-results-*')],
          ['sophos', (c: any) => new SophosEnrichmentService(c, 'achilles-results-*')],
        ] as const;
        const kill = { hits: { total: { value: 1 }, hits: [{ _id: 'alert-1', _source: { prevention_action: 'process_killed' } }] } };
        for (const [prefix, makeVendor] of vendors) {
          for (const flags of [{}, { [`${prefix}_detected`]: true, [`${prefix}_stage_detected`]: true, [`${prefix}_stage_prevented`]: false }]) {
            vi.clearAllMocks();
            answerBulk('updated');
            search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999, { f0rtika: flags })] } });
            msearch.mockResolvedValueOnce({ responses: [kill, kill] });
            await makeVendor(client).runEnrichmentPass({ batchSize: 200 });
            const ops = (bulk.mock.calls[0]?.[0].operations ?? []) as any[];
            const at = ops.findIndex((o) => o.update?._id === 'r1');
            const f = ops[at + 1].doc.f0rtika as Record<string, unknown>;
            expect(f).toMatchObject({ [`${prefix}_prevented`]: true, [`${prefix}_stage_prevented`]: true });
            expect(Object.keys(f).filter((k) => k.endsWith('_run_rule'))).toEqual([]);
          }
        }
      });

      it('a flag-off pass that flags an unmarked result writes no defender_run_rule key', async () => {
        const old = alertSource([item(EARLIER)]);
        const { f } = await recheck(resultDoc(101), [alertHits(old), alertHits(old)], 'off');
        expect(f).toMatchObject({ defender_detected: true, defender_stage_detected: true });
        expect(f).not.toHaveProperty('defender_run_rule');
      });
    });

    // Fix round 1. A result the run clause selects but the pass cannot
    // evaluate by run gets the marker alone (its outcome under today's rule
    // cannot change: the reason comes from stored fields), so it is not
    // selected on every pass forever.
    describe('a selected result that cannot be evaluated by run gets the marker alone', () => {
      it.each([
        ['the run start is after the event time', { run_started_at: '2026-10-20T11:00:00Z' }],
        ['the run start is not a date string', { run_started_at: 'not-a-date' }],
        ['the run start is a number, not an ISO string', { run_started_at: 1_729_418_330_000 }],
      ])('no run window (%s): only the marker is written', async (_label, routing) => {
        const old = alertSource([item(EARLIER)]);
        const { f, result } = await recheck(stored(101, {}, routing), [alertHits(old), alertHits(old)]);
        expect(f).toEqual({ defender_run_rule: 'run_activity' });
        expect(removed(result)).toEqual([0, 0, 0]);
      });

      it('no alert query can be built (no hostname): only the marker is written, no alert search runs', async () => {
        const { f, result } = await recheck(stored(101, {}, { hostname: '' }), []);
        expect(msearch).not.toHaveBeenCalled();
        expect(f).toEqual({ defender_run_rule: 'run_activity' });
        expect(removed(result)).toEqual([0, 0, 0]);
      });

      it('no run window, but a sub-query did not answer: no marker', async () => {
        const old = alertSource([item(EARLIER)]);
        const { f } = await recheck(stored(101, {}, { run_started_at: 'not-a-date' }), [alertHits(old), { error: { type: 'search_phase_execution_exception' } }]);
        expect(f?.defender_run_rule).toBeUndefined();
      });

      it('an unflagged result that cannot be evaluated by run is not marked', async () => {
        const { f } = await recheck(resultDoc(101, { routing: { hostname: '' } }), []);
        expect(f).toBeUndefined();
      });

      it('runScopedEvidence off: such a result is not marked', async () => {
        const { f } = await recheck(stored(101, {}, { hostname: '' }), [], 'off');
        expect(f).toBeUndefined();
      });
    });

    // Final fix wave A6: which results lost a flag, counted as the removal counters are.
    describe('removedFlagDocs', () => {
      it('lists a result the re-check downgraded', async () => {
        const old = alertSource([item(EARLIER)]);
        const { result } = await recheck(stored(101), [alertHits(old), alertHits(old)]);
        expect(result.removedFlagDocs).toEqual(['r1']);
        expect(result.removedFlagDocsOmitted).toBeUndefined();
      });

      it('is empty when nothing was removed, and for an update Elasticsearch answers noop', async () => {
        const a = alertSource([item(EARLIER), item(IN_RUN)]);
        const kept = await recheck(stored(101), [alertHits(a), alertHits(a)]);
        expect(kept.result.removedFlagDocs).toEqual([]);

        vi.clearAllMocks();
        answerBulk('noop');
        const old = alertSource([item(EARLIER)]);
        const noop = await recheck(stored(101), [alertHits(old), alertHits(old)]);
        expect(noop.f).toMatchObject({ defender_detected: false });
        expect(noop.result.removedFlagDocs).toEqual([]);
        expect(noop.result.removedFlagDocsOmitted).toBeUndefined();
      });

      it('keeps at most 20 ids and counts the rest', async () => {
        const old = alertSource([item(EARLIER)]);
        const docs = Array.from({ length: 25 }, (_, n) => ({ ...stored(101), _id: `r${n + 1}` }));
        search.mockResolvedValueOnce({ hits: { hits: docs } });
        msearch.mockResolvedValueOnce({ responses: docs.flatMap(() => [alertHits(old), alertHits(old)]) });
        const result = await make('on').runEnrichmentPass({ batchSize: 200 });
        expect(result.detectionsRemoved).toBe(25);
        expect(result.removedFlagDocs).toEqual(Array.from({ length: 20 }, (_, n) => `r${n + 1}`));
        expect(result.removedFlagDocsOmitted).toBe(5);
      });

      it('is empty with the flag off', async () => {
        const old = alertSource([item(EARLIER)]);
        const { result } = await recheck(stored(101), [alertHits(old), alertHits(old)], 'off');
        expect(result.removedFlagDocs).toEqual([]);
      });
    });

    it('a failed update is not counted as a removal', async () => {
      bulk.mockImplementation(async ({ operations }: { operations: any[] }) => ({
        items: operations.filter((o) => 'update' in o).map(() => ({ update: { error: { reason: 'version conflict' } } })),
      }));
      const old = alertSource([item(EARLIER)]);
      const { result } = await recheck(stored(101), [alertHits(old), alertHits(old)]);
      expect(removed(result)).toEqual([0, 0, 0]);
      expect(result.removedFlagDocs).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // Alerts are also found by their activity span overlapping the run (each
  // way a named clause; Elasticsearch reports `matched_queries` on the hit). A
  // hit found by span only counts only through its evidence items: without an
  // item list it is treated as if the query had not returned it.
  describe('DefenderEnrichmentService — find by activity span', () => {
    const END = '2026-10-20T10:00:00Z';
    const RUN_START_MINUS_5 = '2026-10-20T09:53:50.000Z'; // resultDoc's run start 09:58:50 − 5 min
    const SPAN = ['activity_span'];
    const ALERT_TIME = ['alert_time'];
    const BOTH = ['alert_time', 'activity_span'];
    /** Today's prevention aggregation (unchanged; under `alert_time` in the span form). */
    const PREVENTION_AGG = {
      filter: { match_all: {} },
      aggs: { actions: { terms: { field: 'prevention_action', size: 10 } } },
    };
    type Hit = { _id: string; _source: Record<string, unknown>; matched_queries: string[] };
    const hit = (id: string, src: Record<string, unknown>, matched: string[]): Hit => ({ _id: id, _source: src, matched_queries: matched });
    const answer = (hs: Hit[], total = hs.length, aggregations?: Record<string, unknown>) => ({
      hits: { total: { value: total }, hits: hs },
      ...(aggregations ? { aggregations } : {}),
    });
    /** The alert sub-query bodies of the first msearch (wide first, then stage). */
    const bodies = () => (msearch.mock.calls[0][0].searches as any[]).filter((_, i) => i % 2 === 1);
    /** The bool clause named `name` anywhere in `node`, or undefined. */
    const named = (node: unknown, name: string): any => {
      if (!node || typeof node !== 'object') return undefined;
      if ((node as any).bool?._name === name) return node;
      for (const v of Object.values(node)) {
        const found = named(v, name);
        if (found) return found;
      }
      return undefined;
    };
    const answerBulk = () =>
      bulk.mockImplementation(async ({ operations }: { operations: any[] }) => ({
        items: operations.filter((o) => 'update' in o).map((o) => ({ update: { _id: o.update._id, result: 'updated' } })),
      }));
    /** One pass; the result doc's update, the alert ids stamped, and the pass result. */
    const run = async (doc: unknown, responses: unknown[], mode: Mode = 'on') => {
      search.mockResolvedValueOnce({ hits: { hits: [doc] } });
      msearch.mockResolvedValueOnce({ responses });
      const result = await make(mode).runEnrichmentPass({ batchSize: 200 });
      const ops = (bulk.mock.calls[0]?.[0].operations ?? []) as any[];
      const at = ops.findIndex((o) => o.update?._id === 'r1');
      const f = at >= 0 ? (ops[at + 1].doc.f0rtika as Record<string, unknown>) : undefined;
      const stamped = ops
        .map((o, i) => (o.update?._index === 'achilles-defender' ? { id: o.update._id, doc: ops[i + 1].doc } : null))
        .filter((x): x is { id: string; doc: any } => x !== null);
      return { f, result, stamped };
    };
    /** Flags an earlier pass stored (no run marker). */
    const storedFlags = {
      defender_detected: true,
      defender_stage_detected: true,
      defender_stage_prevented: false,
      defender_stage_rule: 'single_test',
      defender_evidence_rule: 'file_verdict',
    };
    beforeEach(() => {
      answerBulk();
    });

    it('passes the run start to both sub-queries when crediting by run', async () => {
      await run(resultDoc(101), [none, none]);
      const bs = bodies();
      expect(bs).toHaveLength(2);
      for (const b of bs) {
        const span = named(b.query, 'activity_span');
        expect(span).toBeDefined();
        const lastActivity = span.bool.filter.find((c: any) => c.range?.last_activity_at);
        expect(lastActivity.range.last_activity_at.gte).toBe(RUN_START_MINUS_5);
        expect(named(b.query, 'alert_time')).toBeDefined();
        expect(Object.keys(b.aggs)).toEqual(['alert_time']);
        expect(b.aggs.alert_time.filter).toEqual(defenderAlertTimeQuery(END));
        expect(b.aggs.alert_time.aggs.prevention).toEqual(PREVENTION_AGG);
      }
    });

    it('runScopedEvidence off: no span clause and today\'s aggregations', async () => {
      for (const mode of ['off', 'default constructor'] as const) {
        vi.clearAllMocks();
        await run(resultDoc(101), [none, none], mode);
        const [wide, stage] = bodies();
        for (const b of [wide, stage]) {
          expect(JSON.stringify(b)).not.toContain('activity_span');
          expect(b.aggs.alert_time).toBeUndefined();
          expect(b.aggs.prevention).toEqual(PREVENTION_AGG);
        }
        // Exactly today's queries: the builders got no run start.
        expect(wide.query).toEqual(buildDefenderEvidenceQuery({ test_uuid: `${B}::T1003`, routing_event_time: END, routing_hostname: 'win-host-01' }));
        expect(stage.query).toEqual(buildStageDefenderEvidenceQuery({ test_uuid: `${B}::T1003`, routing_event_time: END, routing_hostname: 'win-host-01', control_id: 'T1003' }));
      }
    });

    it('a result without a run start: no span clause', async () => {
      await run(resultDoc(101, { routing: { run_started_at: undefined } }), [none, none]);
      const [wide, stage] = bodies();
      for (const b of [wide, stage]) {
        expect(JSON.stringify(b)).not.toContain('activity_span');
        expect(JSON.stringify(b)).not.toContain('_name');
        expect(b.aggs.alert_time).toBeUndefined();
        expect(b.aggs.prevention).toEqual(PREVENTION_AGG);
      }
      expect(wide.query).toEqual(buildDefenderEvidenceQuery({ test_uuid: `${B}::T1003`, routing_event_time: END, routing_hostname: 'win-host-01' }));
      expect(stage.query).toEqual(buildStageDefenderEvidenceQuery({ test_uuid: `${B}::T1003`, routing_event_time: END, routing_hostname: 'win-host-01', control_id: 'T1003' }));
    });

    it('a span-only alert with an in-run item credits the stage', async () => {
      const a = hit('alert-1', alertSource([item(EARLIER), item(IN_RUN)]), SPAN);
      const { f, stamped } = await run(resultDoc(101), [answer([a]), answer([a])]);
      expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
      expect(stamped.map((s) => s.id)).toEqual(['alert-1']);
    });

    it('a single-binary test found by span only is credited at test level', async () => {
      const binary = item(IN_RUN, { file: `${B}.exe`, parent: 'explorer.exe', parent_path: 'c:\\windows' });
      const { f } = await run(singleDoc(), [answer([hit('alert-1', alertSource([binary]), SPAN)])]);
      expect(f).toMatchObject({ defender_detected: true });
    });

    it('a span-only alert with only other-run items is found and removes a stale flag', async () => {
      const a = hit('alert-1', alertSource([item(EARLIER)]), SPAN);
      const { f, result } = await run(resultDoc(101, { f0rtika: storedFlags }), [answer([a]), answer([a])]);
      expect(f).toMatchObject({ defender_stage_detected: false, defender_detected: false });
      expect(result.stageDetectionsRemoved).toBe(1);
      expect(result.detectionsRemoved).toBe(1);
      expect(result.removedFlagDocs).toContain('r1');
    });

    it('a span-only alert without an item list is treated as not returned', async () => {
      // Its alert-wide fields name the stage: today's rule would count it.
      const a = hit('alert-1', { ...alertSource([item(EARLIER)]), evidence_items: null }, SPAN);
      const { f, result, stamped } = await run(resultDoc(101, { f0rtika: storedFlags }), [answer([a]), answer([a])]);
      // As for a run with no alert in the index: no flag goes, the marker alone is written.
      expect(f).toEqual({ defender_run_rule: RUN_RULE });
      expect([result.stageDetectionsRemoved, result.detectionsRemoved, result.preventionsRemoved]).toEqual([0, 0, 0]);
      expect(result.removedFlagDocs).toEqual([]);
      expect(stamped).toEqual([]);
      expect(result.alertsMarkedCorrelated).toBe(0);
    });

    it('an alert-time alert without an item list still counts the old way', async () => {
      const a = hit('alert-1', { ...alertSource([item(EARLIER)]), evidence_items: null }, ALERT_TIME);
      const { f, stamped } = await run(resultDoc(101), [answer([a]), answer([a])]);
      expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
      expect(stamped.map((s) => s.id)).toEqual(['alert-1']);
    });

    it('mixed hits: the unusable one is dropped, the others decide', async () => {
      const unusable = hit('alert-1', { ...alertSource([item(EARLIER)]), evidence_items: null }, SPAN);
      const usable = hit('alert-2', alertSource([item(IN_RUN)]), ALERT_TIME);
      const { f, result, stamped } = await run(resultDoc(101), [answer([unusable, usable]), answer([unusable, usable])]);
      expect(f).toMatchObject({ defender_stage_detected: true, defender_detected: true });
      expect(stamped.map((s) => s.id)).toEqual(['alert-2']);
      expect(result.alertsMarkedCorrelated).toBe(1);
    });

    it('more matches than read, all read span-only, none by alert time', async () => {
      const read = Array.from({ length: 100 }, (_, n) => hit(`alert-${n + 1}`, alertSource([item(EARLIER)]), SPAN));
      const aggregations = {
        alert_time: { doc_count: 0, prevention: { doc_count: 0, actions: { buckets: [{ key: 'process_killed', doc_count: 1 }] } } },
      };
      const r = answer(read, 150, aggregations);
      const { f } = await run(resultDoc(999), [r, r]);
      expect(f?.defender_detected).toBeUndefined();
      expect(f?.defender_stage_detected).toBeUndefined();
      expect(f?.defender_prevented).toBeUndefined();
      expect(f?.defender_stage_prevented).toBeUndefined();
      expect(f?.defender_prevention_action).toBeUndefined();
    });

    it("a result marked 'run_evidence' is checked again and ends marked 'run_activity'", async () => {
      const a = hit('alert-1', alertSource([item(EARLIER)]), SPAN);
      const { f, result } = await run(resultDoc(101, { f0rtika: { ...storedFlags, defender_run_rule: 'run_evidence' } }), [answer([a]), answer([a])]);
      expect(f).toMatchObject({ defender_detected: false, defender_stage_detected: false, defender_run_rule: 'run_activity' });
      expect([result.stageDetectionsRemoved, result.detectionsRemoved]).toEqual([1, 1]);
    });

    it("a result marked 'run_evidence' with an in-run alert keeps its flags and gets the new mark", async () => {
      const a = hit('alert-1', alertSource([item(IN_RUN)]), SPAN);
      const { f } = await run(resultDoc(101, { f0rtika: { ...storedFlags, defender_run_rule: 'run_evidence' } }), [answer([a]), answer([a])]);
      expect(f).toEqual({ defender_run_rule: 'run_activity' });
    });

    it("a pass without a run view leaves a 'run_evidence' mark as it is", async () => {
      const a = alertSource([item(EARLIER)]);
      const doc = resultDoc(101, {
        f0rtika: { ...storedFlags, defender_detected: false, defender_stage_detected: false, defender_run_rule: 'run_evidence' },
      });
      const { f } = await run(doc, [answer([hit('alert-1', a, ALERT_TIME)]), answer([hit('alert-1', a, ALERT_TIME)])], 'off');
      expect(f).toMatchObject({ defender_detected: true, defender_stage_detected: true });
      expect(f).not.toHaveProperty('defender_run_rule');
    });

    it('more matches than read: unread alerts are the alert-time matches less the ones read', async () => {
      // 100 read: 40 found by alert time (and span), 60 by span only; none counts for this run.
      const read = Array.from({ length: 100 }, (_, n) =>
        hit(`alert-${n + 1}`, alertSource([item(EARLIER)]), n < 40 ? BOTH : SPAN));
      const aggregations = {
        alert_time: { doc_count: 40, prevention: { doc_count: 1, actions: { buckets: [{ key: 'process_killed', doc_count: 1 }] } } },
      };
      // 40 by alert time − 40 of them read = 0 unread: nothing counts the old way.
      const r = answer(read, 150, aggregations);
      const { f } = await run(resultDoc(999), [r, r]);
      expect(f?.defender_detected).toBeUndefined();
      expect(f?.defender_stage_detected).toBeUndefined();
      expect(f?.defender_prevented).toBeUndefined();
      expect(f?.defender_stage_prevented).toBeUndefined();
      expect(f?.defender_prevention_action).toBeUndefined();
    });

    it('more matches than read, some by alert time', async () => {
      // 100 read: 40 found by alert time (and span), 60 by span only; none counts for this run.
      const read = Array.from({ length: 100 }, (_, n) =>
        hit(`alert-${n + 1}`, alertSource([item(EARLIER)]), n < 40 ? BOTH : SPAN));
      const aggregations = {
        alert_time: { doc_count: 60, prevention: { doc_count: 1, actions: { buckets: [{ key: 'process_killed', doc_count: 1 }] } } },
      };
      // 60 by alert time − 40 of them read = 20 unread, which count the old way.
      const { f } = await run(resultDoc(999), [answer(read, 150, aggregations), none]);
      expect(f).toMatchObject({
        defender_detected: true,
        defender_prevented: true,
        defender_prevention_action: 'process_killed',
      });
    });

    // Unread matches found only by span were judged by nobody: one of them may
    // hold this run's evidence, so no stored flag is removed on their kind.
    describe('span-only matches left unread', () => {
      /** 100 span-only alerts read, all from an earlier run; `total` matched, none by alert time. */
      const earlierRunOnly = (total: number) => answer(
        Array.from({ length: 100 }, (_, n) => hit(`alert-${n + 1}`, alertSource([item(EARLIER)]), SPAN)),
        total,
        { alert_time: { doc_count: 0, prevention: { doc_count: 0, actions: { buckets: [] } } } },
      );

      it('span-only matches left unread: no flag is removed', async () => {
        const r = earlierRunOnly(150);
        const { f, result } = await run(resultDoc(101, { f0rtika: storedFlags }), [r, r]);
        expect(f?.defender_detected).not.toBe(false);
        expect(f?.defender_stage_detected).not.toBe(false);
        expect([result.stageDetectionsRemoved, result.detectionsRemoved, result.preventionsRemoved]).toEqual([0, 0, 0]);
        expect(result.removedFlagDocs).toEqual([]);
        // The result is still marked as checked.
        expect(f).toEqual({ defender_run_rule: RUN_RULE });
      });

      it('everything read: the same hits remove the flag', async () => {
        const r = earlierRunOnly(100);
        const { f, result } = await run(resultDoc(101, { f0rtika: storedFlags }), [r, r]);
        expect(f).toMatchObject({ defender_detected: false, defender_stage_detected: false, defender_run_rule: RUN_RULE });
        expect([result.stageDetectionsRemoved, result.detectionsRemoved]).toEqual([1, 1]);
      });

      it('unread span-only on the stage sub-query only: the stage flag stays, the test-level flag is still judged', async () => {
        const wide = answer([hit('alert-w', alertSource([item(EARLIER)]), SPAN)], 1);
        const { f, result } = await run(resultDoc(101, { f0rtika: storedFlags }), [wide, earlierRunOnly(150)]);
        expect(f?.defender_stage_detected).not.toBe(false);
        expect(f).toMatchObject({ defender_detected: false });
        expect([result.stageDetectionsRemoved, result.detectionsRemoved]).toEqual([0, 1]);
      });

      // Only the prevention check is armed here (run marker and the detection
      // markers on, no prevention marker), so it alone decides.
      const prevented = (exit: number) => resultDoc(exit, {
        f0rtika: {
          ...storedFlags, defender_stage_prevented: true, defender_prevented: true,
          defender_prevention_action: 'process_killed', defender_run_rule: RUN_RULE,
        },
      });

      it('prevention: the test-level kind unjudged (exit 999 reads it): `_prevented` stays, the judged stage kind still removes `_stage_prevented`', async () => {
        const { f, result } = await run(prevented(999), [earlierRunOnly(150), earlierRunOnly(100)]);
        expect(f?.defender_prevented).not.toBe(false);
        expect(f).not.toHaveProperty('defender_prevention_action');
        expect(f).toMatchObject({ defender_stage_prevented: false });
        expect(result.preventionsRemoved).toBe(1);
      });

      it('prevention: the stage kind unjudged (conclusive exit reads it): no prevention flag is removed', async () => {
        const { f, result } = await run(prevented(105), [earlierRunOnly(100), earlierRunOnly(150)]);
        expect(f?.defender_prevented).not.toBe(false);
        expect(f?.defender_stage_prevented).not.toBe(false);
        expect(f).not.toHaveProperty('defender_prevention_action');
        expect(result.preventionsRemoved).toBe(0);
      });
    });

    // An alert found only by span is stamped achilles_correlated (and so can
    // be auto-resolved) by this result only when it counts for the run.
    describe('which alerts are stamped', () => {
      it('a span-only alert that counts is stamped', async () => {
        const a = hit('alert-1', alertSource([item(IN_RUN)]), SPAN);
        const { stamped, result } = await run(resultDoc(101), [answer([a]), answer([a])]);
        expect(stamped).toHaveLength(1);
        expect(stamped[0]).toMatchObject({ id: 'alert-1', doc: { f0rtika: { achilles_correlated: true } } });
        expect(result.alertsMarkedCorrelated).toBe(1);
      });

      it('a span-only alert that does not count is not stamped', async () => {
        const a = hit('alert-1', alertSource([item(EARLIER)]), SPAN);
        const { f, stamped, result } = await run(resultDoc(101, { f0rtika: storedFlags }), [answer([a]), answer([a])]);
        expect(stamped).toEqual([]);
        expect(result.alertsMarkedCorrelated).toBe(0);
        // It was found and judged: the stale flags still go.
        expect(f).toMatchObject({ defender_stage_detected: false, defender_detected: false });
        expect([result.stageDetectionsRemoved, result.detectionsRemoved]).toEqual([1, 1]);
      });

      it('an alert-time alert that does not count is stamped as today', async () => {
        const a = hit('alert-1', alertSource([item(EARLIER)]), ALERT_TIME);
        const { stamped, result } = await run(resultDoc(101), [answer([a]), answer([a])]);
        expect(stamped).toHaveLength(1);
        expect(stamped[0]).toMatchObject({ id: 'alert-1', doc: { f0rtika: { achilles_correlated: true } } });
        expect(result.alertsMarkedCorrelated).toBe(1);
      });
    });
  });
});
