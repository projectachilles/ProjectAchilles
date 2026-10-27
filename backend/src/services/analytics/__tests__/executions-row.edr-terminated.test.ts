import { describe, it, expect, vi } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

// The execution row API (getPaginatedExecutions -> mapHitToExecution) must
// carry the EDR-kill fields the UI keys on (design spec §5.5).

const mockSearch = vi.fn();
const mockCount = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
    this.count = mockCount;
  }),
}));

vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService } = await import('../elasticsearch.js');

const settings: AnalyticsSettings = {
  connectionType: 'direct',
  node: 'http://localhost:9200',
  apiKey: 'test-key',
  indexPattern: 'achilles-results-*',
  configured: true,
};

const page = (source: Record<string, unknown>) => {
  mockCount.mockResolvedValue({ count: 1 });
  mockSearch.mockResolvedValue({ hits: { hits: [{ _id: 'x', _source: source }] } });
  return new ElasticsearchService(settings).getPaginatedExecutions({ page: 1, pageSize: 10 } as any);
};

describe('execution rows for EDR-killed runs', () => {
  it('returns the four kill fields', async () => {
    const res = await page({
      'f0rtika.test_uuid': 'u', 'event.ERROR': 126, 'f0rtika.is_protected': true,
      'f0rtika.edr_terminated': true,
      'f0rtika.edr_terminated_vendors': ['sentinelone', 'defender'],
      'f0rtika.edr_terminated_alert_ids': ['a1'],
      'f0rtika.stages_unknown': true,
    });
    expect(res.data[0]).toMatchObject({
      edr_terminated: true,
      edr_terminated_vendors: ['sentinelone', 'defender'],
      edr_terminated_alert_ids: ['a1'],
      stages_unknown: true,
    });
  });

  it('defaults the flags to false on an ordinary result', async () => {
    const res = await page({ 'f0rtika.test_uuid': 'u', 'event.ERROR': 101 });
    expect(res.data[0]).toMatchObject({ edr_terminated: false, stages_unknown: false });
    expect(res.data[0].edr_terminated_vendors).toBeUndefined();
  });
});
