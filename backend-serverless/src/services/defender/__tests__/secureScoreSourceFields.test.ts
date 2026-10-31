import { describe, it, expect, vi } from 'vitest';

/**
 * Secure Score docs carry every control's score (~20 KB/day), so the two
 * readers request only the fields they map. The fake search below applies
 * `_source` filtering like Elasticsearch does: if a mapped field were left out
 * of the list, its value would come back 0/null and these tests would fail.
 */
const DOC = {
  doc_type: 'secure_score',
  timestamp: '2026-10-31T00:00:00Z',
  current_score: 41.5,
  max_score: 120,
  score_percentage: 34.6,
  average_comparative_score: 38.2,
  control_scores: Array.from({ length: 300 }, (_, i) => ({ controlName: `c${i}`, score: i, description: 'x'.repeat(50) })),
};

function applySource(doc: Record<string, unknown>, source: unknown): Record<string, unknown> {
  if (!Array.isArray(source)) return doc;
  return Object.fromEntries(Object.entries(doc).filter(([k]) => (source as string[]).includes(k)));
}

const searchMock = vi.fn(async (req: { _source?: unknown }) => ({
  hits: { total: { value: 1 }, hits: [{ _source: applySource(DOC, req._source) }] },
}));

vi.mock('../../analytics/client.js', () => ({ createEsClient: () => ({ search: searchMock }) }));
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getSettings = async () => ({ configured: true, connectionType: 'direct', node: 'http://x', indexPattern: 'p' });
    this.isConfigured = async () => true;
  }),
}));

const { DefenderAnalyticsService } = await import('../analytics.service.js');

describe('Secure Score readers request only the fields they map', () => {
  it('getSecureScoreTrend: full values from a field-filtered response, no control_scores', async () => {
    searchMock.mockClear();
    const [point] = await new DefenderAnalyticsService().getSecureScoreTrend(30);
    expect(point).toEqual({ date: DOC.timestamp, score: 41.5, maxScore: 120, percentage: 34.6 });
    expect(searchMock.mock.calls[0][0]._source).not.toContain('control_scores');
    expect(Array.isArray(searchMock.mock.calls[0][0]._source)).toBe(true);
  });

  it('getCurrentSecureScore: full values from a field-filtered response', async () => {
    searchMock.mockClear();
    const summary = await new DefenderAnalyticsService().getCurrentSecureScore();
    expect(summary).toEqual({ currentScore: 41.5, maxScore: 120, percentage: 34.6, averageComparative: 38.2 });
    expect(Array.isArray(searchMock.mock.calls[0][0]._source)).toBe(true);
  });
});
