import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

vi.mock('../../analytics/client.js', () => ({ createEsClient: vi.fn() }));

import { createEsClient } from '../../analytics/client.js';
import { STAGE_OUTCOMES } from '../stageOutcome.js';
import { ExecutionReportService, ORG_NAME_MAX, deploymentOrgName } from '../executionReport.service.js';
import { ORG_NAMES } from '../../analytics/elasticsearch.js';
import type { OutcomeCounts } from '../../../types/reports.js';
import type { AnalyticsSettings } from '../../../types/analytics.js';

const BUNDLE = '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb';
const TASK = '4c28f408-1676-40ff-a2e6-60ea5bdd6076';
const NOW = new Date('2026-10-13T23:40:00.000Z');
const T_RUN = Date.parse('2026-10-12T12:47:49.000Z');
const settings: AnalyticsSettings = { connectionType: 'direct', node: 'http://localhost:9200', indexPattern: 'achilles-results-*', configured: true };

const agg = (c: Partial<OutcomeCounts>) => ({ buckets: Object.fromEntries(STAGE_OUTCOMES.map((k) => [k, { doc_count: c[k] ?? 0 }])) });

function scopeResponse(over: { outcomes?: Partial<OutcomeCounts>; runs?: number; otherHostDocs?: number } = {}) {
  return { aggregations: {
    outcomes: agg(over.outcomes ?? { protected: 1, unprotected: 1 }),
    runs: { value: over.runs ?? 1 }, endpoints: { value: 1 }, tests: { value: 1 }, tactics: { value: 2 },
    first: { value: T_RUN }, last: { value: T_RUN }, high_impact: { doc_count: 1 },
    hosts: {
      sum_other_doc_count: over.otherHostDocs ?? 0,
      buckets: [{ key: 'WS-FIN-014', runs: { value: 1 }, outcomes: agg({ protected: 1, unprotected: 1 }) }],
    },
    techniques: { buckets: [
      { key: 'T1567.002', tactics: { buckets: [{ key: 'exfiltration' }] }, tests: { buckets: [{ key: BUNDLE }] }, outcomes: agg({ unprotected: 4 }) },
      { key: 'T1486', tactics: { buckets: [{ key: 'impact' }] }, tests: { buckets: [{ key: BUNDLE }] }, outcomes: agg({ protected: 4 }) },
    ] },
    actors: { buckets: [{ key: 'LockBit 3.0 (S1202)', runs: { value: 1 }, tests: { buckets: [{ key: BUNDLE }] }, outcomes: agg({ protected: 1, unprotected: 1 }) }] },
  } };
}

const stageBucket = (controlId: string, validator: string, name: string, tactic: string, c: Partial<OutcomeCounts>) => ({
  key: controlId, outcomes: agg(c),
  meta: { hits: { hits: [{ _source: { f0rtika: { test_name: name, control_validator: validator, techniques: [controlId], tactics: [tactic] } } }] } },
});

function testsResponse() {
  return { aggregations: { tests: { buckets: [{
    key: BUNDLE, runs: { value: 1 }, endpoints: { value: 1 }, last_run: { value: T_RUN }, outcomes: agg({ protected: 1, unprotected: 1 }),
    meta: { hits: { hits: [{ _source: { f0rtika: {
      is_bundle_control: true, bundle_name: 'LockBit 3.0 Double Extortion Kill Chain', test_name: 'Impact',
      category: 'intel-driven', severity: 'critical', threat_actor: 'LockBit 3.0 (S1202)',
    } } }] } },
    stages: { buckets: [
      stageBucket('T1486', 'Stage 5', 'Impact', 'impact', { protected: 1 }),
      stageBucket('T1567.002', 'Stage 4', 'Pre-encryption exfiltration', 'exfiltration', { unprotected: 1 }),
    ] },
  }] } } };
}

const memberHit = (controlId: string, validator: string, exit: number, tactic: string) => ({
  _id: `${TASK}::${controlId}`,
  _source: {
    event: { ERROR: exit }, routing: { hostname: 'WS-FIN-014' },
    f0rtika: {
      is_bundle_control: true, bundle_id: BUNDLE, bundle_name: 'LockBit 3.0 Double Extortion Kill Chain', control_id: controlId,
      control_validator: validator, test_name: controlId, techniques: [controlId], tactics: [tactic],
    },
  },
});

function runsResponse() {
  return { aggregations: { runs: { buckets: [{
    key: `bundle::${BUNDLE}::WS-FIN-014::${T_RUN}`, doc_count: 2, completed: { value: T_RUN },
    members: { hits: { hits: [memberHit('T1486', 'Stage 5', 126, 'impact'), memberHit('T1567.002', 'Stage 4', 101, 'exfiltration')] } },
  }] } } };
}

function timelineResponse() {
  return { aggregations: { timeline: { buckets: [{
    key: Date.parse('2026-10-12T04:00:00.000Z'),
    lanes: { buckets: { [BUNDLE]: { doc_count: 2, runs: { value: 1 }, outcomes: agg({ protected: 1, unprotected: 1 }) }, __other__: { doc_count: 0 } } },
  }] } } };
}

