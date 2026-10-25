import { describe, it, expect, vi, beforeEach } from 'vitest';

// SentinelOne reuses the CrowdStrike enrichment pass and analytics queries
// with its own index + flag prefix. These tests pin that wiring.

const mockSearch = vi.fn();
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = () => ({ configured: true, connectionType: 'node', node: 'http://localhost:9200', indexPattern: 'achilles-results-*' });
  },
}));
vi.mock('../../analytics/client.js', () => ({ createEsClient: () => ({ search: mockSearch }) }));
vi.mock('../../analytics/test-name-lookup.js', () => ({ resolveTestNames: async () => new Map() }));

const { CrowdStrikeEnrichmentService } = await import('../../crowdstrike/enrichment.service.js');
const { SentinelOneAnalyticsService } = await import('../analytics.service.js');

describe('SentinelOne enrichment (shared pass, sentinelone target)', () => {
  const search = vi.fn();
  const msearch = vi.fn();
  const bulk = vi.fn();
  const client = { search, msearch, bulk } as any;

  beforeEach(() => vi.clearAllMocks());

  const doc = {
    _id: 'r1',
    _index: 'achilles-results-org',
    _source: {
      f0rtika: { test_uuid: 'b1::T1003', control_id: 'T1003' },
      routing: { event_time: '2026-10-20T10:00:00Z', hostname: 'win-host-01' },
      event: { ERROR: 999 },
    },
    sort: ['2026-10-20T10:00:00Z'],
  };

  it('reads achilles-sentinelone and writes f0rtika.sentinelone_* flags + alert correlation', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [doc] } });
    msearch.mockResolvedValueOnce({
      responses: [
        { hits: { total: { value: 1 }, hits: [{ _id: 'threat-1', _source: { prevention_action: 'process_killed' } }] } },
        { hits: { total: { value: 1 }, hits: [{ _id: 'threat-1', _source: { prevention_action: 'process_killed' } }] } },
      ],
    });
    bulk.mockResolvedValueOnce({ items: [{ update: {} }, { update: {} }] });

    const svc = new CrowdStrikeEnrichmentService(client, 'achilles-results-*', { alertIndex: 'achilles-sentinelone', flagPrefix: 'sentinelone' });
    const result = await svc.runEnrichmentPass({ batchSize: 200 });

    expect(result).toMatchObject({ scanned: 1, detected: 1, stageDetected: 1, alertsMarkedCorrelated: 1, errors: [] });
    const eligibility = JSON.stringify(search.mock.calls[0][0].query);
    expect(eligibility).toContain('f0rtika.sentinelone_detected');
    expect(eligibility).not.toContain('crowdstrike');
    expect(msearch.mock.calls[0][0].searches[0]).toEqual({ index: 'achilles-sentinelone' });

    const ops = bulk.mock.calls[0][0].operations;
    expect(ops[1]).toEqual({ doc: { f0rtika: {
      sentinelone_detected: true,
      sentinelone_stage_detected: true,
      sentinelone_prevented: true,
      sentinelone_prevention_action: 'process_killed',
    } } });
    expect(ops[2]).toEqual({ update: { _index: 'achilles-sentinelone', _id: 'threat-1' } });
    expect(ops[3].doc.f0rtika).toMatchObject({ achilles_correlated: true, achilles_test_uuid: 'b1' });
  });

  it('a kill done by Achilles automatic mitigation is detection, never SentinelOne prevention', async () => {
    const receipt = { auto_mitigated: true, auto_mitigation_mode: 'enabled', auto_mitigation_action: 'kill' };
    const hits = [{ _id: 'threat-1', _source: { prevention_action: 'process_killed', f0rtika: receipt } }];
    search.mockResolvedValueOnce({ hits: { hits: [doc] } });
    msearch.mockResolvedValueOnce({ responses: [{ hits: { total: { value: 1 }, hits } }, { hits: { total: { value: 1 }, hits } }] });
    bulk.mockResolvedValueOnce({ items: [{ update: {} }, { update: {} }] });

    const svc = new CrowdStrikeEnrichmentService(client, 'achilles-results-*', { alertIndex: 'achilles-sentinelone', flagPrefix: 'sentinelone', ignoreAchillesMitigated: true });
    await svc.runEnrichmentPass({ batchSize: 200 });

    expect(msearch.mock.calls[0][0].searches[1]._source).toContain('f0rtika.auto_mitigated');
    expect(bulk.mock.calls[0][0].operations[1]).toEqual({ doc: { f0rtika: { sentinelone_detected: true, sentinelone_stage_detected: true } } });
  });

  it('a dry-run or failed auto-mitigation receipt does not hide a real SentinelOne prevention', async () => {
    const hits = [{ _id: 'threat-1', _source: { prevention_action: 'quarantined', f0rtika: { auto_mitigated: true, auto_mitigation_mode: 'dry_run' } } }];
    search.mockResolvedValueOnce({ hits: { hits: [doc] } });
    msearch.mockResolvedValueOnce({ responses: [{ hits: { total: { value: 1 }, hits } }, { hits: { total: { value: 1 }, hits } }] });
    bulk.mockResolvedValueOnce({ items: [{ update: {} }, { update: {} }] });

    const svc = new CrowdStrikeEnrichmentService(client, 'achilles-results-*', { alertIndex: 'achilles-sentinelone', flagPrefix: 'sentinelone', ignoreAchillesMitigated: true });
    await svc.runEnrichmentPass({ batchSize: 200 });

    expect(bulk.mock.calls[0][0].operations[1].doc.f0rtika).toMatchObject({ sentinelone_prevented: true, sentinelone_prevention_action: 'quarantined' });
  });

  it('keeps CrowdStrike as the default target', async () => {
    search.mockResolvedValueOnce({ hits: { hits: [] } });
    await new CrowdStrikeEnrichmentService(client, 'achilles-results-*').runEnrichmentPass();
    expect(JSON.stringify(search.mock.calls[0][0].query)).toContain('f0rtika.crowdstrike_detected');
  });
});

