import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attackSimulationExclusions } from '../../analytics/attack-simulation-filter.js';

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

const mockResolveTestNames = vi.fn(
  async (..._args: unknown[]) => new Map<string, { name: string; kind: 'test' | 'bundle' }>(),
);
vi.mock('../../analytics/test-name-lookup.js', () => ({
  resolveTestNames: (...args: unknown[]) => mockResolveTestNames(...args),
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
    it('returns severity/status breakdown plus recent high and medium alerts', async () => {
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

      // Second call: recent high alerts (Promise.all kicks these off in array order)
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { alert_id: 'a1', alert_title: 'Ransomware', severity: 'high', created_at: '2026-02-27T10:00:00Z', service_source: 'MDE' } },
            { _source: { alert_id: 'a2', alert_title: 'Phishing', severity: 'high', created_at: '2026-02-27T09:00:00Z', service_source: 'MDO' } },
          ],
        },
      });

      // Third call: recent medium alerts
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { alert_id: 'b1', alert_title: 'Office macro blocked', severity: 'medium', created_at: '2026-02-27T08:00:00Z', service_source: 'MDE' } },
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
      expect(result.recentMedium).toHaveLength(1);
      expect(result.recentMedium[0].title).toBe('Office macro blocked');
      expect(result.recentMedium[0].severity).toBe('medium');
    });

    it('requests up to 5 high and 5 medium alerts', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { by_severity: { buckets: [] }, by_status: { buckets: [] } },
      });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      await service.getAlertSummary();

      // Inspect the last two calls — order matches Promise.all array order
      const highCall = mockSearch.mock.calls[1][0];
      const mediumCall = mockSearch.mock.calls[2][0];
      expect(highCall.size).toBe(5);
      expect(highCall.query.bool.must).toContainEqual({ term: { severity: 'high' } });
      expect(mediumCall.size).toBe(5);
      expect(mediumCall.query.bool.must).toContainEqual({ term: { severity: 'medium' } });
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

    it('passes the technique filter through to the ES query with sub-technique support', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
      });

      await service.getAlerts({ techniques: ['T1059'] });

      const searchCall = mockSearch.mock.calls[0][0];
      const must = searchCall.query.bool.must;
      // Find the technique clause — it's a bool with should covering exact + prefix
      const techClause = must.find(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          'bool' in c &&
          Array.isArray((c as { bool: { should?: unknown[] } }).bool.should)
      );
      expect(techClause).toBeDefined();
      const should = (techClause as { bool: { should: unknown[]; minimum_should_match: number } })
        .bool.should;
      expect(should).toContainEqual({ term: { mitre_techniques: 'T1059' } });
      // Trailing dot is load-bearing — T10590 must NOT match
      expect(should).toContainEqual({ prefix: { mitre_techniques: 'T1059.' } });
    });

    it('surfaces auto-resolved fields from the nested f0rtika object', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [
            {
              _source: {
                alert_id: 'a1',
                alert_title: 'Auto-resolved alert',
                description: '',
                severity: 'medium',
                status: 'resolved',
                category: 'Execution',
                service_source: 'MDE',
                mitre_techniques: ['T1059'],
                created_at: '2026-05-12T10:00:00Z',
                updated_at: '2026-05-13T10:00:00Z',
                resolved_at: '2026-05-13T10:05:00Z',
                recommended_actions: '',
                f0rtika: {
                  auto_resolved: true,
                  auto_resolved_at: '2026-05-13T10:05:00Z',
                  auto_resolve_mode: 'enabled',
                },
              },
            },
          ],
        },
      });

      const result = await service.getAlerts({});

      expect(result.data[0].auto_resolved).toBe(true);
      expect(result.data[0].auto_resolved_at).toBe('2026-05-13T10:05:00Z');
      expect(result.data[0].auto_resolve_mode).toBe('enabled');
      expect(result.data[0].auto_resolve_error).toBeNull();
    });

    it('passes the receipt error through, so a skip-forever receipt is not shown as resolved', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a404', alert_title: 'Deleted upstream', severity: 'high', status: 'new', mitre_techniques: [],
          created_at: '2026-05-12T10:00:00Z', updated_at: '2026-05-12T10:00:00Z', resolved_at: null,
          f0rtika: { auto_resolved: true, auto_resolved_at: '2026-05-13T10:05:00Z', auto_resolve_mode: 'enabled', auto_resolve_error: 'not_found' },
        } }] },
      });
      const result = await service.getAlerts({});
      expect(result.data[0]).toMatchObject({ auto_resolved: true, auto_resolve_mode: 'enabled', auto_resolve_error: 'not_found' });
    });

    it('omits auto-resolve fields when the f0rtika object is absent', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [
            {
              _source: {
                alert_id: 'a2',
                alert_title: 'Untagged alert',
                description: '',
                severity: 'low',
                status: 'new',
                category: '',
                service_source: 'MDE',
                mitre_techniques: [],
                created_at: '2026-05-12T10:00:00Z',
                updated_at: '2026-05-12T10:00:00Z',
                resolved_at: null,
                recommended_actions: '',
                // no f0rtika key
              },
            },
          ],
        },
      });

      const result = await service.getAlerts({});

      expect(result.data[0].auto_resolved).toBeUndefined();
      expect(result.data[0].auto_resolved_at).toBeUndefined();
      expect(result.data[0].auto_resolve_mode).toBeUndefined();
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

  describe('getControlCorrelation', () => {
    it('returns zero count + no techniques for a control title with no curated mapping', async () => {
      const result = await service.getControlCorrelation('Some unrelated control', 30);
      expect(result.coveredTechniques).toEqual([]);
      expect(result.alertCount).toBe(0);
      // ES must not be hit when there's no mapping
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('builds an ES query with technique OR clauses + a 30d range filter', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 12 }, hits: [] },
      });

      const result = await service.getControlCorrelation(
        'Block executable content from email client and webmail',
        30,
      );

      expect(result.coveredTechniques).toEqual(['T1566', 'T1204']);
      expect(result.alertCount).toBe(12);

      const searchCall = mockSearch.mock.calls[0][0];
      expect(searchCall.size).toBe(0); // count-only query
      const must = searchCall.query.bool.must;
      expect(must).toContainEqual({ term: { doc_type: 'alert' } });
      expect(must).toContainEqual({ range: { created_at: { gte: 'now-30d/d' } } });

      // The technique should-clauses live in the filter bool.should
      const filter = searchCall.query.bool.filter as Array<{
        bool: { should: unknown[]; minimum_should_match: number };
      }>;
      expect(filter[0].bool.should).toContainEqual({ term: { mitre_techniques: 'T1566' } });
      expect(filter[0].bool.should).toContainEqual({ prefix: { mitre_techniques: 'T1566.' } });
      expect(filter[0].bool.should).toContainEqual({ term: { mitre_techniques: 'T1204' } });
      expect(filter[0].bool.should).toContainEqual({ prefix: { mitre_techniques: 'T1204.' } });
      expect(filter[0].bool.minimum_should_match).toBe(1);
    });
  });

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

    it('restricts the test-results query to attack simulations', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });

      await service.getTechniqueOverlap();

      // First ES call is the test-results aggregation — it must exclude
      // cyber-hygiene controls and skipped bundle stages.
      const testQuery = mockSearch.mock.calls[0][0] as Record<string, unknown>;
      const bool = (testQuery.query as Record<string, unknown>).bool as Record<string, unknown>;
      expect(bool.must_not).toEqual(attackSimulationExclusions());
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

      // T1003: 5 executions, all in hours with a nearby alert → 5 correlated.
      // T1486: 2 executions, far from any alert → 0 correlated.
      // Per-execution rate = 5 / 7 = 71.4%.
      expect(result.overall.testedTechniques).toBe(2);
      expect(result.overall.detectedTechniques).toBe(1);
      expect(result.overall.totalExecutions).toBe(7);
      expect(result.overall.correlatedExecutions).toBe(5);
      expect(result.overall.detectionRate).toBe(71.4);

      // T1003 detected, T1486 not
      const t1003 = result.byTechnique.find((t) => t.technique === 'T1003');
      expect(t1003).toBeDefined();
      expect(t1003!.detected).toBe(true);
      expect(t1003!.correlatedExecutions).toBe(5);

      const t1486 = result.byTechnique.find((t) => t.technique === 'T1486');
      expect(t1486).toBeDefined();
      expect(t1486!.detected).toBe(false);
      expect(t1486!.correlatedExecutions).toBe(0);
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
      expect(result.overall.totalExecutions).toBe(0);
      expect(result.overall.correlatedExecutions).toBe(0);
      expect(result.overall.detectionRate).toBe(0);
      expect(result.byTechnique).toEqual([]);
    });

    it('excludes cyber-hygiene controls and skipped bundle stages from test query', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: { techniques: { buckets: [] } },
      });

      await service.getDetectionRate(30, 60);

      // First call is the test results query. It must exclude cyber-hygiene
      // controls AND skipped bundle stages (bundle controls that exited 0,
      // i.e. never ran) — neither can be meaningfully "detected".
      const testQuery = mockSearch.mock.calls[0][0] as Record<string, unknown>;
      const bool = (testQuery.query as Record<string, unknown>).bool as Record<string, unknown>;
      expect(bool.must_not).toEqual(attackSimulationExclusions());
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

    it('credits a sub-technique test when only the parent technique has an alert (MITRE roll-up)', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();

      // Test: T1574.002 (DLL Side-Loading), 4 executions in one hour.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1574.002', doc_count: 4, by_hour: { buckets: [{ key: baseTime, doc_count: 4 }] } },
            ],
          },
        },
      });
      // Alert tagged with the PARENT T1574 only — no T1574.002 alert exists.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1574', doc_count: 1, by_hour: { buckets: [{ key: baseTime, doc_count: 1 }] } },
            ],
          },
        },
      });

      const result = await service.getDetectionRate(30, 60);

      const sub = result.byTechnique.find((t) => t.technique === 'T1574.002');
      expect(sub).toBeDefined();
      expect(sub!.detected).toBe(true);
      expect(sub!.correlatedExecutions).toBe(4);
      expect(result.overall.detectionRate).toBe(100);
    });

    it('does NOT credit a parent-technique test from a sub-technique alert (roll-up is one-directional)', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();

      // Test: T1574 (parent), 4 executions.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1574', doc_count: 4, by_hour: { buckets: [{ key: baseTime, doc_count: 4 }] } },
            ],
          },
        },
      });
      // Alert tagged with a sub-technique T1574.002 only.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1574.002', doc_count: 1, by_hour: { buckets: [{ key: baseTime, doc_count: 1 }] } },
            ],
          },
        },
      });

      const result = await service.getDetectionRate(30, 60);

      const parent = result.byTechnique.find((t) => t.technique === 'T1574');
      expect(parent).toBeDefined();
      expect(parent!.detected).toBe(false);
      expect(parent!.correlatedExecutions).toBe(0);
      expect(result.overall.detectionRate).toBe(0);
    });

    it('weights the detection rate by executions, not by technique count', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();
      const hour = 3600000;

      // T1003: 9 executions, all correlated. T1486: 1 execution, uncorrelated.
      // A technique-count rate would be 1/2 = 50%. The per-execution rate is
      // 9/10 = 90% — the metric must reflect attack volume, not catalog size.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1003', doc_count: 9, by_hour: { buckets: [{ key: baseTime, doc_count: 9 }] } },
              { key: 'T1486', doc_count: 1, by_hour: { buckets: [{ key: baseTime + 10 * hour, doc_count: 1 }] } },
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

      expect(result.overall.totalExecutions).toBe(10);
      expect(result.overall.correlatedExecutions).toBe(9);
      expect(result.overall.detectionRate).toBe(90);
      expect(result.overall.testedTechniques).toBe(2);
      expect(result.overall.detectedTechniques).toBe(1);
    });
  });

  describe('getAlertsForTest', () => {
    it('returns prevention_action and portal_url from the alert doc', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [{
            _source: {
              alert_id: 'p1', alert_title: 'Blocked', severity: 'high', status: 'resolved',
              created_at: '2026-02-25T10:01:00Z', updated_at: '2026-02-25T10:01:00Z',
              mitre_techniques: ['T1486'], prevention_action: 'blocked',
              portal_url: 'https://security.microsoft.com/alerts/p1',
            },
          }],
        },
      });
      const result = await service.getAlertsForTest(['T1486'], '2026-02-25T10:00:00Z', 30);
      expect(result.alerts[0]).toMatchObject({
        prevention_action: 'blocked',
        portal_url: 'https://security.microsoft.com/alerts/p1',
      });
    });

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

      // The time-window filter is now a bool/should over both `timestamp`
      // and `created_at` (see buildAlertTimeWindowQuery). Verify both
      // ranges carry the same -5 / +30 min bounds around the test time.
      const must = searchCall.query.bool.must as Array<Record<string, unknown>>;
      const windowWrapper = must.find((f: any) =>
        'bool' in f && Array.isArray(f.bool.should) && f.bool.should.some((s: any) =>
          'range' in s && 'created_at' in s.range,
        ),
      ) as any;
      expect(windowWrapper).toBeDefined();
      expect(windowWrapper.bool.minimum_should_match).toBe(1);

      const tsRange = windowWrapper.bool.should.find((s: any) => 'bool' in s)?.bool.filter
        .find((f: any) => 'range' in f && 'timestamp' in f.range);
      expect(windowWrapper.bool.should.find((s: any) => 'bool' in s)?.bool.must_not)
        .toEqual([{ terms: { status: ['resolved', 'closed'] } }]);
      expect(tsRange.range.timestamp.gte).toBe('2026-02-25T11:55:00.000Z');
      expect(tsRange.range.timestamp.lte).toBe('2026-02-25T12:30:00.000Z');

      const createdRange = windowWrapper.bool.should.find((s: any) => 'range' in s && 'created_at' in s.range);
      expect(createdRange.range.created_at.gte).toBe('2026-02-25T11:55:00.000Z');
      expect(createdRange.range.created_at.lte).toBe('2026-02-25T12:30:00.000Z');

      // Verify techniques filter (fallback path — no hostname/binaryName provided)
      const termsFilter = must.find((f: any) => 'terms' in f) as any;
      expect(termsFilter).toBeDefined();
      expect(termsFilter.terms.mitre_techniques).toEqual(['T1003', 'T1059']);
    });

    it('technique-only fallback stays technique-only when NO hostname is provided', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 0 }, hits: [] },
      });

      await service.getAlertsForTest(['T1003'], '2026-02-25T10:00:00Z', 60);

      const queryStr = JSON.stringify(mockSearch.mock.calls[0][0].query);
      expect(queryStr).toContain('mitre_techniques');
      expect(queryStr).not.toContain('evidence_hostnames');
    });

    it('technique-only fallback keeps the hostname filter when a hostname IS provided', async () => {
      // Fleet-wide simultaneous runs: without the host filter, a host whose
      // EDR stayed quiet would inherit sibling hosts' same-technique alerts
      // in the shared time window (observed in production, 2026-10-12).
      // Evidence tier (binaryName+hostname) misses; technique+hostname tier
      // misses; tier 3 must STILL be host-scoped.
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } }); // tier 1 (evidence)
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } }); // tier 2 (technique+host)
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } }); // tier 3

      await service.getAlertsForTest(
        ['T1486'],
        '2026-02-25T10:00:00Z',
        30,
        'SB11284',
        '92b0b4f6-a09b-4c7b-b593-31ce461f804c.exe',
      );

      expect(mockSearch).toHaveBeenCalledTimes(3);
      const tier3 = JSON.stringify(mockSearch.mock.calls[2][0].query);
      expect(tier3).toContain('mitre_techniques');
      expect(tier3).toContain('evidence_hostnames');
      expect(tier3).toContain('SB11284');
    });

    it('returns a re-fire-matched terminal alert with resolved_at populated (branch c)', async () => {
      // Resolution-watermark rule (docs/edr-alert-refire-watermark.md): a
      // born-resolved aggregated alert whose timestamp was bumped by a
      // re-fire during the run is matched via branch (c). The drill-down
      // must return it carrying its resolved_at (the frontend annotates it
      // as "re-fired", so the field must be present).
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [{
            _source: {
              alert_id: 'da91cdf52c',
              alert_title: 'Attempt to turn off Microsoft Defender Antivirus protection',
              description: '',
              severity: 'high',
              status: 'resolved',          // aggregated re-fire — never reopened
              category: 'DefenseEvasion',
              service_source: 'MDE',
              mitre_techniques: ['T1562.001'],
              created_at: '2026-10-10T09:00:00Z',
              updated_at: '2026-10-12T16:50:59Z',
              resolved_at: '2026-10-10T09:00:00Z', // born resolved
              recommended_actions: '',
            },
          }],
        },
      });

      const result = await service.getAlertsForTest(
        ['T1562.001'],
        '2026-10-12T16:47:00Z',
        30,
      );

      // The tier-3 (technique-only) query must embed the branch-(c)
      // watermark script — that's what admits this alert at all.
      const queryStr = JSON.stringify(mockSearch.mock.calls[0][0].query);
      expect(queryStr).toContain('toEpochMilli');
      expect(queryStr).toContain('resolved_at');

      expect(result.total).toBe(1);
      expect(result.alerts[0].alert_id).toBe('da91cdf52c');
      expect(result.alerts[0].status).toBe('resolved');
      expect(result.alerts[0].resolved_at).toBe('2026-10-10T09:00:00Z');
    });

    it('uses the shared evidence-correlation helper when binaryName + hostname + bundleName are provided', async () => {
      // Drift fix: the per-row drill-down must use the SAME query the
      // enrichment pass uses, otherwise badges and alert lists disagree.
      // Verifies the primary block delegates to buildDefenderEvidenceQuery
      // by checking for the helper's signature shape: a should[] containing
      // both bare and `.keyword` filename wildcards, and a filepath
      // bundle-name-token clause when bundle_name is provided.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a-eicar', alert_title: 'EICAR_Test_File prevented',
          description: '', severity: 'informational', status: 'resolved',
          category: 'Malware', service_source: 'MDE', mitre_techniques: [],
          created_at: '2026-05-03T19:01:05Z', updated_at: '2026-05-03T19:12:15Z',
          resolved_at: '2026-05-03T19:12:15Z', recommended_actions: '',
        } }] },
      });

      await service.getAlertsForTest(
        ['T1562.001'],
        '2026-05-03T19:12:00Z',
        30,
        'SBL3483',
        '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
        'BlueHammer Early-Stage Behavioral Pattern',
      );

      const searchCall = mockSearch.mock.calls[0][0];
      const must = searchCall.query.bool.must as any[];

      // Hostname clause: should[] with bare + .keyword variants
      const hostShould = must.find((c: any) =>
        'bool' in c && c.bool.should?.some((s: any) =>
          'wildcard' in s && (
            'evidence_hostnames' in s.wildcard
            || 'evidence_hostnames.keyword' in s.wildcard
          ),
        ),
      );
      expect(hostShould).toBeDefined();
      expect(hostShould.bool.minimum_should_match).toBe(1);

      // File-or-path should[] contains both filename wildcards AND filepath
      // bundle-name-token (`*bluehammer*`) — proves the helper is used and
      // bundle_name is being plumbed through.
      const fileOrPath = must.find((c: any) =>
        'bool' in c && c.bool.should?.some((s: any) =>
          'wildcard' in s && (
            'evidence_filepaths' in s.wildcard
            || 'evidence_filepaths.keyword' in s.wildcard
          ),
        ),
      );
      expect(fileOrPath).toBeDefined();
      const tokenClauses = fileOrPath.bool.should.filter((s: any) =>
        'wildcard' in s && (
          s.wildcard.evidence_filepaths?.value === '*bluehammer*'
          || s.wildcard['evidence_filepaths.keyword']?.value === '*bluehammer*'
        ),
      );
      expect(tokenClauses).toHaveLength(2);
    });

    // -----------------------------------------------------------------------
    // Per-alert stage/bundle attribution. Defender's evidence sometimes
    // identifies the precise stage binary (`<uuid>-<technique>.exe`) and
    // sometimes only the bundle (orchestrator UUID-only binary, dropped-file
    // path under a sandbox dir, etc.). The frontend needs that signal to
    // render alerts under the correct stage drill-down vs at the bundle
    // level. Classifier output: `attribution` + `attributed_control_id`.
    // -----------------------------------------------------------------------

    it('classifies an alert with <uuid>-<technique>.exe evidence as stage-attributable', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a-stage', alert_title: 'Wacatac blocked',
          description: '', severity: 'medium', status: 'resolved',
          category: 'Malware', service_source: 'MDE', mitre_techniques: [],
          created_at: '2026-04-28T12:20:12Z', updated_at: '2026-04-28T12:20:12Z',
          resolved_at: null, recommended_actions: '',
          evidence_filenames: ['5e59dd6a-6c87-4377-942c-ea9b5e054cb9-t1211-cfapi.exe'],
        } }] },
      });

      const result = await service.getAlertsForTest(
        ['T1211'],
        '2026-04-28T12:20:00Z',
        30,
        'SBL5708',
        '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
        'BlueHammer Early-Stage Behavioral Pattern',
      );

      expect(result.alerts[0].attribution).toBe('stage');
      expect(result.alerts[0].attributed_control_id).toBe('t1211-cfapi');
    });

    it('classifies an alert with only the orchestrator <uuid>.exe as bundle-attributable', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a-orch', alert_title: 'Orchestrator alert',
          description: '', severity: 'medium', status: 'resolved',
          category: 'Malware', service_source: 'MDE', mitre_techniques: [],
          created_at: '2026-04-28T12:20:12Z', updated_at: '2026-04-28T12:20:12Z',
          resolved_at: null, recommended_actions: '',
          evidence_filenames: ['5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe'],
        } }] },
      });

      const result = await service.getAlertsForTest(
        ['T1211'], '2026-04-28T12:20:00Z', 30, 'SBL5708',
        '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
        'BlueHammer Early-Stage Behavioral Pattern',
      );

      expect(result.alerts[0].attribution).toBe('bundle');
      expect(result.alerts[0].attributed_control_id).toBeUndefined();
    });

    it('classifies an EICAR-style alert (no UUID in any filename) as bundle-attributable', async () => {
      // Reproduces the live SBL3483 case: only a dropped-file name in evidence,
      // and only a bundle-named sandbox dir in the path. No bundle-UUID anywhere.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a-eicar', alert_title: 'EICAR_Test_File prevented',
          description: '', severity: 'informational', status: 'resolved',
          category: 'Malware', service_source: 'MDE', mitre_techniques: [],
          created_at: '2026-05-03T19:01:05Z', updated_at: '2026-05-03T19:12:15Z',
          resolved_at: '2026-05-03T19:12:15Z', recommended_actions: '',
          evidence_filenames: ['mimikatz_dump_win32_signature.txt'],
        } }] },
      });

      const result = await service.getAlertsForTest(
        ['T1562.001'], '2026-05-03T19:00:24Z', 30, 'SBL3483',
        '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
        'BlueHammer Early-Stage Behavioral Pattern',
      );

      expect(result.alerts[0].attribution).toBe('bundle');
      expect(result.alerts[0].attributed_control_id).toBeUndefined();
    });

    it('rejects a stage-binary attribution when the UUID prefix does not match the queried bundle', async () => {
      // Defense against false-positive attribution. If for some reason an alert's
      // evidence references a DIFFERENT bundle's stage binary (e.g. cross-test
      // contamination on a shared host), it must not be misattributed to the
      // queried bundle's stage. The classifier should fall back to 'bundle'.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a-cross', alert_title: 'Cross-bundle binary',
          description: '', severity: 'low', status: 'resolved',
          category: 'Malware', service_source: 'MDE', mitre_techniques: [],
          created_at: '2026-04-28T12:20:12Z', updated_at: '2026-04-28T12:20:12Z',
          resolved_at: null, recommended_actions: '',
          evidence_filenames: ['11111111-2222-3333-4444-555555555555-t9999.exe'],
        } }] },
      });

      const result = await service.getAlertsForTest(
        ['T1211'], '2026-04-28T12:20:00Z', 30, 'SBL5708',
        '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
        'BlueHammer Early-Stage Behavioral Pattern',
      );

      expect(result.alerts[0].attribution).toBe('bundle');
    });

    it('classifies stage-attributable when evidence has BOTH orchestrator and a stage binary', async () => {
      // When evidence carries multiple binaries (common for behavioral
      // detections that capture parent + image processes), prefer stage
      // attribution if any filename matches the stage pattern.
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: {
          alert_id: 'a-mixed', alert_title: 'Mixed evidence',
          description: '', severity: 'high', status: 'new',
          category: 'Malware', service_source: 'MDE', mitre_techniques: [],
          created_at: '2026-04-28T12:20:12Z', updated_at: '2026-04-28T12:20:12Z',
          resolved_at: null, recommended_actions: '',
          evidence_filenames: [
            '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
            '5e59dd6a-6c87-4377-942c-ea9b5e054cb9-t1211-vssenum.exe',
            'cmd.exe',
          ],
        } }] },
      });

      const result = await service.getAlertsForTest(
        ['T1211'], '2026-04-28T12:20:00Z', 30, 'SBL5708',
        '5e59dd6a-6c87-4377-942c-ea9b5e054cb9.exe',
        'BlueHammer Early-Stage Behavioral Pattern',
      );

      expect(result.alerts[0].attribution).toBe('stage');
      expect(result.alerts[0].attributed_control_id).toBe('t1211-vssenum');
    });
  });

  describe('getAlerts window, source and facets', () => {
    const emptyPage = { hits: { total: { value: 0 }, hits: [] } };
    const WINDOW = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' };

    it('filters organic as must_not achilles_correlated:true', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ source: 'organic' });

      const req = mockSearch.mock.calls[0][0];
      expect(req.post_filter.bool.filter).toContainEqual({
        bool: { must_not: [{ term: { 'f0rtika.achilles_correlated': true } }] },
      });
      expect(JSON.stringify(req.query)).not.toContain('achilles_correlated');
    });

    it('filters test as achilles_correlated:true', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ source: 'test' });

      const req = mockSearch.mock.calls[0][0];
      expect(req.post_filter.bool.filter).toContainEqual({ term: { 'f0rtika.achilles_correlated': true } });
    });

    it('ORs a comma severity list', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ severities: ['high', 'medium'] });

      const req = mockSearch.mock.calls[0][0];
      expect(req.post_filter.bool.filter).toContainEqual({ terms: { severity: ['high', 'medium'] } });
    });

    it('sends no post_filter when source is all and no severities are given', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ source: 'all', severities: [] });

      expect(mockSearch.mock.calls[0][0].post_filter).toBeUndefined();
    });

    it('applies created_at window when given and none when absent', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ window: WINDOW });
      await service.getAlerts({});

      const windowed = mockSearch.mock.calls[0][0].query.bool.must;
      expect(windowed).toContainEqual({ range: { created_at: { gte: WINDOW.from, lte: WINDOW.to } } });

      const unwindowed = mockSearch.mock.calls[1][0].query.bool.must;
      expect(unwindowed).toEqual([{ term: { doc_type: 'alert' } }]);
    });

    it('maps hostname, prevention, remediation_status, portal_url and correlation fields', async () => {
      mockResolveTestNames.mockResolvedValueOnce(new Map([['u1', { name: 'Ransomware chain', kind: 'bundle' as const }]]));
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [{
            _source: {
              alert_id: 'a1',
              alert_title: 'Ransomware note dropped',
              severity: 'high',
              status: 'new',
              created_at: '2026-10-01T10:00:00Z',
              evidence_hostnames: ['LAB-01', 'LAB-02'],
              prevention_action: 'process_killed',
              remediation_status: 'prevented',
              portal_url: 'https://x',
              f0rtika: { achilles_correlated: true, achilles_test_uuid: 'u1' },
            },
          }],
        },
      });

      const result = await service.getAlerts({});

      const item = result.data[0];
      expect(item.hostname).toBe('LAB-01');
      expect(item.prevention_action).toBe('process_killed');
      expect(item.remediation_status).toBe('prevented');
      expect(item.portal_url).toBe('https://x');
      expect(item.achilles_correlated).toBe(true);
      expect(item.achilles_test_uuid).toBe('u1');
      expect(item.achilles_test_name).toBe('Ransomware chain');
      expect(item.achilles_test_kind).toBe('bundle');
      expect(item.alert_title).toBe('Ransomware note dropped');

      expect(mockResolveTestNames).toHaveBeenCalledTimes(1);
      expect(mockResolveTestNames.mock.calls[0][1]).toBe('achilles-results-*');
      expect(mockResolveTestNames.mock.calls[0][2]).toEqual(['u1']);
    });

    it('maps a bare alert to hostname null and achilles_correlated false', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [{ _source: { alert_id: 'a2', severity: 'low' } }] },
      });

      const result = await service.getAlerts({});

      const item = result.data[0];
      expect(item.hostname).toBeNull();
      expect(item.achilles_correlated).toBe(false);
      expect(item.achilles_test_uuid).toBeUndefined();
      expect(item.achilles_test_name).toBeUndefined();
      expect(item.achilles_test_kind).toBeUndefined();
      expect(item.prevention_action).toBeUndefined();
      expect(item.remediation_status).toBeUndefined();
      expect(item.portal_url).toBeUndefined();
    });

    it('returns byProduct facet from service_source buckets', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 12 }, hits: [] },
        aggregations: {
          facet_source: {
            doc_count: 20,
            split: { buckets: { test: { doc_count: 8 }, organic: { doc_count: 12 } } },
          },
          facet_severity: {
            doc_count: 12,
            split: { buckets: [{ key: 'high', doc_count: 10 }, { key: 'low', doc_count: 2 }] },
          },
          facet_filtered: {
            doc_count: 12,
            auto_resolved: { doc_count: 3 },
            product: { buckets: [{ key: 'microsoftDefenderForEndpoint', doc_count: 9 }, { key: 'microsoftDefenderForOffice365', doc_count: 3 }] },
          },
          facet_linked_open: { doc_count: 999, split: { doc_count: 4 } },
        },
      });

      const result = await service.getAlerts({ source: 'organic', severities: ['high', 'low'] });

      expect(result.counts).toEqual({
        bySource: { all: 20, test: 8, organic: 12 },
        bySeverity: { high: 10, low: 2 },
        autoResolved: 3,
        linkedOpen: 4,
        byProduct: { microsoftDefenderForEndpoint: 9, microsoftDefenderForOffice365: 3 },
      });
      expect(result.counts.byPrevention).toBeUndefined();
    });

    it('scopes facets: source counts ignore source and severity, the strip honours source only', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({
        source: 'test', severities: ['high'], search: 'ransom', techniques: ['T1486'], window: WINDOW,
      });

      const req = mockSearch.mock.calls[0][0];
      const linked = { term: { 'f0rtika.achilles_correlated': true } };
      const sev = { terms: { severity: ['high'] } };
      // R15: bySource ignores source AND severity, so the feed's "All" equals the
      // alerts tile; the strip (bySeverity, vendor facet, autoResolved) honours
      // source and ignores severity. Severity only filters the hits.
      expect(req.aggs.facet_source.filter).toEqual({ match_all: {} });
      expect(req.aggs.facet_severity.filter.bool.filter).toEqual([linked]);
      expect(req.aggs.facet_filtered.filter.bool.filter).toEqual([linked]);
      expect(req.post_filter.bool.filter).toEqual([linked, sev]);
      expect(req.aggs.facet_filtered.aggs.product.terms.field).toBe('service_source');
      expect(req.aggs.facet_filtered.aggs.prevention).toBeUndefined();
      expect(req.aggs.facet_linked_open.global).toEqual({});
      const linkedOpen = JSON.stringify(req.aggs.facet_linked_open.aggs.split.filter);
      expect(linkedOpen).toContain('"created_at"');
      expect(linkedOpen).toContain('achilles_correlated');
      expect(linkedOpen).toContain('"resolved"');
      expect(linkedOpen).not.toContain('ransom');
      expect(linkedOpen).not.toContain('T1486');
      expect(linkedOpen).not.toContain('"severity"');
    });

    it('does not leak a status filter into the linkedOpen facet', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ status: 'inProgress', window: WINDOW });

      const req = mockSearch.mock.calls[0][0];
      expect(req.query.bool.must).toContainEqual({ term: { status: 'inProgress' } });
      const linkedOpen = JSON.stringify(req.aggs.facet_linked_open);
      expect(linkedOpen).not.toContain('inProgress');
      // Only the closed-state exclusion mentions status.
      expect(linkedOpen).toContain('"status":["resolved"]');
    });

    it('applies applied-only auto-resolve rule to the autoResolved facet', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({});

      const resolved = mockSearch.mock.calls[0][0].aggs.facet_filtered.aggs.auto_resolved.filter;
      expect(resolved.bool.filter).toEqual([
        { term: { 'f0rtika.auto_resolved': true } },
        { term: { 'f0rtika.auto_resolve_mode': 'enabled' } },
      ]);
      expect(resolved.bool.must_not).toEqual([{ exists: { field: 'f0rtika.auto_resolve_error' } }]);
    });

    it('keeps severity out of every facet (bySource carries no severity clause)', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      await service.getAlerts({ severities: ['critical', 'high'], window: WINDOW });

      const req = mockSearch.mock.calls[0][0];
      expect(JSON.stringify(req.aggs.facet_source)).not.toContain('"severity"');
      expect(JSON.stringify(req.aggs.facet_filtered.filter)).not.toContain('"severity"');
      expect(req.aggs.facet_source.filter).toEqual({ match_all: {} });
      expect(req.post_filter).toEqual({ bool: { filter: [{ terms: { severity: ['critical', 'high'] } }] } });
    });

    it('returns zeroed counts when aggregations are missing', async () => {
      mockSearch.mockResolvedValueOnce(emptyPage);

      const result = await service.getAlerts({});

      expect(result.counts).toEqual({
        bySource: { all: 0, test: 0, organic: 0 },
        bySeverity: {},
        autoResolved: 0,
        linkedOpen: 0,
        byProduct: {},
      });
    });
  });

  describe('getAlertSummary window and counts', () => {
    it('windows every summary query and returns facet counts', async () => {
      const WINDOW = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' };
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 5 }, hits: [] },
        aggregations: {
          by_severity: { buckets: [{ key: 'high', doc_count: 5 }] },
          by_status: { buckets: [] },
          facet_source: { doc_count: 5, split: { buckets: { test: { doc_count: 2 }, organic: { doc_count: 3 } } } },
          facet_filtered: {
            doc_count: 5,
            auto_resolved: { doc_count: 1 },
            product: { buckets: [{ key: 'MDE', doc_count: 5 }] },
          },
          facet_linked_open: { doc_count: 50, split: { doc_count: 2 } },
        },
      });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      const result = await service.getAlertSummary(WINDOW);

      const range = { range: { created_at: { gte: WINDOW.from, lte: WINDOW.to } } };
      for (const call of mockSearch.mock.calls) {
        expect(JSON.stringify(call[0].query)).toContain(JSON.stringify(range));
      }
      expect(result.counts.bySource).toEqual({ all: 5, test: 2, organic: 3 });
      expect(result.counts.linkedOpen).toBe(2);
      expect(result.counts.autoResolved).toBe(1);
      expect(result.counts.byProduct).toEqual({ MDE: 5 });
    });

    it('sends no created_at range when no window is given', async () => {
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] }, aggregations: {} });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      await service.getAlertSummary();

      for (const call of mockSearch.mock.calls) {
        expect(JSON.stringify(call[0].query)).not.toContain('created_at');
      }
    });
  });
  describe('getAlertTrend linked + window', () => {
    const bucket = { key_as_string: '2026-10-01T00:00:00.000Z', doc_count: 4, critical: { doc_count: 1 }, high: { doc_count: 1 }, medium: { doc_count: 1 }, low: { doc_count: 1 }, linked: { doc_count: 3 } };
    const respond = () => mockSearch.mockResolvedValueOnce({ hits: { total: { value: 4 }, hits: [] }, aggregations: { by_day: { buckets: [bucket] } } });

    it('getAlertTrend adds linked from a correlated sub-aggregation', async () => {
      respond();
      const result = await service.getAlertTrend(30);
      const body = mockSearch.mock.calls[0][0];
      expect(body.aggs.by_day.aggs.linked).toEqual({ filter: { term: { 'f0rtika.achilles_correlated': true } } });
      expect(result[0].linked).toBe(3);
    });

    it('getAlertTrend uses week buckets for a 2000-01-01 -> now window', async () => {
      respond();
      const window = { from: '2000-01-01T00:00:00.000Z', to: new Date().toISOString() };
      const result = await service.getAlertTrend(30, window);
      const body = mockSearch.mock.calls[0][0];
      expect(body.aggs.by_day.date_histogram.calendar_interval).toBe('week');
      expect(JSON.stringify(body.query)).toContain(window.from);
      expect(JSON.stringify(body.query)).not.toContain('now-');
      expect(result[0].interval).toBe('week');
    });

    it('getAlertTrend keeps day buckets and days behaviour when no window is given', async () => {
      respond();
      const result = await service.getAlertTrend(30);
      const body = mockSearch.mock.calls[0][0];
      expect(body.aggs.by_day.date_histogram.calendar_interval).toBe('day');
      expect(JSON.stringify(body.query)).toContain('now-30d/d');
      expect(result[0].interval).toBe('day');
    });
  });
});