function routeSearch(scope: object = scopeResponse()) {
  return async (req: { aggs: Record<string, any> }) => {
    if (req.aggs.hosts) return scope;
    if (req.aggs.timeline) return timelineResponse();
    if (req.aggs.runs?.terms) return runsResponse();
    return testsResponse();
  };
}

const alertHit = (title: string) => ({ hits: { hits: [{ _source: {
  alert_title: title, severity: 'high', status: 'new', created_at: '2026-10-12T12:48:51Z',
  evidence_filenames: [`${BUNDLE}-T1567.002.exe`],
} }] } });

/** msearch stub: one hit per sub-search, answering for whichever vendor index it targets. */
const msearchHits = (titleByIndex: Record<string, string>) => async ({ searches }: { searches: { index?: string }[] }) => ({
  responses: Array.from({ length: searches.length / 2 }, (_, i) => alertHit(titleByIndex[searches[i * 2].index ?? ''] ?? 'Alert')),
});

function makeDeps(over: Record<string, unknown> = {}): any {
  return {
    client: {
      search: vi.fn(routeSearch()),
      msearch: vi.fn(msearchHits({ 'achilles-defender': 'RcloneExfiltration' })),
      count: vi.fn(async () => ({ count: 0 })),
    },
    es: {
      buildExtendedFilters: vi.fn(() => [{ match_all: {} }]),
      getDefenseScore: vi.fn(async () => ({
        score: 61.5, rawScore: 58, riskAcceptedCount: 3, totalExecutions: 40,
        protectedCount: 20, detectedCount: 4, unprotectedCount: 16, realScore: 50,
      })),
    },
    vendors: { defender: true, crowdstrike: false },
    getTestMetadata: vi.fn(() => ({
      uuid: BUNDLE, name: 'LockBit', description: 'Emulates the LockBit 3.0 playbook.', techniques: [],
      isMultiStage: true, stages: [], threatActor: 'LockBit 3.0 (S1202)', score: 8.8,
    })),
    readGuidance: vi.fn(() => '| [T1567.002](x) — Exfiltration to Cloud Storage | Exfiltration | [M1021](y) Restrict Web-Based Content |'),
    getRunStartTimes: vi.fn(async () => new Map([[TASK, '2026-10-12T12:41:06.000Z']])),
    getAcceptances: vi.fn(async () => ({})),
    budgetMs: 5_000,
    vendorBudgetMs: 5_000,
    ...over,
  };
}

const params = (over: Record<string, unknown> = {}) =>
  ({ from: 'now-30d', tz: 'America/Santo_Domingo', includeAcceptedRisks: false, ...over }) as any;

