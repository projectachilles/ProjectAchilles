import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attackSimulationExclusions } from '../../analytics/attack-simulation-filter.js';

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

const mockResolveTestNames = vi.fn(
  async (..._args: unknown[]) => new Map<string, { name: string; kind: 'test' | 'bundle' }>(),
);
vi.mock('../../analytics/test-name-lookup.js', () => ({
  resolveTestNames: (...args: unknown[]) => mockResolveTestNames(...args),
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

  describe('getTechniqueOverlap', () => {
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
        'WS11284',
        '92b0b4f6-a09b-4c7b-b593-31ce461f804c.exe',
      );

      expect(mockSearch).toHaveBeenCalledTimes(3);
      const tier3 = JSON.stringify(mockSearch.mock.calls[2][0].query);
      expect(tier3).toContain('mitre_techniques');
      expect(tier3).toContain('evidence_hostnames');
      expect(tier3).toContain('WS11284');
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
