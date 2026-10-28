import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';
import { normalizeClauses } from '../../../__tests__/helpers/normalizeClauses.js';

// Characterization of every EDR-vendor-dependent output, taken BEFORE the
// vendor registry refactor (PR 1). The refactor rebuilds these lists from
// EDR_VENDORS; these snapshots must not change. `should` / `terms` arrays are
// compared order-insensitively (normalizeClauses), everything else exactly.

const mockSearch = vi.fn();
const mockCount = vi.fn();

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = mockSearch;
    this.count = mockCount;
    this.msearch = vi.fn();
  }),
}));

vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { OUTCOME_FILTERS, classifyStage } = await import('../../reports/stageOutcome.js');
const { SOURCE_FIELDS } = await import('../edr.js');
const { ElasticsearchService } = await import('../../analytics/elasticsearch.js');
const { SbReportService } = await import('../../reports/sbReport.service.js');
const { IntegrationsSettingsService } = await import('../../integrations/settings.js');

const settings: AnalyticsSettings = {
  connectionType: 'direct',
  node: 'http://localhost:9200',
  apiKey: 'test-key',
  indexPattern: 'achilles-results-*',
  configured: true,
};

const VENDORS = ['defender', 'crowdstrike', 'sentinelone'] as const;

const EMPTY_RESPONSE = {
  hits: { hits: [], total: { value: 0, relation: 'eq' } },
  aggregations: {},
};

beforeEach(() => {
  mockSearch.mockReset();
  mockCount.mockReset();
  mockSearch.mockResolvedValue(EMPTY_RESPONSE);
  mockCount.mockResolvedValue({ count: 0 });
});

/** Run an ES-service call and return the normalized search request bodies it sent. */
async function searchBodies(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch {
    // An empty mocked response may not satisfy every parser; the request is what we pin.
  }
  return normalizeClauses(mockSearch.mock.calls.map((c) => c[0]));
}

