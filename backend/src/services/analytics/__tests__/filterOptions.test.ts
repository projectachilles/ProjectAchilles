import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

const mockSearch = vi.fn();
vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: { search: typeof mockSearch }) {
    this.search = mockSearch;
  }),
}));
vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService } = await import('../elasticsearch.js');

const settings: AnalyticsSettings = {
  connectionType: 'direct',
  node: 'http://localhost:9200',
  apiKey: 'k',
  indexPattern: 'achilles-results-*',
  configured: true,
};

/** Buckets each terms field returns, whatever the request. */
const BUCKETS: Record<string, Array<{ key: string | number; doc_count: number }>> = {
  'f0rtika.test_name': [{ key: 'Test B', doc_count: 3 }, { key: 'Test A', doc_count: 9 }],
  'f0rtika.techniques': [{ key: 'T1059', doc_count: 4 }, { key: 'T1486', doc_count: 2 }],
  'routing.hostname': [{ key: 'host-2', doc_count: 1 }, { key: 'host-1', doc_count: 8 }],
  'f0rtika.category': [{ key: 'intel-driven', doc_count: 5 }, { key: 'cyber-hygiene', doc_count: 6 }],
  'f0rtika.severity': [{ key: 'low', doc_count: 2 }, { key: 'critical', doc_count: 1 }, { key: 'high', doc_count: 7 }],
  'f0rtika.threat_actor': [{ key: 'APT29', doc_count: 1 }, { key: 'LockBit', doc_count: 4 }],
  'f0rtika.tags': [{ key: 'servers', doc_count: 2 }, { key: 'group-a', doc_count: 3 }],
  'event.ERROR': [{ key: 126, doc_count: 4 }, { key: 101, doc_count: 9 }, { key: 999, doc_count: 1 }],
  'f0rtika.bundle_name': [{ key: 'Bundle X', doc_count: 1 }, { key: 'Bundle Y', doc_count: 2 }],
};

type Aggs = Record<string, { terms?: { field: string }; filter?: unknown; aggs?: Aggs }>;
function answer(aggs: Aggs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, agg] of Object.entries(aggs)) {
    if (agg.terms) out[name] = { buckets: BUCKETS[agg.terms.field] ?? [] };
    else if (agg.aggs) out[name] = { doc_count: 1, ...answer(agg.aggs) };
  }
  return out;
}

describe('ElasticsearchService.getFilterOptions', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockImplementation(async (req: { aggs: Aggs }) => ({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: answer(req.aggs),
    }));
  });

  it('returns exactly what the ten per-list methods return', async () => {
    const svc = new ElasticsearchService(settings);
    const expected = {
      tests: await svc.getAvailableTests(),
      techniques: await svc.getAvailableTechniques(),
      hostnames: await svc.getAvailableHostnames(),
      categories: await svc.getAvailableCategories(),
      severities: await svc.getAvailableSeverities(),
      threatActors: await svc.getAvailableThreatActors(),
      tags: await svc.getAvailableTags(),
      errorNames: await svc.getAvailableErrorNames(),
      errorCodes: await svc.getAvailableErrorCodes(),
      bundleNames: await svc.getAvailableBundleNames(),
    };
    expect(mockSearch).toHaveBeenCalledTimes(10);

    mockSearch.mockClear();
    expect(await svc.getFilterOptions()).toEqual(expected);
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('scopes only the eight param-aware lists to org and dates, like the per-list methods', async () => {
    const svc = new ElasticsearchService(settings);
    await svc.getFilterOptions({ org: 'org-1', from: 'now-30d' });

    const req = mockSearch.mock.calls[0][0];
    expect(req.size).toBe(0);
    const topFilter = JSON.stringify(req.query);
    expect(topFilter).not.toContain('org-1');
    expect(topFilter).not.toContain('now-30d');
    // tests / techniques sit outside the scoped filter (their endpoints take no params)
    expect(req.aggs.tests.terms.field).toBe('f0rtika.test_name');
    expect(JSON.stringify(req.aggs.techniques.filter)).not.toContain('org-1');
    const scoped = JSON.stringify(req.aggs.scoped.filter);
    expect(scoped).toContain('org-1');
    expect(scoped).toContain('now-30d');
  });

  it('applies no date or org filter when none is given', async () => {
    const svc = new ElasticsearchService(settings);
    await svc.getFilterOptions();
    const req = mockSearch.mock.calls[0][0];
    expect(JSON.stringify(req.aggs.scoped.filter)).not.toContain('routing.event_time');
  });
});
