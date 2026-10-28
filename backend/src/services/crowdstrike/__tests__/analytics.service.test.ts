import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NOT_EDR_TERMINATED } from '../../analytics/enrichment-eligibility.js';

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
  CROWDSTRIKE_INDEX: 'achilles-crowdstrike',
}));

const mockResolveTestNames = vi.fn(
  async (..._args: unknown[]) => new Map<string, { name: string; kind: 'test' | 'bundle' }>(),
);
vi.mock('../../analytics/test-name-lookup.js', () => ({
  resolveTestNames: (...args: unknown[]) => mockResolveTestNames(...args),
}));

const { CrowdStrikeAnalyticsService } = await import('../analytics.service.js');

// ── Tests ────────────────────────────────────────────────────────────

describe('CrowdStrikeAnalyticsService', () => {
  let service: InstanceType<typeof CrowdStrikeAnalyticsService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CrowdStrikeAnalyticsService();
  });

  // ── ZTA Score ────────────────────────────────────────────────

  describe('getZtaScoreSummary', () => {
    it('returns zero-state when no snapshot exists', async () => {
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      const result = await service.getZtaScoreSummary();

      expect(result.overallScore).toBe(0);
      expect(result.deviceCount).toBe(0);
      expect(result.timestamp).toBeNull();
    });

    it('returns the latest zta_score document', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [{
            _source: {
              timestamp: '2026-10-01T06:00:00Z',
              overall_score: 72.5,
              os_score: 80,
              sensor_config_score: 65,
              device_count: 12,
              min_score: 40,
              max_score: 95,
            },
          }],
        },
      });

      const result = await service.getZtaScoreSummary();

      expect(result.overallScore).toBe(72.5);
      expect(result.osScore).toBe(80);
      expect(result.sensorConfigScore).toBe(65);
      expect(result.deviceCount).toBe(12);
      expect(result.minScore).toBe(40);
      expect(result.maxScore).toBe(95);
      expect(result.timestamp).toBe('2026-10-01T06:00:00Z');

      // Must query the zta_score doc_type on the crowdstrike index
      const query = mockSearch.mock.calls[0][0];
      expect(query.index).toBe('achilles-crowdstrike');
      expect(JSON.stringify(query.query)).toContain('zta_score');
    });
  });

  describe('getZtaScoreTrend', () => {
    it('returns trend points sorted by date', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { timestamp: '2026-09-29T00:00:00Z', overall_score: 70, os_score: 75, sensor_config_score: 65, device_count: 10 } },
            { _source: { timestamp: '2026-09-30T00:00:00Z', overall_score: 72, os_score: 76, sensor_config_score: 66, device_count: 11 } },
          ],
        },
      });

      const result = await service.getZtaScoreTrend(30);

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2026-09-29T00:00:00Z');
      expect(result[1].score).toBe(72);
      expect(result[1].deviceCount).toBe(11);
    });

    it('exposes overallScore and keeps the score alias', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { timestamp: '2026-09-29T00:00:00Z', overall_score: 97, os_score: 91, sensor_config_score: 100, device_count: 6 } },
          ],
        },
      });

      const result = await service.getZtaScoreTrend(30);

      expect(result[0]).toMatchObject({ overallScore: 97, score: 97, osScore: 91, sensorConfigScore: 100, deviceCount: 6 });
    });
  });

  // ── Alerts ─────────────────────────────────────────────────

  describe('getAlertSummary', () => {
    it('returns severity/status breakdown plus recent critical+high and medium alerts', async () => {
      // First call: aggregation query
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 15 }, hits: [] },
        aggregations: {
          by_severity: {
            buckets: [
              { key: 'critical', doc_count: 2 },
              { key: 'high', doc_count: 3 },
              { key: 'medium', doc_count: 7 },
              { key: 'low', doc_count: 3 },
            ],
          },
          by_status: {
            buckets: [
              { key: 'new', doc_count: 8 },
              { key: 'closed', doc_count: 7 },
            ],
          },
        },
      });

      // Second call: recent critical+high alerts (Promise.all kicks these off in array order)
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { alert_id: 'a1', alert_title: 'Ransomware', severity: 'critical', created_at: '2026-10-01T10:00:00Z', service_source: 'CrowdStrike Falcon' } },
            { _source: { alert_id: 'a2', alert_title: 'Credential dumping', severity: 'high', created_at: '2026-10-01T09:00:00Z', service_source: 'CrowdStrike Falcon' } },
          ],
        },
      });

      // Third call: recent medium alerts
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { alert_id: 'b1', alert_title: 'Suspicious macro', severity: 'medium', created_at: '2026-10-01T08:00:00Z', service_source: 'CrowdStrike Falcon' } },
          ],
        },
      });

      const result = await service.getAlertSummary();

      expect(result.total).toBe(15);
      expect(result.bySeverity.critical).toBe(2);
      expect(result.bySeverity.high).toBe(3);
      expect(result.byStatus.new).toBe(8);
      expect(result.recentHigh).toHaveLength(2);
      expect(result.recentHigh[0].title).toBe('Ransomware');
      expect(result.recentMedium).toHaveLength(1);
      expect(result.recentMedium[0].severity).toBe('medium');

      // The "recentHigh" query must cover BOTH critical and high severities
      const recentHighQuery = mockSearch.mock.calls[1][0];
      expect(JSON.stringify(recentHighQuery.query)).toContain('critical');
      expect(JSON.stringify(recentHighQuery.query)).toContain('high');
    });
  });

  describe('getAlertSummary product', () => {
    it('maps product from category on recent alerts', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [] },
        aggregations: { by_severity: { buckets: [] }, by_status: { buckets: [] } },
      });
      mockSearch.mockResolvedValueOnce({
        hits: { hits: [{ _source: { alert_id: 'a1', alert_title: 'X', severity: 'high', created_at: '2026-10-01T10:00:00Z', service_source: 'Falcon', category: 'NGAV' } }] },
      });
      mockSearch.mockResolvedValueOnce({ hits: { hits: [] } });

      const result = await service.getAlertSummary();

      expect(result.recentHigh[0].product).toBe('NGAV');
    });
  });

  describe('getAlerts', () => {
    it('applies severity/status/search filters and pagination', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [{
            _source: {
              alert_id: 'a1',
              alert_title: 'Ransomware note dropped',
              description: '...',
              severity: 'critical',
              status: 'new',
              category: 'ransomware',
              service_source: 'CrowdStrike Falcon',
              mitre_techniques: ['T1486'],
              created_at: '2026-10-01T10:00:00Z',
              updated_at: '2026-10-01T10:05:00Z',
              resolved_at: null,
              recommended_actions: '',
              f0rtika: { auto_resolved: true, auto_resolved_at: '2026-10-01T11:00:00Z', auto_resolve_mode: 'enabled' },
            },
          }],
        },
      });

      const result = await service.getAlerts({
        page: 2, pageSize: 10, severity: 'critical', status: 'new', search: 'ransomware',
      });

      const query = mockSearch.mock.calls[0][0];
      expect(query.from).toBe(10);
      expect(query.size).toBe(10);
      const must = query.query.bool.must;
      expect(must).toContainEqual({ term: { severity: 'critical' } });
      expect(must).toContainEqual({ term: { status: 'new' } });

      expect(result.total).toBe(1);
      expect(result.data[0].severity).toBe('critical');
      expect(result.data[0].auto_resolved).toBe(true);
      expect(result.data[0].auto_resolve_mode).toBe('enabled');
      expect(result.data[0].auto_resolve_error).toBeNull();
    });

    it('OR-filters techniques with sub-technique prefix matching', async () => {
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } });

      await service.getAlerts({ techniques: ['T1059', 'T1486'] });

      const must = mockSearch.mock.calls[0][0].query.bool.must;
      const techClause = must.find((c: any) => c.bool?.should);
      expect(techClause.bool.should).toContainEqual({ term: { mitre_techniques: 'T1059' } });
      expect(techClause.bool.should).toContainEqual({ prefix: { mitre_techniques: 'T1059.' } });
      expect(techClause.bool.should).toContainEqual({ prefix: { mitre_techniques: 'T1486.' } });
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
      // Source is a post_filter, never part of the base query (facets need it out).
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

    it('maps hostname, prevention, portal_url and correlation fields', async () => {
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
              pattern_disposition_description: 'Prevention, process killed.',
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
      expect(item.pattern_disposition_description).toBe('Prevention, process killed.');
      expect(item.portal_url).toBe('https://x');
      expect(item.achilles_correlated).toBe(true);
      expect(item.achilles_test_uuid).toBe('u1');
      expect(item.achilles_test_name).toBe('Ransomware chain');
      expect(item.achilles_test_kind).toBe('bundle');
      // Existing item fields are kept.
      expect(item.alert_title).toBe('Ransomware note dropped');

      // One lookup per page, against the results index, with the distinct uuids.
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
      expect(item.portal_url).toBeUndefined();
    });

    it('returns facet counts from aggregations', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 12 }, hits: [] },
        aggregations: {
          facet_source: {
            doc_count: 20,
            split: { buckets: { test: { doc_count: 8 }, organic: { doc_count: 12 } } },
          },
          facet_severity: {
            doc_count: 12,
            split: { buckets: [{ key: 'critical', doc_count: 2 }, { key: 'high', doc_count: 10 }] },
          },
          facet_filtered: {
            doc_count: 12,
            auto_resolved: { doc_count: 3 },
            prevention: {
              buckets: {
                prevented: { doc_count: 5 },
                detected_only: { doc_count: 6 },
                kill_failed: { doc_count: 1 },
              },
            },
          },
          facet_linked_open: { doc_count: 999, split: { doc_count: 4 } },
        },
      });

      const result = await service.getAlerts({ source: 'organic', severities: ['critical', 'high'] });

      expect(result.counts).toEqual({
        bySource: { all: 20, test: 8, organic: 12 },
        bySeverity: { critical: 2, high: 10 },
        autoResolved: 3,
        linkedOpen: 4,
        byPrevention: { prevented: 5, detected_only: 6, kill_failed: 1 },
      });
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
      expect(req.aggs.facet_filtered.aggs.prevention.filters.filters.prevented).toEqual({
        terms: { prevention_action: ['quarantined', 'process_killed', 'blocked'] },
      });
      // linkedOpen ignores the query (search/techniques) and keeps only the window.
      expect(req.aggs.facet_linked_open.global).toEqual({});
      const linkedOpen = JSON.stringify(req.aggs.facet_linked_open.aggs.split.filter);
      expect(linkedOpen).toContain('"created_at"');
      expect(linkedOpen).toContain('achilles_correlated');
      expect(linkedOpen).toContain('"closed"');
      expect(linkedOpen).toContain('"resolved"');
      expect(linkedOpen).not.toContain('ransom');
      expect(linkedOpen).not.toContain('T1486');
      expect(linkedOpen).not.toContain('"severity"');
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
        byPrevention: { prevented: 0, detected_only: 0, kill_failed: 0 },
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
            prevention: { buckets: { prevented: { doc_count: 2 }, detected_only: { doc_count: 3 }, kill_failed: { doc_count: 0 } } },
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
      expect(result.counts.byPrevention).toEqual({ prevented: 2, detected_only: 3, kill_failed: 0 });
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

  describe('getAlertTrend', () => {
    it('returns daily buckets with critical/high/medium/low sub-counts', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 6 }, hits: [] },
        aggregations: {
          by_day: {
            buckets: [
              {
                key_as_string: '2026-09-30T00:00:00.000Z',
                doc_count: 4,
                critical: { doc_count: 1 },
                high: { doc_count: 1 },
                medium: { doc_count: 2 },
                low: { doc_count: 0 },
              },
              {
                key_as_string: '2026-10-01T00:00:00.000Z',
                doc_count: 2,
                critical: { doc_count: 0 },
                high: { doc_count: 1 },
                medium: { doc_count: 0 },
                low: { doc_count: 1 },
              },
            ],
          },
        },
      });

      const result = await service.getAlertTrend(30);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ count: 4, critical: 1, high: 1, medium: 2, low: 0 });
      expect(result[1]).toMatchObject({ count: 2, critical: 0, high: 1, medium: 0, low: 1 });
    });
  });

  // ── Technique overlap ────────────────────────────────────────

  describe('getTechniqueOverlap', () => {
    it('returns only techniques present in BOTH test results and alerts', async () => {
      // Test-side aggregation
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1059', doc_count: 10 },
              { key: 'T1003', doc_count: 5 },
            ],
          },
        },
      });
      // Alert-side aggregation
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1059', doc_count: 3 },
              { key: 'T1486', doc_count: 2 },
            ],
          },
        },
      });

      const result = await service.getTechniqueOverlap();

      // T1059 overlaps; T1003 has no alerts; T1486 has no tests
      expect(result).toEqual([
        { technique: 'T1059', testResults: 10, crowdstrikeAlerts: 3 },
      ]);
    });

    it('overlap and detection-rate test queries leave EDR-killed docs out', async () => {
      const empty = { hits: { total: { value: 0 }, hits: [] }, aggregations: { techniques: { buckets: [] } } };
      mockSearch.mockResolvedValue(empty);

      await service.getTechniqueOverlap();
      await service.getDetectionRate(30, 60);

      // Calls 0 and 2 are the test-results queries (each is followed by its alert query).
      for (const i of [0, 2]) {
        const bool = (mockSearch.mock.calls[i][0].query as Record<string, any>).bool;
        expect(bool.filter).toContainEqual(NOT_EDR_TERMINATED);
      }
    });
  });

  // ── Detection rate ───────────────────────────────────────────

  describe('getDetectionRate', () => {
    it('computes per-technique detection within the time window, with sub→parent roll-up', async () => {
      const baseHour = Date.parse('2026-09-30T10:00:00Z');

      // Test executions: T1059 at baseHour (2 execs), T1574.002 (sub-technique) at baseHour (1 exec)
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1059', doc_count: 2, by_hour: { buckets: [{ key: baseHour, doc_count: 2 }] } },
              { key: 'T1574.002', doc_count: 1, by_hour: { buckets: [{ key: baseHour, doc_count: 1 }] } },
            ],
          },
        },
      });

      // Alerts: T1059 at baseHour; T1574 (PARENT only — rolls up to T1574.002)
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1059', doc_count: 1, by_hour: { buckets: [{ key: baseHour, doc_count: 1 }] } },
              { key: 'T1574', doc_count: 1, by_hour: { buckets: [{ key: baseHour, doc_count: 1 }] } },
            ],
          },
        },
      });

      const result = await service.getDetectionRate(30, 60);

      expect(result.overall.totalExecutions).toBe(3);
      expect(result.overall.correlatedExecutions).toBe(3);
      expect(result.overall.detectionRate).toBe(100);
      expect(result.overall.testedTechniques).toBe(2);
      expect(result.overall.detectedTechniques).toBe(2);

      const sub = result.byTechnique.find((t) => t.technique === 'T1574.002');
      expect(sub?.detected).toBe(true); // credited via parent roll-up
    });

    it('does NOT credit a parent test from a sub-technique alert (one-directional roll-up)', async () => {
      const baseHour = Date.parse('2026-09-30T10:00:00Z');

      // Test executions: parent T1574 only
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1574', doc_count: 1, by_hour: { buckets: [{ key: baseHour, doc_count: 1 }] } },
            ],
          },
        },
      });

      // Alerts: sub-technique T1574.002 only — must NOT roll up to the parent test
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          techniques: {
            buckets: [
              { key: 'T1574.002', doc_count: 1, by_hour: { buckets: [{ key: baseHour, doc_count: 1 }] } },
            ],
          },
        },
      });

      const result = await service.getDetectionRate(30, 60);

      expect(result.overall.correlatedExecutions).toBe(0);
      expect(result.overall.detectionRate).toBe(0);
      expect(result.byTechnique[0].detected).toBe(false);
    });
  });

  // ── Score comparison (ZTA vs defense) ────────────────────────

  describe('getScoreComparison', () => {
    it('merges ZTA score and defense-score series by date', async () => {
      // ZTA trend (getZtaScoreTrend call)
      mockSearch.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { timestamp: '2026-09-30T06:00:00Z', overall_score: 72, os_score: 75, sensor_config_score: 65, device_count: 10 } },
          ],
        },
      });
      // Defense score aggregation
      mockSearch.mockResolvedValueOnce({
        aggregations: {
          by_day: {
            buckets: [
              { key_as_string: '2026-09-30T00:00:00.000Z', doc_count: 4, protected: { doc_count: 3 } },
            ],
          },
        },
      });

      const result = await service.getScoreComparison(90);

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-09-30');
      expect(result[0].ztaScore).toBe(72);
      expect(result[0].defenseScore).toBe(75);
    });
  });

  // ── Alerts for test (3-tier fallback) ────────────────────────

  describe('getAlertsForTest', () => {
    const alertHit = (overrides: Record<string, unknown> = {}) => ({
      _source: {
        alert_id: 'alert-1',
        alert_title: 'Stage binary executed',
        description: '',
        severity: 'high',
        status: 'new',
        category: 'suspicious_activity',
        service_source: 'CrowdStrike Falcon',
        mitre_techniques: ['T1059'],
        created_at: '2026-10-01T12:01:00Z',
        updated_at: '2026-10-01T12:01:00Z',
        resolved_at: null,
        recommended_actions: '',
        evidence_filenames: ['92b0b4f6-a09b-4c7b-b593-31ce461f804c-t1059.exe'],
        ...overrides,
      },
    });

    const baseParams = {
      techniques: ['T1059'],
      timestamp: '2026-10-01T12:00:00Z',
      windowMinutes: 30,
      hostname: 'LT-ACME-L50',
      binaryName: '92b0b4f6-a09b-4c7b-b593-31ce461f804c.exe',
    };

    it('returns prevention_action and portal_url from the alert doc', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 1 },
          hits: [{
            _source: {
              alert_id: 'p1', alert_title: 'Blocked', severity: 'high', status: 'closed',
              created_at: '2026-02-25T10:01:00Z', updated_at: '2026-02-25T10:01:00Z',
              mitre_techniques: ['T1486'], prevention_action: 'quarantined',
              portal_url: 'https://falcon.crowdstrike.com/alerts/p1',
            },
          }],
        },
      });
      const result = await service.getAlertsForTest(['T1486'], '2026-02-25T10:00:00Z', 30);
      expect(result.alerts[0]).toMatchObject({
        prevention_action: 'quarantined',
        portal_url: 'https://falcon.crowdstrike.com/alerts/p1',
      });
    });

    it('tier 1: evidence-based match with stage attribution', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [alertHit()] },
      });

      const result = await service.getAlertsForTest(
        baseParams.techniques, baseParams.timestamp, baseParams.windowMinutes,
        baseParams.hostname, baseParams.binaryName,
      );

      expect(result.total).toBe(1);
      expect(result.alerts[0].attribution).toBe('stage');
      expect(result.alerts[0].attributed_control_id).toBe('t1059');
      expect(result.matchedTechniques).toContain('T1059');
      // Only ONE search — the evidence tier hit, fallbacks not needed
      expect(mockSearch).toHaveBeenCalledTimes(1);
    });

    it('tier 2: falls back to technique+hostname when evidence query matches nothing', async () => {
      // Evidence tier: no hits
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } });
      // Hostname+technique tier: one hit (no stage binary in evidence → bundle attribution)
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [alertHit({ evidence_filenames: ['92b0b4f6-a09b-4c7b-b593-31ce461f804c.exe'] })] },
      });

      const result = await service.getAlertsForTest(
        baseParams.techniques, baseParams.timestamp, baseParams.windowMinutes,
        baseParams.hostname, baseParams.binaryName,
      );

      expect(result.total).toBe(1);
      // Orchestrator UUID-only binary → bundle attribution
      expect(result.alerts[0].attribution).toBe('bundle');
      expect(result.alerts[0].attributed_control_id).toBeUndefined();
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });

    it('tier 3: technique-only fallback when no hostname is provided', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [alertHit()] },
      });

      const result = await service.getAlertsForTest(
        baseParams.techniques, baseParams.timestamp, baseParams.windowMinutes,
      );

      expect(result.total).toBe(1);
      // No binaryName → no discriminator → bundle attribution
      expect(result.alerts[0].attribution).toBe('bundle');
      expect(mockSearch).toHaveBeenCalledTimes(1);

      // The technique-only query must still carry the time window — and, with
      // no hostname parameter, NO evidence_hostnames constraint.
      const query = mockSearch.mock.calls[0][0];
      expect(JSON.stringify(query.query)).toContain('mitre_techniques');
      expect(JSON.stringify(query.query)).toContain('timestamp');
      expect(JSON.stringify(query.query)).not.toContain('evidence_hostnames');
    });

    it('tier 3 WITH hostname keeps the evidence_hostnames constraint (no cross-host associations)', async () => {
      // Fleet-wide simultaneous runs: without the host filter, a host whose
      // EDR stayed quiet would inherit sibling hosts' same-technique alerts
      // in the shared time window (observed in production).
      // Evidence tier (binaryName+hostname) misses; technique+hostname tier
      // misses; tier 3 must STILL be host-scoped.
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } }); // tier 1
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } }); // tier 2
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [alertHit()] },
      }); // tier 3

      const result = await service.getAlertsForTest(
        baseParams.techniques, baseParams.timestamp, baseParams.windowMinutes,
        baseParams.hostname, baseParams.binaryName,
      );

      expect(result.total).toBe(1);
      expect(mockSearch).toHaveBeenCalledTimes(3);
      const tier3 = JSON.stringify(mockSearch.mock.calls[2][0].query);
      expect(tier3).toContain('mitre_techniques');
      expect(tier3).toContain('evidence_hostnames');
      expect(tier3).toContain('LT-ACME-L50');
    });

    it('tier 3 with hostname but no binaryName (evidence tier skipped) is host-scoped', async () => {
      // Technique+hostname tier misses → tier 3 runs with the hostname filter.
      mockSearch.mockResolvedValueOnce({ hits: { total: { value: 0 }, hits: [] } }); // tier 2
      mockSearch.mockResolvedValueOnce({
        hits: { total: { value: 1 }, hits: [alertHit()] },
      }); // tier 3

      const result = await service.getAlertsForTest(
        baseParams.techniques, baseParams.timestamp, baseParams.windowMinutes,
        baseParams.hostname,
      );

      expect(result.total).toBe(1);
      expect(mockSearch).toHaveBeenCalledTimes(2);
      const tier3 = JSON.stringify(mockSearch.mock.calls[1][0].query);
      expect(tier3).toContain('evidence_hostnames');
      expect(tier3).toContain('LT-ACME-L50');
    });

    it('sorts multiple alerts by proximity to the test timestamp', async () => {
      mockSearch.mockResolvedValueOnce({
        hits: {
          total: { value: 2 },
          hits: [
            alertHit({ alert_id: 'far', created_at: '2026-10-01T12:20:00Z' }),
            alertHit({ alert_id: 'near', created_at: '2026-10-01T12:02:00Z' }),
          ],
        },
      });

      const result = await service.getAlertsForTest(
        baseParams.techniques, baseParams.timestamp, baseParams.windowMinutes,
      );

      expect(result.alerts[0].alert_id).toBe('near');
      expect(result.alerts[1].alert_id).toBe('far');
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