describe('EDR vendor characterization (pre-registry refactor)', () => {
  it('OUTCOME_FILTERS', () => {
    expect(normalizeClauses(OUTCOME_FILTERS)).toMatchSnapshot();
  });

  it('SOURCE_FIELDS', () => {
    expect([...SOURCE_FIELDS].sort()).toMatchSnapshot();
  });

  it('buildDetectedFilter', () => {
    const svc = new ElasticsearchService(settings) as any;
    expect(normalizeClauses(svc.buildDetectedFilter())).toMatchSnapshot();
  });

  it('runCombinedScoreQuery request', async () => {
    const svc = new ElasticsearchService(settings) as any;
    expect(await searchBodies(() => svc.runCombinedScoreQuery([]))).toMatchSnapshot();
  });

  it('runAnyStageCombinedQuery request', async () => {
    const svc = new ElasticsearchService(settings) as any;
    expect(await searchBodies(() => svc.runAnyStageCombinedQuery([]))).toMatchSnapshot();
  });

  it('fetchDocPairRuns request', async () => {
    const svc = new ElasticsearchService(settings) as any;
    expect(await searchBodies(() => svc.fetchDocPairRuns([], { withMetadata: false, latestOnly: true }))).toMatchSnapshot();
  });

  it('fetchBundlePairRuns request', async () => {
    const svc = new ElasticsearchService(settings) as any;
    expect(await searchBodies(() => svc.fetchBundlePairRuns([], { withMetadata: false, latestOnly: true }))).toMatchSnapshot();
  });

  it('getExecutionActivity request', async () => {
    const svc = new ElasticsearchService(settings);
    expect(await searchBodies(() => svc.getExecutionActivity({ days: 7 }))).toMatchSnapshot();
  });

  it('mapHitToExecution with every vendor flag set', () => {
    const svc = new ElasticsearchService(settings) as any;
    const f0rtika: Record<string, unknown> = { test_uuid: 'u1', test_name: 'T' };
    for (const v of VENDORS) {
      f0rtika[`${v}_detected`] = true;
      f0rtika[`${v}_stage_detected`] = true;
      f0rtika[`${v}_prevented`] = true;
      f0rtika[`${v}_prevention_action`] = 'quarantined';
    }
    const row = svc.mapHitToExecution({ _id: 'x', _source: { f0rtika, event: { ERROR: 101 } } });
    const vendorFields = Object.fromEntries(
      Object.entries(row).filter(([k]) => VENDORS.some((v) => k.startsWith(`${v}_`))),
    );
    expect(vendorFields).toMatchSnapshot();
  });

  it('grouped executions roll up per-vendor flags', async () => {
    const member = (id: string, flags: Record<string, unknown>) => ({
      _id: id,
      _source: {
        routing: { event_time: '2026-10-01T00:00:00Z', hostname: 'H1' },
        event: { ERROR: 101 },
        f0rtika: { test_uuid: `b::${id}`, bundle_id: 'b', is_bundle_control: true, control_id: id, ...flags },
      },
    });
    mockSearch.mockResolvedValue({
      hits: { hits: [], total: { value: 2, relation: 'eq' } },
      aggregations: {
        total_groups: { value: 1 },
        display_groups: {
          buckets: [{
            key: 'b',
            doc_count: 2,
            sort_value: { value: 0 },
            members: {
              hits: {
                hits: [
                  member('C1', { defender_detected: true, crowdstrike_prevented: true }),
                  member('C2', { sentinelone_detected: true, sentinelone_prevented: true }),
                ],
              },
            },
          }],
        },
      },
    });
    mockCount.mockResolvedValue({ count: 2 });
    const svc = new ElasticsearchService(settings);
    let groups: unknown = 'unavailable';
    try {
      const res = await svc.getGroupedPaginatedExecutions({ page: 1, pageSize: 10 } as any);
      groups = res.groups.map((g: any) => Object.fromEntries(
        Object.entries(g).filter(([k]) => /^(defender|crowdstrike|sentinelone)(Detected|Prevented)$/.test(k)),
      ));
    } catch (e) {
      groups = `threw: ${(e as Error).message}`;
    }
    expect(groups).toMatchSnapshot();
  });

  it('classifyStage across vendors, exit codes and bundle shape', () => {
    const states: Record<string, Record<string, unknown>> = {
      none: {},
      stage_detected: { stage_detected: true },
      stage_quarantined: { stage_detected: true, prevention_action: 'quarantined' },
      prevented: { prevented: true },
      detected_bundle: { detected: true },
    };
    const table: Record<string, string> = {};
    for (const code of [101, 105, 999, 0]) {
      for (const isBundle of [false, true]) {
        for (const v of VENDORS) {
          for (const [name, state] of Object.entries(states)) {
            const f0rtika: Record<string, unknown> = { is_bundle_control: isBundle, category: 'intel-driven' };
            for (const [k, val] of Object.entries(state)) f0rtika[`${v}_${k}`] = val;
            table[`${code}|${isBundle ? 'bundle' : 'single'}|${v}|${name}`] = classifyStage({ event: { ERROR: code }, f0rtika });
          }
        }
      }
    }
    expect(table).toMatchSnapshot();
  });

  it('SB export rows per vendor', () => {
    const svc = new SbReportService(settings) as any;
    const doc = (id: string, flags: Record<string, unknown>, code = 101) => ({
      _id: id,
      _source: {
        routing: { event_time: '2026-10-01T00:00:00Z', hostname: 'H1' },
        event: { ERROR: code },
        f0rtika: { test_uuid: `b::${id}`, bundle_id: 'b', control_id: id, is_bundle_control: true, techniques: ['T1486'], ...flags },
      },
    });
    let rows: unknown;
    try {
      rows = svc.buildRows([
        doc('S1', { defender_detected: true }, 126),
        doc('S2', { crowdstrike_detected: true, crowdstrike_prevented: true }),
        doc('S3', { sentinelone_stage_detected: true, sentinelone_prevented: true, sentinelone_prevention_action: 'quarantined' }),
        doc('S4', {}),
      ]);
    } catch (e) {
      rows = `threw: ${(e as Error).message}`;
    }
    expect(rows).toMatchSnapshot();
  });

  it('listDormantOrgEdrSections', () => {
    const svc = new IntegrationsSettingsService();
    vi.spyOn(svc as any, 'getRawFileSettings').mockReturnValue({
      orgs: { o1: { defender: { tenant_id: 'x' }, crowdstrike: { client_id: 'y' }, sentinelone: { api_token: 'z' } } },
    });
    expect(svc.listDormantOrgEdrSections()).toMatchSnapshot();
  });
});
