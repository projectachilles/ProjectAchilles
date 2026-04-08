import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────

const mockSearch = vi.fn();

vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = () => ({
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

describe('DefenderAnalyticsService', () => {
  let service: InstanceType<typeof DefenderAnalyticsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DefenderAnalyticsService();
  });

  // ── Secure Score ─────────────────────────────────────────────

  describe('getCurrentSecureScore', () => {
    it('returns zero-state when no score exists', async () => {
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      const result = await service.getCurrentSecureScore();

      expect(result.currentScore).toBe(0);
      expect(result.maxScore).toBe(0);
      expect(result.percentage).toBe(0);
      expect(result.averageComparative).toBeNull();
    });

    it('returns score from latest secure_score document', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [{
            _source: {
              current_score: 45,
              max_score: 100,
              score_percentage: 45,
              average_comparative_score: 52.3,
            },
          }],
        },
      });

      const result = await service.getCurrentSecureScore();

      expect(result.currentScore).toBe(45);
      expect(result.maxScore).toBe(100);
      expect(result.percentage).toBe(45);
      expect(result.averageComparative).toBe(52.3);
    });
  });

  describe('getSecureScoreTrend', () => {
    it('returns trend points sorted by date', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { timestamp: '2026-02-25T00:00:00Z', current_score: 40, max_score: 100, score_percentage: 40 } },
            { _source: { timestamp: '2026-02-26T00:00:00Z', current_score: 45, max_score: 100, score_percentage: 45 } },
          ],
        },
      });

      const result = await service.getSecureScoreTrend(30);

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2026-02-25T00:00:00Z');
      expect(result[1].percentage).toBe(45);
    });
  });

  // ── Alerts ─────────────────────────────────────────────────

  describe('getAlertSummary', () => {
    it('returns severity/status breakdown and recent high alerts', async () => {
      // First call: aggregation query
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 15 }, hits: [] },
        aggregations: {
          by_severity: {
            buckets: [
              { key: 'high', doc_count: 5 },
              { key: 'medium', doc_count: 7 },
              { key: 'low', doc_count: 3 },
            ],
          },
          by_status: {
            buckets: [
              { key: 'new', doc_count: 8 },
              { key: 'resolved', doc_count: 7 },
            ],
          },
        },
      });

      // Second call: recent high alerts
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { alert_id: 'a1', alert_title: 'Ransomware', severity: 'high', created_at: '2026-02-27T10:00:00Z', service_source: 'MDE' } },
            { _source: { alert_id: 'a2', alert_title: 'Phishing', severity: 'high', created_at: '2026-02-27T09:00:00Z', service_source: 'MDO' } },
          ],
        },
      });

      const result = await service.getAlertSummary();

      expect(result.total).toBe(15);
      expect(result.bySeverity.high).toBe(5);
      expect(result.bySeverity.medium).toBe(7);
      expect(result.byStatus.new).toBe(8);
      expect(result.recentHigh).toHaveLength(2);
      expect(result.recentHigh[0].title).toBe('Ransomware');
    });
  });

  describe('getAlerts', () => {
    it('returns paginated alerts with filters', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 42 },
          hits: [
            {
              _source: {
                alert_id: 'a1',
                alert_title: 'Credential Access',
                description: 'Suspicious credential activity',
                severity: 'high',
                status: 'new',
                category: 'CredentialAccess',
                service_source: 'MDE',
                mitre_techniques: ['T1003'],
                created_at: '2026-02-27T10:00:00Z',
                updated_at: '2026-02-27T10:00:00Z',
                resolved_at: null,
                recommended_actions: 'Investigate the device',
              },
            },
          ],
        },
      });

      const result = await service.getAlerts({
        page: 2,
        pageSize: 10,
        severity: 'high',
        status: 'new',
      });

      expect(result.total).toBe(42);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].mitre_techniques).toEqual(['T1003']);

      // Verify the search was called with correct params
      const searchCall = mockSearch.mock.calls[0][0];
      expect(searchCall.from).toBe(10); // (page 2 - 1) * 10
      expect(searchCall.size).toBe(10);
    });
  });

  describe('getAlertTrend', () => {
    it('returns daily alert counts with severity breakdown', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          by_day: {
            buckets: [
              { key_as_string: '2026-02-25', doc_count: 5, high: { doc_count: 2 }, medium: { doc_count: 2 }, low: { doc_count: 1 } },
              { key_as_string: '2026-02-26', doc_count: 3, high: { doc_count: 1 }, medium: { doc_count: 1 }, low: { doc_count: 1 } },
            ],
          },
        },
      });

      const result = await service.getAlertTrend(7);

      expect(result).toHaveLength(2);
      expect(result[0].count).toBe(5);
      expect(result[0].high).toBe(2);
      expect(result[1].date).toBe('2026-02-26');
    });
  });

  // ── Controls ─────────────────────────────────────────────────

  describe('getControlProfiles', () => {
    it('returns controls sorted by rank', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _source: {
                control_name: 'RequireMFA',
                control_category: 'Identity',
                title: 'Require MFA for all users',
                implementation_cost: 'Low',
                user_impact: 'Moderate',
                rank: 1,
                threats: ['CredentialTheft', 'AccountCompromise'],
                deprecated: false,
                remediation_summary: 'Enable MFA via Conditional Access',
                action_url: 'https://portal.azure.com/...',
                max_score: 10,
                tier: 'Tier1',
              },
            },
          ],
        },
      });

      const result = await service.getControlProfiles({ deprecated: false });

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Require MFA for all users');
      expect(result[0].threats).toEqual(['CredentialTheft', 'AccountCompromise']);
      expect(result[0].max_score).toBe(10);
    });

    it('passes category filter to ES query', async () => {
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      await service.getControlProfiles({ category: 'Device' });

      const query = mockSearch.mock.calls[0][0].query.bool.must;
      expect(query).toContainEqual({ term: { control_category: 'Device' } });
    });
  });

  describe('getControlsByCategory', () => {
    it('returns category breakdown with total max scores', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          by_category: {
            buckets: [
              { key: 'Identity', doc_count: 8, total_max_score: { value: 45 } },
              { key: 'Device', doc_count: 5, total_max_score: { value: 30 } },
            ],
          },
        },
      });

      const result = await service.getControlsByCategory();

      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('Identity');
      expect(result[0].count).toBe(8);
      expect(result[0].totalMaxScore).toBe(45);
    });
  });

  // ── Cross-correlation ──────────────────────────────────────

  describe('getDefenseVsSecureScore', () => {
    it('merges defense and secure scores by date', async () => {
      // First call: getSecureScoreTrend (called internally)
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { timestamp: '2026-02-25T00:00:00Z', current_score: 40, max_score: 100, score_percentage: 40 } },
            { _source: { timestamp: '2026-02-26T00:00:00Z', current_score: 45, max_score: 100, score_percentage: 45 } },
          ],
        },
      });

      // Second call: defense score date histogram
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          by_day: {
            buckets: [
              { key_as_string: '2026-02-25T00:00:00.000Z', doc_count: 10, protected: { doc_count: 7 } },
              { key_as_string: '2026-02-27T00:00:00.000Z', doc_count: 5, protected: { doc_count: 4 } },
            ],
          },
        },
      });

      const result = await service.getDefenseVsSecureScore(30);

      // Should have 3 dates: Feb 25 (both), Feb 26 (secure only), Feb 27 (defense only)
      expect(result).toHaveLength(3);

      const feb25 = result.find((p) => p.date === '2026-02-25');
      expect(feb25).toBeDefined();
      expect(feb25!.secureScore).toBe(40);
      expect(feb25!.defenseScore).toBe(70); // 7/10 * 100

      const feb26 = result.find((p) => p.date === '2026-02-26');
      expect(feb26!.secureScore).toBe(45);
      expect(feb26!.defenseScore).toBeNull();

      const feb27 = result.find((p) => p.date === '2026-02-27');
      expect(feb27!.secureScore).toBeNull();
      expect(feb27!.defenseScore).toBe(80); // 4/5 * 100
    });
  });

  describe('getTechniqueOverlap', () => {
    it('returns only techniques present in both test results and alerts', async () => {
      // First call: test result techniques
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1003', doc_count: 5 },
              { key: 'T1059', doc_count: 3 },
              { key: 'T1486', doc_count: 2 }, // only in tests
            ],
          },
        },
      });

      // Second call: alert techniques
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1003', doc_count: 8 },
              { key: 'T1059', doc_count: 1 },
              { key: 'T1566', doc_count: 4 }, // only in alerts
            ],
          },
        },
      });

      const result = await service.getTechniqueOverlap();

      // Only T1003 and T1059 overlap (both in tests AND alerts)
      expect(result).toHaveLength(2);

      // Sorted by combined count: T1003 (5+8=13) > T1059 (3+1=4)
      expect(result[0].technique).toBe('T1003');
      expect(result[0].testResults).toBe(5);
      expect(result[0].defenderAlerts).toBe(8);

      expect(result[1].technique).toBe('T1059');
      expect(result[1].testResults).toBe(3);
      expect(result[1].defenderAlerts).toBe(1);
    });

    it('returns empty array when no overlap exists', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [{ key: 'T1486', doc_count: 2 }] } },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [{ key: 'T1566', doc_count: 4 }] } },
      });

      const result = await service.getTechniqueOverlap();
      expect(result).toEqual([]);
    });
  });

  // ── Detection correlation ────────────────────────────────────

  describe('getDetectionRate', () => {
    it('detects techniques with temporally correlated alerts', async () => {
      const hour = 3600000; // 1 hour in ms
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
                  { key: baseTime + 10 * hour, doc_count: 2 }, // far from any alerts
                ] },
              },
            ],
          },
        },
      });

      // Call 2: alert techniques with hourly buckets — T1003 has an alert near the test
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              {
                key: 'T1003', doc_count: 3,
                by_hour: { buckets: [
                  { key: baseTime, doc_count: 2 },  // same hour as test
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

      // T1003 detected, T1486 not
      const t1003 = result.byTechnique.find((t) => t.technique === 'T1003');
      expect(t1003).toBeDefined();
      expect(t1003!.detected).toBe(true);
      expect(t1003!.correlatedAlerts).toBeGreaterThan(0);

      const t1486 = result.byTechnique.find((t) => t.technique === 'T1486');
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

      // T1003 (detected) should come before T1486 (not detected) despite fewer tests
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

      // Sorted by proximity — a1 (15min away) before a2 (30min away)
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

      // Verify time window: -5 min to +30 min around test (11:55 to 12:30)
      const rangeFilter = searchCall.query.bool.must.find(
        (f: Record<string, unknown>) => 'range' in f
      );
      expect(rangeFilter).toBeDefined();
      expect(rangeFilter.range.updated_at.gte).toBe('2026-02-25T11:55:00.000Z');
      expect(rangeFilter.range.updated_at.lte).toBe('2026-02-25T12:30:00.000Z');

      // Verify techniques filter (fallback path — no hostname/binaryName provided)
      const termsFilter = searchCall.query.bool.must.find(
        (f: Record<string, unknown>) => 'terms' in f
      );
      expect(termsFilter).toBeDefined();
      expect(termsFilter.terms.mitre_techniques).toEqual(['T1003', 'T1059']);
    });
  });
});