describe('SentinelOneAnalyticsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries achilles-sentinelone for alerts', async () => {
    mockSearch.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] }, aggregations: {} });
    await new SentinelOneAnalyticsService().getAlerts({});
    expect(mockSearch.mock.calls[0][0].index).toBe('achilles-sentinelone');
  });

  it('computes technique coverage from f0rtika.sentinelone_* flags', async () => {
    mockSearch.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] }, aggregations: {} });
    await new SentinelOneAnalyticsService().getTechniqueCoverage({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' });
    const all = JSON.stringify(mockSearch.mock.calls.map((c) => c[0]));
    expect(all).toContain('f0rtika.sentinelone_stage_detected');
    expect(all).not.toContain('crowdstrike_');
  });

  it('an alert Achilles mitigated reads as detected only: no prevention badge, not in the prevented facet', async () => {
    const receipt = { auto_mitigated: true, auto_mitigation_mode: 'enabled' };
    mockSearch.mockResolvedValue({ hits: { total: { value: 2 }, hits: [
      { _source: { alert_id: 't1', prevention_action: 'process_killed', f0rtika: receipt } },
      { _source: { alert_id: 't2', prevention_action: 'quarantined' } },
    ] }, aggregations: {} });
    const res = await new SentinelOneAnalyticsService().getAlerts({});
    expect(res.data.find((a) => a.alert_id === 't1')?.prevention_action).toBeUndefined();
    expect(res.data.find((a) => a.alert_id === 't2')?.prevention_action).toBe('quarantined');
    const facet = JSON.stringify(mockSearch.mock.calls.map((c) => c[0]));
    expect(facet).toContain('"f0rtika.auto_mitigation_mode":"enabled"');
  });

  it('has no ZTA-style posture score (empty, not invented)', async () => {
    const svc = new SentinelOneAnalyticsService();
    expect(await svc.getZtaScoreTrend(90)).toEqual([]);
    expect((await svc.getZtaScoreSummary()).timestamp).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('score comparison carries the Defense Score with ztaScore null', async () => {
    mockSearch.mockResolvedValueOnce({
      aggregations: { by_day: { buckets: [{ key_as_string: '2026-10-20T00:00:00.000Z', doc_count: 4, protected: { doc_count: 3 } }] } },
    });
    const res = await new SentinelOneAnalyticsService().getScoreComparison(30);
    expect(res).toEqual([{ date: '2026-10-20', defenseScore: 75, ztaScore: null }]);
  });
});