// Raw enrichment errors go to the server log; keep the test output clean and let tests assert on it.
let warn: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('ExecutionReportService.generate', () => {
  it('resolves the window once and passes absolute bounds to every query', async () => {
    const deps = makeDeps();
    await new ExecutionReportService(settings, deps).generate(params({ hostnames: 'WS-FIN-014' }), NOW);
    const scope = { hostnames: 'WS-FIN-014', from: '2026-09-13T23:40:00.000Z', to: '2026-10-13T23:40:00.000Z' };
    expect(deps.es.buildExtendedFilters).toHaveBeenCalledWith(scope);
    expect(deps.es.getDefenseScore).toHaveBeenCalledWith({ ...scope, scoringMode: 'any-stage' });
    for (const [req] of deps.client.search.mock.calls) expect(req.index).toBe('achilles-results-*');
  });

  it('assembles the report', async () => {
    const report = await new ExecutionReportService(settings, makeDeps()).generate(params(), NOW);

    expect(report.meta.window).toMatchObject({ preset: '30d', label: 'Last 30 days', bucket: 'day', firstExecution: '2026-10-12T12:47:49.000Z' });
    expect(report.meta.tz).toBe('America/Santo_Domingo');
    expect(report.meta.reportId).toMatch(/^RPT-20261013-[0-9A-F]{4}$/);
    expect(report.totals).toMatchObject({ runs: 1, stageResults: 2, techniques: 2, actors: 1, highImpactUnprotected: 1 });
    expect(report.defenseScore).toEqual({ score: 61.5, rawScore: 58, riskAcceptedCount: 3 });

    const test = report.tests[0];
    expect(test).toMatchObject({ name: 'LockBit 3.0 Double Extortion Kill Chain', description: 'Emulates the LockBit 3.0 playbook.', score: 8.8 });
    expect(test.stages.map((s) => s.controlId)).toEqual(['T1567.002', 'T1486']);
    expect(test.stages[0].alerts).toEqual({ defender: 1, crowdstrike: 0, sentinelone: 0 });

    expect(report.timeline.lanes).toEqual([{ testKey: BUNDLE, name: 'LockBit 3.0 Double Extortion Kill Chain', runs: 1 }]);
    expect(report.timeline.buckets[0].lanes[0]).toMatchObject({ testKey: BUNDLE, runs: 1 });

    const run = report.runs[0];
    expect(run).toMatchObject({ taskId: TASK, startedAt: '2026-10-12T12:41:06.000Z', hostname: 'WS-FIN-014', moreStages: 0 });
    expect(run.stages.map((s) => [s.controlId, s.outcome, s.highImpact])).toEqual([['T1567.002', 'unprotected', true], ['T1486', 'protected', false]]);
    expect(run.alerts[0]).toMatchObject({ vendor: 'defender', title: 'RcloneExfiltration', stageControlId: 't1567.002' });
    expect(run.alertsChecked).toBe(true);
    expect(report.meta.edrVendors).toEqual(['defender']);
    // At or below RUN_STRIP_MAX_RUNS the run stages keep their names, techniques and tactics.
    expect(run.stages[0]).toMatchObject({ name: 'T1567.002', techniques: ['T1567.002'], tactics: ['exfiltration'] });

    expect(report.findings[0]).toMatchObject({
      techniqueId: 'T1567.002', highImpact: true,
      guidance: { testKey: BUNDLE, excerpt: 'Exfiltration · M1021 Restrict Web-Based Content' },
    });
    expect(report.acceptedRisks).toBeNull();
    expect(report.meta.warnings).toEqual([]);
    expect(report.meta.unavailable).toEqual([]);
    expect(report.meta.partial).toBeNull();
  });

  it('keeps the raw score and accepted count when risk acceptance excludes every conclusive result', async () => {
    const deps = makeDeps();
    deps.es.getDefenseScore.mockResolvedValue({
      score: 0, rawScore: 42.5, riskAcceptedCount: 12, totalExecutions: 0,
      protectedCount: 0, detectedCount: 0, unprotectedCount: 0, realScore: 0, realTotalExecutions: 12,
    });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.defenseScore).toEqual({ score: null, rawScore: 42.5, riskAcceptedCount: 12 });
  });

  it('has no score at all when nothing in scope is conclusive', async () => {
    const deps = makeDeps();
    deps.es.getDefenseScore.mockResolvedValue({
      score: 0, rawScore: 0, riskAcceptedCount: 0, totalExecutions: 0, protectedCount: 0, detectedCount: 0, unprotectedCount: 0,
    });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.defenseScore).toEqual({ score: null, rawScore: null, riskAcceptedCount: 0 });
  });

  it('returns an empty report without the timeline query or any enrichment', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(async (req: { aggs: Record<string, unknown> }) =>
      (req.aggs.hosts ? scopeResponse({ outcomes: {}, runs: 0 }) : { aggregations: {} }));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.totals.runs).toBe(0);
    expect(report.runs).toEqual([]);
    expect(deps.client.search).toHaveBeenCalledTimes(3);
    expect(deps.es.getDefenseScore).not.toHaveBeenCalled();
    expect(deps.client.msearch).not.toHaveBeenCalled();
  });

  it('turns optional failures into warnings', async () => {
    const deps = makeDeps();
    deps.es.getDefenseScore.mockRejectedValue(new Error('cluster busy'));
    deps.client.msearch.mockRejectedValue(new Error('index_not_found'));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.defenseScore).toBeNull();
    expect(report.runs[0].alerts).toEqual([]);
    expect(report.meta.warnings).toHaveLength(2);
    expect(report.meta.warnings).toEqual(expect.arrayContaining([
      'Defense Score unavailable',
      'Microsoft Defender alerts unavailable',
    ]));
    expect(report.meta.unavailable).toEqual(['defenseScore', 'alerts']);
  });

  it('keeps raw enrichment errors out of the report and logs them instead', async () => {
    const deps = makeDeps();
    deps.es.getDefenseScore.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.4.17:9200'));
    deps.client.msearch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND es-internal.corp'));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.warnings).toEqual(['Defense Score unavailable', 'Microsoft Defender alerts unavailable']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Defense Score unavailable.*10\.0\.4\.17/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Microsoft Defender alerts unavailable.*es-internal\.corp/));
  });

  it('flags only the Defense Score when it alone fails', async () => {
    const deps = makeDeps();
    deps.es.getDefenseScore.mockRejectedValue(new Error('cluster busy'));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.defenseScore).toBeNull();
    expect(report.meta.unavailable).toEqual(['defenseScore']);
    expect(report.runs[0].alerts).toHaveLength(1);
  });

  it('flags run start times that fail while they were attempted', async () => {
    const deps = makeDeps();
    deps.getRunStartTimes.mockRejectedValue(new Error('db locked'));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.runs[0].startedAt).toBeNull();
    expect(report.meta.warnings).toEqual(['Run start times unavailable']);
    expect(report.meta.unavailable).toEqual(['startTimes']);
  });

  it('drops enrichments that outlive the time budget', async () => {
    const deps = makeDeps({ budgetMs: 30 });
    deps.es.getDefenseScore.mockImplementation(() => new Promise(() => {}));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.defenseScore).toBeNull();
    expect(report.meta.warnings).toContain('Defense Score unavailable: time budget reached');
  });

  it('flags alerts unavailable when the overall budget ends while a vendor hangs', async () => {
    const deps = makeDeps({ budgetMs: 40, vendorBudgetMs: 5_000 });
    deps.client.msearch.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(report.runs[0].alerts).toEqual([]);
    expect(report.meta.warnings).toEqual([expect.stringMatching(/alerts unavailable: time budget reached$/)]);
    expect(report.meta.unavailable).toEqual(['alerts']);
  });

  it('credits a single-stage bundle only with alerts its evidence names', async () => {
    const deps = makeDeps();
    const oneStage = testsResponse();
    oneStage.aggregations.tests.buckets[0].stages.buckets = oneStage.aggregations.tests.buckets[0].stages.buckets
      .filter((b: { key: string }) => b.key === 'T1486');
    deps.client.search.mockImplementation(async (req: { aggs: Record<string, any> }) =>
      (req.aggs.tests?.terms ? oneStage : routeSearch()(req)));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.tests[0].isBundle).toBe(true);
    expect(report.tests[0].stages.map((s) => s.controlId)).toEqual(['T1486']);
    // The alert's evidence binary names T1567.002, a stage outside this report's filter.
    expect(report.runs[0].alerts[0].stageControlId).toBe('t1567.002');
    expect(report.tests[0].stages[0].alerts).toEqual({ defender: 0, crowdstrike: 0, sentinelone: 0 });
  });

  it('echoes filters and flags outcome filtering', async () => {
    const report = await new ExecutionReportService(settings, makeDeps())
      .generate(params({ result: 'unprotected', errorCodes: '101', tags: 'lockbit' }), NOW);
    expect(report.meta.filters).toEqual({ result: 'unprotected', errorCodes: '101', tags: 'lockbit' });
    expect(report.meta.outcomeFiltered).toEqual(['result=unprotected', 'errorCodes=101']);
  });

  it('includes accepted risks only when permitted and marks covered findings', async () => {
    const deps = makeDeps({
      getAcceptances: vi.fn(async () => ({
        'Pre-encryption exfiltration::T1567.002': [{
          acceptance_id: 'r1', test_name: 'Pre-encryption exfiltration', control_id: 'T1567.002', scope: 'global',
          justification: 'Egress handled by proxy', accepted_by: 'u1', accepted_by_name: 'SOC lead',
          accepted_at: '2026-10-01T00:00:00Z', status: 'active',
        }],
      })),
    });
    const report = await new ExecutionReportService(settings, deps).generate(params({ includeAcceptedRisks: true }), NOW);
    expect(deps.getAcceptances).toHaveBeenCalledWith(expect.arrayContaining(['Pre-encryption exfiltration', 'Impact']), undefined);
    expect(report.acceptedRisks).toEqual([{
      testName: 'Pre-encryption exfiltration', controlId: 'T1567.002', hostname: null, scope: 'global',
      justification: 'Egress handled by proxy', acceptedBy: 'SOC lead', acceptedAt: '2026-10-01T00:00:00Z',
    }]);
    expect(report.findings[0].acceptedRisk).toBe(true);
  });

  describe('accepted-risk rows are scoped to the report', () => {
    const acceptance = (id: string, over: Record<string, unknown>) => ({
      acceptance_id: id, justification: `j-${id}`, accepted_by: 'u1', accepted_by_name: 'SOC lead',
      accepted_at: '2026-10-01T00:00:00Z', status: 'active', ...over,
    });
    const lookup = {
      // Same stage name, but another bundle's control: not this report's stage.
      'Pre-encryption exfiltration::T9999': [acceptance('other-bundle', { test_name: 'Pre-encryption exfiltration', control_id: 'T9999', scope: 'global' })],
      'Impact::T1486': [
        acceptance('out-of-scope-host', { test_name: 'Impact', control_id: 'T1486', scope: 'host', hostname: 'SRV-DC01' }),
        acceptance('in-scope-host', { test_name: 'Impact', control_id: 'T1486', scope: 'host', hostname: 'WS-FIN-014' }),
      ],
      'Pre-encryption exfiltration::T1567.002': [acceptance('global', { test_name: 'Pre-encryption exfiltration', control_id: 'T1567.002', scope: 'global' })],
    };

    it('keeps only acceptances for a stage and host in scope', async () => {
      const deps = makeDeps({ getAcceptances: vi.fn(async () => lookup) });
      const report = await new ExecutionReportService(settings, deps).generate(params({ includeAcceptedRisks: true }), NOW);
      expect(report.acceptedRisks?.map((r) => r.justification)).toEqual(['j-in-scope-host', 'j-global']);
    });

    it('keeps host-scoped acceptances for any host when the host list was capped', async () => {
      const deps = makeDeps({ getAcceptances: vi.fn(async () => lookup) });
      deps.client.search.mockImplementation(routeSearch(scopeResponse({ otherHostDocs: 7 })));
      const report = await new ExecutionReportService(settings, deps).generate(params({ includeAcceptedRisks: true }), NOW);
      expect(report.acceptedRisks?.map((r) => r.justification)).toEqual(['j-out-of-scope-host', 'j-in-scope-host', 'j-global']);
    });
  });

  it('scopes risk-acceptance reads to acceptanceOrg while ES and the Defense Score keep using org', async () => {
    const deps = makeDeps();
    await new ExecutionReportService(settings, deps)
      .generate(params({ org: 'agent-org', acceptanceOrg: 'org_clerk', includeAcceptedRisks: true }), NOW);
    expect(deps.getAcceptances).toHaveBeenCalledWith(expect.any(Array), 'org_clerk');
    const scope = { org: 'agent-org', from: '2026-09-13T23:40:00.000Z', to: '2026-10-13T23:40:00.000Z' };
    expect(deps.es.buildExtendedFilters).toHaveBeenCalledWith(scope);
    expect(deps.es.getDefenseScore).toHaveBeenCalledWith({ ...scope, scoringMode: 'any-stage' });
  });

  it('does not reuse the ES org as the acceptance org', async () => {
    const deps = makeDeps();
    await new ExecutionReportService(settings, deps)
      .generate(params({ org: 'agent-org', includeAcceptedRisks: true }), NOW);
    expect(deps.getAcceptances).toHaveBeenCalledWith(expect.any(Array), undefined);
  });

  it('keeps accepted risks empty and flags them unavailable when the lookup fails', async () => {
    const deps = makeDeps({ getAcceptances: vi.fn(async () => { throw new Error('risk index closed'); }) });
    const report = await new ExecutionReportService(settings, deps).generate(params({ includeAcceptedRisks: true }), NOW);
    expect(report.acceptedRisks).toEqual([]);
    expect(report.meta.unavailable).toEqual(['acceptedRisks']);
    expect(report.meta.warnings).toEqual(['Accepted risks unavailable']);
    expect(report.findings[0].acceptedRisk).toBe(false);
  });

  it('flags truncation and skips run start times above the strip threshold', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(scopeResponse({ runs: 1504 })));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.truncation.runs).toBe(true);
    expect(deps.getRunStartTimes).not.toHaveBeenCalled();
    expect(report.runs[0].startedAt).toBeNull();
    expect(report.meta.unavailable).toEqual([]); // skipped on purpose, not a failure
  });

  it('keeps ES metadata when the catalog has no entry for a test', async () => {
    // Custom upload, or a test removed from the library: ES has it, the catalog does not.
    const deps = makeDeps({ getTestMetadata: vi.fn(() => null) });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(deps.getTestMetadata).toHaveBeenCalledWith(BUNDLE);
    expect(report.tests).toHaveLength(1);
    expect(report.tests[0]).toMatchObject({
      testKey: BUNDLE, name: 'LockBit 3.0 Double Extortion Kill Chain', category: 'intel-driven',
      description: null, severity: 'critical', threatActor: 'LockBit 3.0 (S1202)', score: null,
    });
    expect(report.tests[0].stages.map((s) => s.controlId)).toEqual(['T1567.002', 'T1486']);
    expect(report.meta.warnings).toEqual([]);
  });

  it('skips correlation when no EDR is configured', async () => {
    const deps = makeDeps({ vendors: { defender: false, crowdstrike: false } });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(deps.client.msearch).not.toHaveBeenCalled();
    expect(report.meta.edrVendors).toEqual([]);
    expect(report.runs[0].alerts).toEqual([]);
    expect(report.runs.every((r) => r.alertsChecked === false)).toBe(true);
    expect(report.meta.unavailable).toEqual([]);
  });

  it('flags alerts unavailable when a vendor answered but every sub-search failed', async () => {
    const deps = makeDeps();
    deps.client.msearch.mockResolvedValue({ responses: [{ error: { type: 'search_phase_execution_exception' } }] });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.runs[0].alerts).toEqual([]);
    expect(report.runs[0].alertsChecked).toBe(false);
    expect(report.meta.unavailable).toEqual(['alerts']);
    expect(report.meta.warnings).toEqual(['Microsoft Defender alerts partially unavailable: 2 searches failed']);
  });

  it('keeps one vendor\'s alerts when the other vendor rejects', async () => {
    const deps = makeDeps({ vendors: { defender: true, crowdstrike: true } });
    deps.client.msearch.mockImplementation(async (req: { searches: { index?: string }[] }) => {
      if (req.searches[0].index === 'achilles-defender') throw new Error('defender index closed');
      return msearchHits({ 'achilles-crowdstrike': 'FalconDetection' })(req);
    });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.edrVendors).toEqual(['defender', 'crowdstrike']);
    expect(report.runs[0].alerts).toHaveLength(1);
    expect(report.runs[0].alerts[0]).toMatchObject({ vendor: 'crowdstrike', title: 'FalconDetection' });
    // CrowdStrike's alerts stay, but no run was checked by every configured vendor.
    expect(report.runs[0].alertsChecked).toBe(false);
    expect(report.meta.warnings).toEqual(['Microsoft Defender alerts unavailable']);
    expect(report.meta.unavailable).toEqual(['alerts']);
  });

  it('correlates SentinelOne alerts from achilles-sentinelone when SentinelOne is configured', async () => {
    const deps = makeDeps({ vendors: { defender: false, crowdstrike: false, sentinelone: true } });
    deps.client.msearch.mockImplementation(msearchHits({ 'achilles-sentinelone': 'S1Threat' }));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.edrVendors).toEqual(['sentinelone']);
    expect(deps.client.msearch.mock.calls[0][0].searches[0].index).toBe('achilles-sentinelone');
    expect(report.runs[0].alerts[0]).toMatchObject({ vendor: 'sentinelone', title: 'S1Threat' });
  });

  it('flags alerts unavailable when every configured vendor fails', async () => {
    const deps = makeDeps({ vendors: { defender: true, crowdstrike: true } });
    deps.client.msearch.mockRejectedValue(new Error('cluster busy'));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.runs[0].alerts).toEqual([]);
    expect(report.meta.warnings).toEqual([
      'Microsoft Defender alerts unavailable',
      'CrowdStrike Falcon alerts unavailable',
    ]);
    expect(report.meta.unavailable).toEqual(['alerts']);
  });

  it('cuts off a hung vendor at its own budget without losing the other vendor', async () => {
    const deps = makeDeps({ vendors: { defender: true, crowdstrike: true }, vendorBudgetMs: 50, budgetMs: 5_000 });
    deps.client.msearch.mockImplementation((req: { searches: { index?: string }[] }) =>
      (req.searches[0].index === 'achilles-defender'
        ? new Promise(() => {})
        : msearchHits({ 'achilles-crowdstrike': 'FalconDetection' })(req)));
    const started = Date.now();
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(report.runs[0].alerts).toHaveLength(1);
    expect(report.runs[0].alerts[0]).toMatchObject({ vendor: 'crowdstrike', title: 'FalconDetection' });
    expect(report.runs[0].alertsChecked).toBe(false);
    expect(report.meta.warnings).toEqual(['Microsoft Defender alerts unavailable: time budget reached']);
    expect(report.meta.unavailable).toEqual(['alerts']);
  });

  it('warns when some correlation searches failed but keeps the alerts that were found', async () => {
    const deps = makeDeps();
    deps.client.msearch
      .mockImplementationOnce(async () => ({ responses: [{ error: { type: 'search_phase_execution_exception' } }] }))
      .mockImplementation(msearchHits({ 'achilles-defender': 'RcloneExfiltration' }));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.warnings).toEqual(['Microsoft Defender alerts partially unavailable: 1 searches failed']);
    expect(report.runs[0].alerts[0]).toMatchObject({ vendor: 'defender', title: 'RcloneExfiltration' });
    expect(report.runs[0].alertsChecked).toBe(true); // the tier-2 search answered
    expect(report.meta.unavailable).toEqual([]);
  });

  it('warns when the vendor time budget cuts correlation short', async () => {
    const deps = makeDeps({ vendorBudgetMs: -1 });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(deps.client.msearch).not.toHaveBeenCalled();
    expect(report.runs[0].alerts).toEqual([]);
    expect(report.meta.warnings).toEqual(['Microsoft Defender alerts incomplete: time budget reached']);
    expect(report.runs[0].alertsChecked).toBe(false);
    expect(report.meta.unavailable).toEqual(['alerts']);
  });

  it('maps a required query failure to a 502', async () => {
    const deps = makeDeps();
    deps.client.search.mockRejectedValue(new Error('search_phase_execution_exception'));
    await expect(new ExecutionReportService(settings, deps).generate(params(), NOW)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('maps a timeline query failure to a 502', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(async (req: { aggs: Record<string, any> }) => {
      if (req.aggs.timeline) throw new Error('too_many_buckets');
      return routeSearch()(req);
    });
    await expect(new ExecutionReportService(settings, deps).generate(params(), NOW)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('rejects an unknown time zone with a 400', async () => {
    await expect(new ExecutionReportService(settings, makeDeps()).generate(params({ tz: 'Nope/Nowhere' }), NOW))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('organization name', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names the deployment organization when the URL names no org', async () => {
    vi.stubEnv('ORGANIZATION_NAME', '  Banco\n  Caribe  ');
    const report = await new ExecutionReportService(settings, makeDeps()).generate(params(), NOW);
    expect(report.meta.org).toEqual({ id: null, name: 'Banco Caribe' });
  });

  it('leaves the name empty when ORGANIZATION_NAME is blank', async () => {
    vi.stubEnv('ORGANIZATION_NAME', ' \t ');
    const report = await new ExecutionReportService(settings, makeDeps()).generate(params(), NOW);
    expect(report.meta.org).toEqual({ id: null, name: null });
  });

  it('lets an org named in the URL win over the deployment name', async () => {
    vi.stubEnv('ORGANIZATION_NAME', 'Acme Corp');
    const [mappedId, mappedName] = Object.entries(ORG_NAMES)[0];
    const mapped = await new ExecutionReportService(settings, makeDeps()).generate(params({ org: mappedId }), NOW);
    expect(mapped.meta.org).toEqual({ id: mappedId, name: mappedName });
    // An unmapped agent org prints its id; it is a subset of the deployment, not the whole of it.
    const unmapped = await new ExecutionReportService(settings, makeDeps()).generate(params({ org: 'agent-org' }), NOW);
    expect(unmapped.meta.org).toEqual({ id: 'agent-org', name: null });
  });
});

describe('deploymentOrgName', () => {
  it('reads nothing as unset', () => {
    expect(deploymentOrgName(undefined)).toBeNull();
    expect(deploymentOrgName('')).toBeNull();
  });

  it('keeps a name of exactly ORG_NAME_MAX characters', () => {
    const name = 'x'.repeat(ORG_NAME_MAX);
    expect(deploymentOrgName(name)).toBe(name);
  });

  it('cuts a longer name to ORG_NAME_MAX characters ending in an ellipsis', () => {
    const cut = deploymentOrgName('x'.repeat(ORG_NAME_MAX + 20))!;
    expect(Array.from(cut)).toHaveLength(ORG_NAME_MAX);
    expect(cut.endsWith('x…')).toBe(true);
  });

  it('does not leave a space before the ellipsis', () => {
    const cut = deploymentOrgName(`${'x'.repeat(ORG_NAME_MAX - 2)} tail`)!;
    expect(cut).toBe(`${'x'.repeat(ORG_NAME_MAX - 2)}…`);
  });

  it('counts characters, not UTF-16 units, so it never splits a surrogate pair', () => {
    const cut = deploymentOrgName('\u{1F6E1}'.repeat(ORG_NAME_MAX + 1))!;
    expect(Array.from(cut)).toHaveLength(ORG_NAME_MAX);
    expect(cut).toBe(`${'\u{1F6E1}'.repeat(ORG_NAME_MAX - 1)}…`);
  });
});

describe('partial shard failures', () => {
  const PARTIAL_WARNING = 'Some indices could not be read; totals may be incomplete';
  const partialShards = () => ({
    total: 2, successful: 1, failed: 1, failures: [{ index: 'achilles-results-old', reason: { reason: 'boom' } }],
  });
  const withShards = (res: object, shards: object) => Object.assign(res, { _shards: shards });

  it('renders and flags meta.partial when the failed indices hold data in scope', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(withShards(scopeResponse(), partialShards())));
    deps.client.count.mockResolvedValue({ count: 3 });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.totals.runs).toBe(1);
    expect(report.meta.partial).toEqual({ failedShards: 1, totalShards: 2 });
    expect(report.meta.warnings).toEqual([PARTIAL_WARNING]);
    expect(report.meta.warnings.join(' ')).not.toContain('boom');
    expect(deps.client.count).toHaveBeenCalledTimes(1);
    expect(deps.client.count.mock.calls[0][0]).toEqual({
      index: ['achilles-results-old'], query: { bool: { filter: [{ match_all: {} }] } },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('only logs when the failed indices hold nothing in scope', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(withShards(scopeResponse(), partialShards())));
    deps.client.count.mockResolvedValue({ count: 0 });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.partial).toBeNull();
    expect(report.meta.warnings).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('achilles-results-old'));
  });

  it('flags meta.partial when the count probe fails', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(withShards(scopeResponse(), partialShards())));
    deps.client.count.mockRejectedValue(new Error('probe refused'));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.partial).toEqual({ failedShards: 1, totalShards: 2 });
    expect(report.meta.warnings).toEqual([PARTIAL_WARNING]);
  });

  it('does not trust a zero count from a probe that lost shards itself', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(withShards(scopeResponse(), partialShards())));
    deps.client.count.mockResolvedValue({ count: 0, _shards: { total: 1, successful: 0, failed: 1 } });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(report.meta.partial).toEqual({ failedShards: 1, totalShards: 2 });
    expect(report.meta.warnings).toEqual([PARTIAL_WARNING]);
  });

  it('keeps the worst query\'s shard counts instead of summing them', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(async (req: { aggs: Record<string, any> }) =>
      withShards(await routeSearch()(req), partialShards()));
    deps.client.count.mockResolvedValue({ count: 1 });
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(deps.client.search).toHaveBeenCalledTimes(4);
    expect(report.meta.partial).toEqual({ failedShards: 1, totalShards: 2 });
    expect(deps.client.count).toHaveBeenCalledTimes(1);
  });

  it('maps a failure on every shard to a 502', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(withShards(scopeResponse(), { total: 2, successful: 0, failed: 2 })));
    await expect(new ExecutionReportService(settings, deps).generate(params(), NOW)).rejects.toMatchObject({ statusCode: 502 });
    expect(deps.client.count).not.toHaveBeenCalled();
  });

  it('bounds the required queries and the probe by the request budget', async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(routeSearch(withShards(scopeResponse(), partialShards())));
    await new ExecutionReportService(settings, deps).generate(params(), NOW);
    for (const call of [...deps.client.search.mock.calls, ...deps.client.count.mock.calls]) {
      expect(call[1]).toEqual({ requestTimeout: expect.any(Number) });
      expect(call[1].requestTimeout).toBeGreaterThanOrEqual(1);
      expect(call[1].requestTimeout).toBeLessThanOrEqual(5_000);
    }
  });
});

