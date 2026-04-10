import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../evidence-correlation.js', async () => {
  const actual = await vi.importActual('../evidence-correlation.js');
  return actual;
});

vi.mock('../index-management.js', () => ({
  DEFENDER_INDEX: 'achilles-defender',
}));

const { DefenderEnrichmentService } = await import('../enrichment.service.js');

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
        ? { _index: 'achilles-results-tpsgl', result: 'updated' }
        : { error: { reason: i.reason ?? 'err' } },
    })),
  });

  const eligibleDoc = (id: string, uuid: string) => ({
    _id: id,
    _index: 'achilles-results-tpsgl',
    _source: {
      f0rtika: { test_uuid: uuid, test_name: 'T', category: 'intel-driven' },
      routing: { event_time: '2026-03-27T07:52:54Z', hostname: 'LT-TPL-L50' },
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
      _index: 'achilles-results-tpsgl',
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
      { ...eligibleDoc('d1', 'a::T1'), _index: 'achilles-results-tpsgl' },
    ]));
    mockMsearch.mockResolvedValueOnce(makeMsearchResponse([{ hits: { total: { value: 1 } } }]));
    mockBulk.mockResolvedValueOnce(makeBulkResponse([{ ok: true }]));

    await service.runEnrichmentPass();

    const header = mockBulk.mock.calls[0][0].operations[0];
    expect(header.update._index).toBe('achilles-results-tpsgl');
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
});
