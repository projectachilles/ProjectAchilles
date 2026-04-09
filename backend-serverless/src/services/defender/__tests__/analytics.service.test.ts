import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockSearch = vi.fn();

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = async () => ({
      configured: true,
      connectionType: 'node',
      node: 'http://localhost:9200',
      indexPattern: 'achilles-results-*',
    });
  },
}));

vi.mock('../../analytics/client.js', () => ({
  createEsClient: () => ({
    search: mockSearch,
  }),
}));

vi.mock('../index-management.js', () => ({
  DEFENDER_INDEX: 'achilles-defender',
}));

const { DefenderAnalyticsService } = await import('../analytics.service.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('DefenderAnalyticsService (serverless)', () => {
  let service: InstanceType<typeof DefenderAnalyticsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DefenderAnalyticsService();
  });

  // ── Detection correlation ────────────────────────────────────

  describe('getDetectionRate', () => {
    it('detects techniques with temporally correlated alerts', async () => {
      const hour = 3600000;
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();

      // Call 1: test executions by technique with hourly buckets
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              {
                key: 'T1003', doc_count: 5,
                by_hour: { buckets: [
                  { key: baseTime, doc_count: 3 },
                  { key: baseTime + hour, doc_count: 2 },
                ] },
              },
              {
                key: 'T1486', doc_count: 2,
                by_hour: { buckets: [
                  { key: baseTime + 10 * hour, doc_count: 2 },
                ] },
              },
            ],
          },
        },
      });

      // Call 2: alert techniques with hourly buckets
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              {
                key: 'T1003', doc_count: 3,
                by_hour: { buckets: [
                  { key: baseTime, doc_count: 2 },
                  { key: baseTime + hour, doc_count: 1 },
                ] },
              },
            ],
          },
        },
      });

      const result = await service.getDetectionRate(30, 60);

      expect(result.overall.testedTechniques).toBe(2);
      expect(result.overall.detectedTechniques).toBe(1);
      expect(result.overall.detectionRate).toBe(50);

      const t1003 = result.byTechnique.find((t: { technique: string }) => t.technique === 'T1003');
      expect(t1003).toBeDefined();
      expect(t1003!.detected).toBe(true);
      expect(t1003!.correlatedAlerts).toBeGreaterThan(0);

      const t1486 = result.byTechnique.find((t: { technique: string }) => t.technique === 'T1486');
      expect(t1486).toBeDefined();
      expect(t1486!.detected).toBe(false);
      expect(t1486!.correlatedAlerts).toBe(0);
    });

    it('returns zero detection rate when no tests exist', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });

      const result = await service.getDetectionRate(30, 60);

      expect(result.overall.testedTechniques).toBe(0);
      expect(result.overall.detectedTechniques).toBe(0);
      expect(result.overall.detectionRate).toBe(0);
      expect(result.byTechnique).toEqual([]);
    });

    it('excludes cyber-hygiene controls from test query', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });

      await service.getDetectionRate(30, 60);

      // First call is the test results query — should exclude cyber-hygiene
      const testQuery = mockSearch.mock.calls[0][0] as Record<string, unknown>;
      const bool = (testQuery.query as Record<string, unknown>).bool as Record<string, unknown>;
      expect(bool.must_not).toEqual([{ term: { 'f0rtika.category': 'cyber-hygiene' } }]);
    });

    it('sorts detected techniques before undetected', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();

      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1486', doc_count: 10, by_hour: { buckets: [{ key: baseTime, doc_count: 10 }] } },
              { key: 'T1003', doc_count: 2, by_hour: { buckets: [{ key: baseTime, doc_count: 2 }] } },
            ],
          },
        },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1003', doc_count: 1, by_hour: { buckets: [{ key: baseTime, doc_count: 1 }] } },
            ],
          },
        },
      });

      const result = await service.getDetectionRate(30, 60);

      expect(result.byTechnique[0].technique).toBe('T1003');
      expect(result.byTechnique[0].detected).toBe(true);
      expect(result.byTechnique[1].technique).toBe('T1486');
      expect(result.byTechnique[1].detected).toBe(false);
    });
  });

  describe('getAlertsForTest', () => {
    it('returns alerts matching techniques within time window', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 2 },
          hits: [
            {
              _source: {
                alert_id: 'a1',
                alert_title: 'Credential dumping detected',
                description: 'LSASS memory access',
                severity: 'high',
                status: 'new',
                category: 'CredentialAccess',
                service_source: 'MDE',
                mitre_techniques: ['T1003'],
                created_at: '2026-02-25T10:15:00Z',
                updated_at: '2026-02-25T10:15:00Z',
                resolved_at: null,
                recommended_actions: 'Investigate',
              },
            },
            {
              _source: {
                alert_id: 'a2',
                alert_title: 'Suspicious process',
                description: 'Unknown process behavior',
                severity: 'medium',
                status: 'new',
                category: 'Execution',
                service_source: 'MDE',
                mitre_techniques: ['T1003', 'T1059'],
                created_at: '2026-02-25T10:30:00Z',
                updated_at: '2026-02-25T10:30:00Z',
                resolved_at: null,
                recommended_actions: 'Review process',
              },
            },
          ],
        },
      });

      const result = await service.getAlertsForTest(
        ['T1003'],
        '2026-02-25T10:00:00Z',
        60,
      );

      expect(result.total).toBe(2);
      expect(result.alerts).toHaveLength(2);
      expect(result.matchedTechniques).toContain('T1003');
      expect(result.alerts[0].alert_id).toBe('a1');
      expect(result.alerts[1].alert_id).toBe('a2');
    });

    it('returns empty when no alerts match', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
      });

      const result = await service.getAlertsForTest(
        ['T1486'],
        '2026-02-25T10:00:00Z',
        60,
      );

      expect(result.total).toBe(0);
      expect(result.alerts).toEqual([]);
      expect(result.matchedTechniques).toEqual([]);
    });

    it('constructs correct time window in ES query', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
      });

      await service.getAlertsForTest(
        ['T1003', 'T1059'],
        '2026-02-25T12:00:00Z',
        30,
      );

      const searchCall = mockSearch.mock.calls[0][0];

      const rangeFilter = searchCall.query.bool.must.find(
        (f: Record<string, unknown>) => 'range' in f
      );
      expect(rangeFilter).toBeDefined();
      expect(rangeFilter.range.created_at.gte).toBe('2026-02-25T11:55:00.000Z');
      expect(rangeFilter.range.created_at.lte).toBe('2026-02-25T12:30:00.000Z');

      const termsFilter = searchCall.query.bool.must.find(
        (f: Record<string, unknown>) => 'terms' in f
      );
      expect(termsFilter).toBeDefined();
      expect(termsFilter.terms.mitre_techniques).toEqual(['T1003', 'T1059']);
    });
  });
});
