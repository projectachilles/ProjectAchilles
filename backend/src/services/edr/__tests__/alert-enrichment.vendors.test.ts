import { describe, it, expect, vi, beforeEach } from 'vitest';

// The evidence-correlation pass is shared by every endpoint-EDR integration
// (edr/alert-enrichment.service.ts). These cases run once per vendor, so a
// change made for one vendor can't silently break another.

const { CrowdStrikeEnrichmentService } = await import('../../crowdstrike/enrichment.service.js');
const { SentinelOneEnrichmentService } = await import('../../sentinelone/enrichment.service.js');
const { SophosEnrichmentService } = await import('../../sophos/enrichment.service.js');

const VENDORS = [
  { name: 'CrowdStrike', prefix: 'crowdstrike', index: 'achilles-crowdstrike', make: (c: any) => new CrowdStrikeEnrichmentService(c, 'achilles-results-*') },
  { name: 'SentinelOne', prefix: 'sentinelone', index: 'achilles-sentinelone', make: (c: any) => new SentinelOneEnrichmentService(c, 'achilles-results-*') },
  { name: 'Sophos', prefix: 'sophos', index: 'achilles-sophos', make: (c: any) => new SophosEnrichmentService(c, 'achilles-results-*') },
] as const;

const resultDoc = (exit: number) => ({
  _id: 'r1',
  _index: 'achilles-results-org',
  _source: {
    f0rtika: { test_uuid: 'b1::T1003', control_id: 'T1003' },
    routing: { event_time: '2026-10-20T10:00:00Z', hostname: 'win-host-01' },
    event: { ERROR: exit },
  },
  sort: ['2026-10-20T10:00:00Z'],
});
const hits = (action?: string) => ({ hits: { total: { value: 1 }, hits: [{ _id: 'alert-1', _source: action ? { prevention_action: action } : {} }] } });
const none = { hits: { total: { value: 0 }, hits: [] } };

describe.each(VENDORS)('EDR alert enrichment — $name', ({ prefix, index, make }) => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk };
  beforeEach(() => {
    vi.clearAllMocks();
    bulk.mockResolvedValue({ items: [{ update: {} }, { update: {} }] });
  });

  it(`reads ${index} and looks for docs missing ${prefix}_* flags`, async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await make(client).runEnrichmentPass();
    const q = JSON.stringify(search.mock.calls[0][0].query);
    expect(q).toContain(`f0rtika.${prefix}_detected`);
    expect(q).toContain(`f0rtika.${prefix}_stage_detected`);
    for (const other of VENDORS.filter((v) => v.prefix !== prefix)) expect(q).not.toContain(`${other.prefix}_`);
  });

  it('does not scan edr_terminated docs', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await make(client).runEnrichmentPass();
    const q = JSON.stringify(search.mock.calls[0][0].query);
    expect(q).toContain('{"bool":{"must_not":[{"term":{"f0rtika.edr_terminated":true}}]}}');
  });

  it('a stage match with a confirmed action writes detected + stage + prevented flags, and correlates the alert', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('quarantined'), hits('quarantined')] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    expect(msearch.mock.calls[0][0].searches[0]).toEqual({ index });
    const ops = bulk.mock.calls[0][0].operations;
    expect(ops[1].doc.f0rtika).toEqual({
      [`${prefix}_detected`]: true,
      [`${prefix}_stage_detected`]: true,
      [`${prefix}_prevented`]: true,
      [`${prefix}_prevention_action`]: 'quarantined',
    });
    expect(ops[2]).toEqual({ update: { _index: index, _id: 'alert-1' } });
    expect(ops[3].doc.f0rtika).toMatchObject({ achilles_correlated: true, achilles_test_uuid: 'b1' });
  });

  it('a bundle-wide match never credits prevention to a stage that ran to completion (101)', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(101)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('process_killed'), none] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags).toEqual({ [`${prefix}_detected`]: true });
  });

  it('kill_failed is detection, never prevention', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [resultDoc(999)] } });
    msearch.mockResolvedValueOnce({ responses: [hits('kill_failed'), hits('kill_failed')] });
    await make(client).runEnrichmentPass({ batchSize: 200 });
    const flags = bulk.mock.calls[0][0].operations[1].doc.f0rtika;
    expect(flags[`${prefix}_prevented`]).toBeUndefined();
    expect(flags[`${prefix}_stage_detected`]).toBe(true);
  });
});
