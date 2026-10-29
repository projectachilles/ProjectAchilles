import { describe, it, expect, vi } from 'vitest';

vi.mock('../index-management.js', () => ({ SOPHOS_INDEX: 'achilles-sophos', ensureSophosIndex: vi.fn() }));

const { SophosAnalyticsService } = await import('../analytics.service.js');

describe('SophosAnalyticsService', () => {
  it('getPostureScoreTrend returns the last headline per day', async () => {
    const svc = new SophosAnalyticsService();
    const search = vi.fn().mockResolvedValue({ hits: { hits: [
      { _source: { timestamp: '2026-10-27T03:00:00.000Z', health: { headline: 50 } } },
      { _source: { timestamp: '2026-10-27T21:00:00.000Z', health: { headline: 70 } } },
      { _source: { timestamp: '2026-10-28T03:00:00.000Z', health: { headline: null } } },
      { _source: { timestamp: '2026-10-28T09:00:00.000Z', health: { headline: 65.5 } } },
      { _source: { timestamp: '2026-10-29T09:00:00.000Z', health: { headline: null } } },
    ] } });
    (svc as unknown as { getEsClient: () => unknown }).getEsClient = () => ({ search });
    const trend = await (svc as unknown as { getPostureScoreTrend(d: number): Promise<unknown> }).getPostureScoreTrend(30);
    expect(trend).toEqual([{ date: '2026-10-27', score: 70 }, { date: '2026-10-28', score: 65.5 }]);
    const q = JSON.stringify(search.mock.calls[0][0]);
    expect(q).toContain('achilles-sophos');
    expect(q).toContain('health_check');
  });
});
