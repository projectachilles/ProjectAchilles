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

      // T1003: 5 executions, all in hours with a nearby alert → 5 correlated.
      // T1486: 2 executions, far from any alert → 0 correlated.
      // Per-execution rate = 5 / 7 = 71.4%.
      expect(result.overall.testedTechniques).toBe(2);
      expect(result.overall.detectedTechniques).toBe(1);
      expect(result.overall.totalExecutions).toBe(7);
      expect(result.overall.correlatedExecutions).toBe(5);
      expect(result.overall.detectionRate).toBe(71.4);

      const t1003 = result.byTechnique.find((t: { technique: string }) => t.technique === 'T1003');
      expect(t1003).toBeDefined();
      expect(t1003!.detected).toBe(true);
      expect(t1003!.correlatedExecutions).toBe(5);

      const t1486 = result.byTechnique.find((t: { technique: string }) => t.technique === 'T1486');
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
      expect(bool.must_not).toEqual([
        { term: { 'f0rtika.category': 'cyber-hygiene' } },
        { bool: { must: [
          { term: { 'f0rtika.is_bundle_control': true } },
          { term: { 'event.ERROR': 0 } },
        ] } },
      ]);
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

    it('credits a sub-technique test when only the parent technique has an alert (MITRE roll-up)', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();

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

      const sub = result.byTechnique.find((t: { technique: string }) => t.technique === 'T1574.002');
      expect(sub).toBeDefined();
      expect(sub!.detected).toBe(true);
      expect(sub!.correlatedExecutions).toBe(4);
      expect(result.overall.detectionRate).toBe(100);
    });

    it('does NOT credit a parent-technique test from a sub-technique alert (roll-up is one-directional)', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();

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

      const parent = result.byTechnique.find((t: { technique: string }) => t.technique === 'T1574');
      expect(parent).toBeDefined();
      expect(parent!.detected).toBe(false);
      expect(parent!.correlatedExecutions).toBe(0);
      expect(result.overall.detectionRate).toBe(0);
    });

    it('weights the detection rate by executions, not by technique count', async () => {
      const baseTime = new Date('2026-02-25T10:00:00Z').getTime();
      const hour = 3600000;

      // T1003: 9 executions, all correlated. T1486: 1 execution, uncorrelated.
      // Technique-count rate would be 1/2 = 50%; per-execution is 9/10 = 90%.
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

      // Time-window filter is a bool/should over both `timestamp` and
      // `created_at` (see buildAlertTimeWindowQuery). Either field
      // falling in window is sufficient to match.
      const must = searchCall.query.bool.must as Array<Record<string, unknown>>;
      const windowWrapper = must.find((f: any) =>
        'bool' in f && Array.isArray(f.bool.should) && f.bool.should.some((s: any) =>
          'range' in s && 'timestamp' in s.range,
        ),
      ) as any;
      expect(windowWrapper).toBeDefined();
      expect(windowWrapper.bool.minimum_should_match).toBe(1);

      const tsRange = windowWrapper.bool.should.find((s: any) => 'range' in s && 'timestamp' in s.range);
      expect(tsRange.range.timestamp.gte).toBe('2026-02-25T11:55:00.000Z');
      expect(tsRange.range.timestamp.lte).toBe('2026-02-25T12:30:00.000Z');

      const createdRange = windowWrapper.bool.should.find((s: any) => 'range' in s && 'created_at' in s.range);
      expect(createdRange.range.created_at.gte).toBe('2026-02-25T11:55:00.000Z');
      expect(createdRange.range.created_at.lte).toBe('2026-02-25T12:30:00.000Z');

      const termsFilter = must.find((f: any) => 'terms' in f) as any;
      expect(termsFilter).toBeDefined();
      expect(termsFilter.terms.mitre_techniques).toEqual(['T1003', 'T1059']);
    });
  });
});
