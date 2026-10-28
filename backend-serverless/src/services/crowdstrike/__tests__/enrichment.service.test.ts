import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../evidence-correlation.js', async () => {
  const actual = await vi.importActual('../evidence-correlation.js');
  return actual;
});

vi.mock('../index-management.js', () => ({
  CROWDSTRIKE_INDEX: 'achilles-crowdstrike',
}));

const { CrowdStrikeEnrichmentService } = await import('../enrichment.service.js');

describe('CrowdStrikeEnrichmentService', () => {
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
    return new CrowdStrikeEnrichmentService(mockClient, 'achilles-results-*');
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
    expect(scanQuery).toContain('crowdstrike_detected');
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
    expect(payload.doc.f0rtika.crowdstrike_detected).toBe(true);
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

  // 15. CrowdStrike index 404
  it('caught CrowdStrike index 404 during msearch is recorded and pass continues', async () => {
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

    // Run 2: scan returns empty (doc now has crowdstrike_detected:true, excluded by filter)
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
  // Alert-side correlation writes
  // ─────────────────────────────────────────────────────────────

  // Helper: msearch response where a test doc matches alerts (with ids).
  const makeMsearchHits = (alertIds: string[]) => ({
    hits: {
      total: { value: alertIds.length },
      hits: alertIds.map((id) => ({ _id: id, _index: 'achilles-crowdstrike' })),
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
    expect(ops[1].doc.f0rtika.crowdstrike_detected).toBe(true);

    // Alert-side updates (new)
    expect(ops[2]).toEqual({ update: { _index: 'achilles-crowdstrike', _id: 'alert-1' } });
    expect(ops[3].doc.f0rtika.achilles_correlated).toBe(true);
    expect(ops[3].doc.f0rtika.achilles_test_uuid).toBe('bundle-uuid-A');
    expect(typeof ops[3].doc.f0rtika.achilles_matched_at).toBe('string');

    expect(ops[4]).toEqual({ update: { _index: 'achilles-crowdstrike', _id: 'alert-2' } });
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
      (op: any) => op.update && op.update._index === 'achilles-crowdstrike',
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
    // crowdstrike_prevented on the test doc).
    expect(searches[1]._source).toEqual(['prevention_action']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Stage-specific enrichment (crowdstrike_stage_detected)
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
    const firstBody  = JSON.stringify(searches[1]);
    const secondBody = JSON.stringify(searches[3]);
    expect(firstBody).toContain('evidence_filepaths');
    expect(secondBody).not.toContain('evidence_filepaths');
    expect(secondBody).toContain('6a2351ac-654a-4112-b378-e6919beef70d-t1562.001');
  });

  it('sets crowdstrike_stage_detected only when the narrow query matches', async () => {
    // Wide matches (bundle-level evidence found) but stage does NOT (no
    // per-stage binary in evidence). The alert carries a different stage's
    // binary, so the wide query matches all stages via bundle UUID, but the
    // stage query only matches the doc whose binary actually appears.
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

    // The test-doc patch must include crowdstrike_detected but NOT crowdstrike_stage_detected.
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.crowdstrike_detected).toBe(true);
    expect(testPatch.crowdstrike_stage_detected).toBeUndefined();
  });

  it('sets both flags when the narrow stage query matches', async () => {
    // Evidence binary `<uuid>-t1053.005.exe` matches both the wide and the
    // stage query.
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
    expect(testPatch.crowdstrike_detected).toBe(true);
    expect(testPatch.crowdstrike_stage_detected).toBe(true);
  });

  it('eligibility query selects docs missing EITHER flag (backfill path)', async () => {
    // A doc with crowdstrike_detected:true but no crowdstrike_stage_detected MUST
    // be re-scanned so the stage flag can be computed. The eligibility query
    // is a should[…] over missing-flag clauses with minimum_should_match:1.
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([]));
    await service.runEnrichmentPass();
    const scanQuery = JSON.stringify(mockSearch.mock.calls[0][0].query);
    expect(scanQuery).toContain('crowdstrike_detected');
    expect(scanQuery).toContain('crowdstrike_stage_detected');
    expect(scanQuery).toContain('minimum_should_match');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Prevention-action detection (crowdstrike_prevented)
  // ──────────────────────────────────────────────────────────────────────────

  // msearch hit carrying a prevention_action in _source.
  const makePreventingMsearchHits = (alertIds: string[], action: string) => ({
    hits: {
      total: { value: alertIds.length },
      hits: alertIds.map((id) => ({ _id: id, _index: 'achilles-crowdstrike', _source: { prevention_action: action } })),
    },
  });

  it('wide-match alert with prevention_action process_killed on a non-conclusive doc → crowdstrike_prevented + action', async () => {
    const service = createService();
    const base = eligibleDoc('d1', 'bundle-A::T1');
    const killedDoc = { ...base, _source: { ...base._source, event: { ERROR: 999 } } };
    mockSearch.mockResolvedValueOnce(makeScanResponse([killedDoc]));
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makePreventingMsearchHits(['alert-1'], 'process_killed')]),
    );
    // 1 test-doc update + 1 alert-side update
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.crowdstrike_detected).toBe(true);
    expect(testPatch.crowdstrike_prevented).toBe(true);
    expect(testPatch.crowdstrike_prevention_action).toBe('process_killed');
  });

  it('wide-match preventing alert on a CONCLUSIVE-executed doc (101) → detected only, NO prevented', async () => {
    // Prod lesson (customer tenant, 2026-10-12): Falcon killed T1486 while sibling
    // stages had already exited 101 — those siblings must not be upgraded to
    // prevented by the bundle-level (wide) match.
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
    expect(testPatch.crowdstrike_detected).toBe(true);
    expect(testPatch.crowdstrike_prevented).toBeUndefined();
    expect(testPatch.crowdstrike_prevention_action).toBeUndefined();
  });

  it('stage-match alert with prevention_action blocked → test doc gains prevented flags alongside stage flag', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([
      eligibleStageDoc('d1', 'bf448c7a-307e-4458-ba36-341d6d8e671b', 'T1053.005'),
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([
      { hits: { total: { value: 0 } } },                                        // wide: no match
      makePreventingMsearchHits(['alert-a'], 'blocked'),                        // stage: preventing alert
    ]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(0);       // wide query did not match
    expect(result.stageDetected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.crowdstrike_detected).toBeUndefined();
    expect(testPatch.crowdstrike_stage_detected).toBe(true);
    expect(testPatch.crowdstrike_prevented).toBe(true);
    expect(testPatch.crowdstrike_prevention_action).toBe('blocked');
  });

  it('detection-only matched alert → detected flags only, NO prevented fields', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'bundle-A::T1')]));
    // Alert hit with no prevention_action in _source (detection-only)
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makeMsearchHits(['alert-1'])]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    const result = await service.runEnrichmentPass();

    expect(result.detected).toBe(1);
    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.crowdstrike_detected).toBe(true);
    expect(testPatch.crowdstrike_prevented).toBeUndefined();
    expect(testPatch.crowdstrike_prevention_action).toBeUndefined();
  });

  it('kill_failed does NOT count as prevention', async () => {
    const service = createService();
    mockSearch.mockResolvedValueOnce(makeScanResponse([eligibleDoc('d1', 'bundle-A::T1')]));
    mockMsearch.mockResolvedValueOnce(
      makeMsearchResponse([makePreventingMsearchHits(['alert-1'], 'kill_failed')]),
    );
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }, { ok: true }]));

    await service.runEnrichmentPass();

    const ops = mockBulk.mock.calls[0][0].operations;
    const testPatch = ops[1].doc.f0rtika;
    expect(testPatch.crowdstrike_detected).toBe(true);
    expect(testPatch.crowdstrike_prevented).toBeUndefined();
  });
});