describe('payload size at the caps', () => {
  const RUNS = 500;
  const STAGES = 60;
  const controls = Array.from({ length: STAGES }, (_, i) => `CH-DEF-${String(i + 1).padStart(3, '0')}`);
  const member = (run: number, controlId: string, i: number) => ({
    _id: `${TASK}::${controlId}`,
    _source: {
      event: { ERROR: i % 2 ? 101 : 126 }, routing: { hostname: `WS-FIN-${run}` },
      f0rtika: {
        is_bundle_control: true, bundle_id: BUNDLE, bundle_name: 'Microsoft Defender Hardening Baseline', control_id: controlId,
        control_validator: 'Windows Defender', test_name: `${controlId} Microsoft Defender real-time protection is enabled`,
        techniques: ['T1562.001'], tactics: ['defense-evasion'],
      },
    },
  });
  const bigRuns = { aggregations: { runs: { buckets: Array.from({ length: RUNS }, (_, r) => ({
    key: `bundle::${BUNDLE}::WS-FIN-${r}::${T_RUN - r * 60_000}`, doc_count: STAGES, completed: { value: T_RUN - r * 60_000 },
    members: { hits: { hits: controls.map((c, i) => member(r, c, i)) } },
  })) } } };

  it(`keeps a ${RUNS} runs × ${STAGES} stages report under 4 MB by dropping per-stage names, techniques and tactics`, async () => {
    const deps = makeDeps();
    deps.client.search.mockImplementation(async (req: { aggs: Record<string, any> }) =>
      (req.aggs.runs?.terms ? bigRuns : routeSearch(scopeResponse({ runs: RUNS }))(req)));
    deps.client.msearch.mockImplementation(async ({ searches }: { searches: unknown[] }) => ({
      responses: Array.from({ length: searches.length / 2 }, () => ({ hits: { hits: [] } })),
    }));
    const report = await new ExecutionReportService(settings, deps).generate(params(), NOW);

    expect(report.runs).toHaveLength(RUNS);
    expect(report.runs[0].stages).toHaveLength(STAGES);
    expect(report.runs[0].stages[0]).toEqual({ controlId: 'CH-DEF-001', order: 1, outcome: 'protected', exitCode: 126, highImpact: false });
    expect(report.runs.some((r) => r.stages.some((s) => 'name' in s || 'techniques' in s || 'tactics' in s))).toBe(false);
    expect(JSON.stringify(report).length).toBeLessThan(4_000_000);
    // Correlation ran on the full stages: the technique+host fallback still names the stage techniques.
    const fallback = deps.client.msearch.mock.calls.map(([req]: [{ searches: any[] }]) => JSON.stringify(req.searches[1].query));
    expect(fallback.some((q: string) => q.includes('"mitre_techniques":["T1562.001"]'))).toBe(true);
  });
});

describe('ES client lifecycle', () => {
  const fakeClient = () => ({
    search: vi.fn(routeSearch()),
    msearch: vi.fn(msearchHits({})),
    count: vi.fn(async () => ({ count: 0 })),
    close: vi.fn(async () => {}),
  });

  beforeEach(() => {
    vi.mocked(createEsClient).mockReset();
  });

  it('closes the client it created once the report is built', async () => {
    const client = fakeClient();
    vi.mocked(createEsClient).mockReturnValue(client as never);
    const { client: _injected, ...deps } = makeDeps();
    await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(createEsClient).toHaveBeenCalledTimes(1);
    expect(client.search).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('closes it when the report fails too', async () => {
    const client = fakeClient();
    client.search.mockRejectedValue(new Error('search_phase_execution_exception'));
    vi.mocked(createEsClient).mockReturnValue(client as never);
    const { client: _injected, ...deps } = makeDeps();
    await expect(new ExecutionReportService(settings, deps).generate(params(), NOW)).rejects.toMatchObject({ statusCode: 502 });
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('leaves an injected client open', async () => {
    const deps = makeDeps();
    deps.client.close = vi.fn(async () => {});
    await new ExecutionReportService(settings, deps).generate(params(), NOW);
    expect(createEsClient).not.toHaveBeenCalled();
    expect(deps.client.close).not.toHaveBeenCalled();
  });
});
