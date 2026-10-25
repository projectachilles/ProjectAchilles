// Execution report orchestration — GET /api/reports/executions (spec §5.2).
//
// Required phase: scope, tests and runs aggregations in parallel, then the
// timeline (it needs the top tests as lanes). A failed query is a 502, and so
// is a query on which every shard failed. A partial shard failure renders: a
// count probe asks whether the failed indices hold any doc in scope; if they
// do (or the probe cannot tell), meta.partial and a short warning say the
// totals may be incomplete. The raw ES reason only goes to the server log.
// Optional phase: Defense Score, EDR alerts, run start times and accepted
// risks run in parallel inside one time budget; each failure or timeout
// becomes a short meta.warnings entry (the raw error, which can name internal
// hosts, only goes to the server log) and the report still renders.
// An instance builds one report: the ES client it creates is closed after it.
// Byte-identical in backend/ and backend-serverless/: fork differences sit
// behind taskTiming.ts, the catalog and the route.

import { randomBytes } from 'crypto';
import type { Client } from '@elastic/elasticsearch';
import { createEsClient } from '../analytics/client.js';
import { ElasticsearchService, ORG_NAMES } from '../analytics/elasticsearch.js';
import { RiskAcceptanceService, type RiskAcceptance } from '../risk-acceptance/risk-acceptance.service.js';
import { getTestDirectory, getTestMetadata } from '../agent/test-catalog.service.js';
import { AppError } from '../../middleware/error.middleware.js';
import { getRunStartTimes } from './taskTiming.js';
import { readDefenseGuidance } from './guidanceExcerpt.js';
import { correlateRuns, CROWDSTRIKE_ADAPTER, DEFENDER_ADAPTER, SENTINELONE_ADAPTER, type CorrelationRun, type VendorAdapter } from './alertCorrelation.js';
import { computeTimeAxis, resolveReportWindow, validateTimeZone } from './reportWindow.js';
import {
  LANES_CAP, OTHER_LANE, RUN_STRIP_MAX_RUNS, TESTS_CAP,
  runsRequest, scopeQuery, scopeRequest, testsRequest, timelineRequest,
} from './reportQueries.js';
import { parseRuns, parseScope, parseTests, parseTimeline } from './reportParsers.js';
import { attachGuidance, markAcceptedRisks, rankFindings } from './reportFindings.js';
import { emptyCounts } from './stageOutcome.js';
import type { AnalyticsSettings, DefenseScoreResponse, ExtendedAnalyticsQueryParams } from '../../types/analytics.js';
import type { TestMetadata } from '../../types/test.js';
import type {
  AcceptedRiskRow, ExecutionReport, ReportAlert, ReportDefenseScore, ReportEnrichment, ReportMeta, ReportRun, ReportRunStage,
  ReportTest, ReportTimelineLane,
} from '../../types/reports.js';

export const REPORT_BUDGET_MS = 45_000;
export const VENDOR_BUDGET_MS = 15_000;
/** Longest organization name the report prints, in characters; it shares the page header with the date range. */
export const ORG_NAME_MAX = 56;

/**
 * The organization this deployment serves (ORGANIZATION_NAME), as the report prints it.
 * Runs of whitespace, line breaks included, become one space; a blank value means unset;
 * a longer name is cut to ORG_NAME_MAX characters, the last one an ellipsis.
 */
export function deploymentOrgName(raw: string | undefined = process.env.ORGANIZATION_NAME): string | null {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const chars = Array.from(name);
  return chars.length > ORG_NAME_MAX ? `${chars.slice(0, ORG_NAME_MAX - 1).join('').trimEnd()}…` : name;
}

const FILTER_KEYS = [
  'org', 'from', 'to', 'result', 'hostnames', 'tests', 'techniques', 'categories',
  'severities', 'threatActors', 'tags', 'errorNames', 'errorCodes', 'bundleNames',
] as const;
type FilterParams = Partial<Pick<ExtendedAnalyticsQueryParams, (typeof FILTER_KEYS)[number]>>;

export interface ExecutionReportParams extends FilterParams {
  tz: string;
  includeAcceptedRisks: boolean;
  /** Org that scopes risk-acceptance reads — the caller's Clerk org (getUserOrgId), never the ES agent-org filter. */
  acceptanceOrg?: string;
}

export interface ExecutionReportDeps {
  client: Client;
  es: Pick<ElasticsearchService, 'buildExtendedFilters' | 'getDefenseScore'>;
  vendors: { defender: boolean; crowdstrike: boolean; sentinelone?: boolean };
  getTestMetadata: (uuid: string) => TestMetadata | null;
  readGuidance: (testKey: string) => string | null;
  getRunStartTimes: (taskIds: string[]) => Promise<Map<string, string>>;
  getAcceptances: (testNames: string[], org?: string) => Promise<Record<string, RiskAcceptance[]>>;
  budgetMs: number;
  vendorBudgetMs: number;
}

/** Fixed order for meta.unavailable, whatever order the steps finished in. */
const ENRICHMENT_ORDER: readonly ReportEnrichment[] = ['defenseScore', 'alerts', 'startTimes', 'acceptedRisks'];

/** What `correlate()` hands back: warnings are returned, not pushed, so a step abandoned at the deadline cannot add any late. */
interface Correlation {
  alerts: Map<string, ReportAlert[]>;
  warnings: string[];
  /** Run keys every configured vendor completed a search for (a vendor that rejected or timed out searched none). */
  checked: Set<string>;
}

const VENDOR_LABEL: Record<ReportAlert['vendor'], string> = {
  defender: 'Microsoft Defender',
  crowdstrike: 'CrowdStrike Falcon',
  sentinelone: 'SentinelOne Singularity',
};

const PARTIAL_WARNING = 'Some indices could not be read; totals may be incomplete';

/**
 * Shard failures seen by the required queries. The counts are the worst single
 * query's, not a sum: the same broken shard fails in every query.
 */
interface ShardFailures {
  failed: number;
  total: number;
  indices: Set<string>;
  reasons: Set<string>;
}

interface ShardsInfo {
  total?: number;
  successful?: number;
  failed?: number;
  failures?: { index?: string; reason?: { reason?: string } }[];
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** withDeadline's rejection, so a warning can say "time budget reached" without echoing raw errors. */
class DeadlineError extends Error {
  constructor() {
    super('time budget reached');
  }
}

/** Report-facing text for an enrichment failure; the raw error goes to the server log. */
function unavailableWarning(label: string, err: unknown): string {
  console.warn(`Execution report: ${label} unavailable: ${errorMessage(err)}`);
  return err instanceof DeadlineError ? `${label} unavailable: time budget reached` : `${label} unavailable`;
}

/** ES transport options that end a request when the report budget does. */
const untilDeadline = (deadline: number) => ({ requestTimeout: Math.max(1, deadline - Date.now()) });

async function withDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError()), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function pickFilters(params: ExecutionReportParams): FilterParams {
  const out: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out as FilterParams;
}

function echoFilters(params: ExecutionReportParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    if (key === 'from' || key === 'to') continue;
    const value = params[key];
    if (value === undefined || value === '' || (key === 'result' && value === 'all')) continue;
    out[key] = String(value);
  }
  return out;
}

function outcomeFilters(params: ExecutionReportParams): string[] {
  const out: string[] = [];
  if (params.result && params.result !== 'all') out.push(`result=${params.result}`);
  if (params.errorNames) out.push(`errorNames=${params.errorNames}`);
  if (params.errorCodes) out.push(`errorCodes=${params.errorCodes}`);
  return out;
}

function makeReportId(now: Date): string {
  return `RPT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

/** No conclusive result left (none in scope, or every one risk-accepted) → score null; the raw score and accepted count still show. */
function toDefenseScore(d: DefenseScoreResponse | null): ReportDefenseScore | null {
  if (!d) return null;
  const accepted = d.riskAcceptedCount ?? 0;
  return {
    score: d.totalExecutions ? d.score : null,
    rawScore: accepted > 0 ? d.rawScore ?? null : null,
    riskAcceptedCount: accepted,
  };
}

const acceptanceScope = (a: RiskAcceptance): 'host' | 'global' => a.scope ?? (a.hostname ? 'host' : 'global');

/**
 * The lookup matches on stage name only, so it also returns other bundles' controls that share a
 * stage name and acceptances for hosts outside the filter. Keep an acceptance only when (a) a stage
 * in scope has its name and, if it names a control, that control; and (b) it is global or its host
 * is in scope. When the scope's host list was capped, (b) cannot be decided and is skipped.
 */
function toAcceptedRiskRows(
  acceptances: Record<string, RiskAcceptance[]> | null,
  tests: ReportTest[],
  hosts: { names: string[]; capped: boolean },
): AcceptedRiskRow[] {
  const stages = tests.flatMap((t) => t.stages);
  const hostNames = new Set(hosts.names);
  const inScope = (a: RiskAcceptance): boolean =>
    stages.some((s) => s.name === a.test_name && (!a.control_id || a.control_id === s.controlId))
    && (acceptanceScope(a) === 'global' || hosts.capped || (a.hostname !== undefined && hostNames.has(a.hostname)));
  const unique = new Map<string, RiskAcceptance>();
  for (const list of Object.values(acceptances ?? {})) for (const a of list) unique.set(a.acceptance_id, a);
  return [...unique.values()]
    .filter(inScope)
    .map((a) => ({
      testName: a.test_name,
      controlId: a.control_id ?? null,
      hostname: a.hostname ?? null,
      scope: acceptanceScope(a),
      justification: a.justification,
      acceptedBy: a.accepted_by_name || a.accepted_by,
      acceptedAt: a.accepted_at,
    }))
    .sort((x, y) => x.testName.localeCompare(y.testName) || (x.hostname ?? '').localeCompare(y.hostname ?? ''));
}

function buildLanes(tests: ReportTest[]): ReportTimelineLane[] {
  const lanes = tests.slice(0, LANES_CAP).map((t) => ({ testKey: t.testKey, name: t.name, runs: t.runs }));
  const rest = tests.slice(LANES_CAP);
  if (rest.length > 0) {
    lanes.push({ testKey: OTHER_LANE, name: `Other tests (${rest.length})`, runs: rest.reduce((sum, t) => sum + t.runs, 0) });
  }
  return lanes;
}

/**
 * Above RUN_STRIP_MAX_RUNS, run stages drop name, techniques and tactics: tests[].stages carries them
 * by controlId, and at 500 runs × 60 stages they would push the payload past the 4.5 MB serverless
 * response limit. Only for payload assembly — correlation and findings read the full stages first.
 */
function payloadRuns(runs: ReportRun[]): ReportRun[] {
  if (runs.length <= RUN_STRIP_MAX_RUNS) return runs;
  const slim = (s: ReportRunStage): ReportRunStage => ({
    controlId: s.controlId, order: s.order, outcome: s.outcome, exitCode: s.exitCode, highImpact: s.highImpact,
  });
  return runs.map((run) => ({ ...run, stages: run.stages.map(slim) }));
}

/** Credit each correlated alert to the stage its evidence binary names. */
function countStageAlerts(tests: ReportTest[], runs: ReportRun[]): void {
  const byKey = new Map(tests.map((t) => [t.testKey, t]));
  for (const run of runs) {
    const test = byKey.get(run.testKey);
    if (!test) continue;
    for (const alert of run.alerts) {
      const token = alert.stageControlId;
      // A standalone test has one stage, which takes every alert. A bundle filtered down to one
      // stage does not: the alert must still name that stage's control.
      const stage = !test.isBundle && test.stages.length === 1
        ? test.stages[0]
        : token === null
          ? undefined
          : test.stages.find((s) => {
              const id = s.controlId?.toLowerCase();
              return id !== undefined && (token === id || token.startsWith(`${id}-`));
            });
      if (stage) stage.alerts[alert.vendor]++;
    }
  }
}

function emptyReport(meta: ReportMeta): ExecutionReport {
  return {
    meta,
    totals: {
      runs: 0, runsApproximate: false, stageResults: 0, endpoints: 0, tests: 0, techniques: 0,
      tactics: 0, actors: 0, outcomes: emptyCounts(), highImpactUnprotected: 0,
    },
    defenseScore: null,
    timeline: { lanes: [], buckets: [] },
    tests: [],
    otherTests: [],
    techniques: [],
    actors: [],
    hosts: [],
    findings: [],
    runs: [],
    acceptedRisks: null,
  };
}

/** `testKey` is the bare catalog uuid, never a `<bundle>::<control>` composite. */
function defaultReadGuidance(testKey: string): string | null {
  const dir = getTestDirectory(testKey);
  return dir ? readDefenseGuidance(dir, testKey) : null;
}

export class ExecutionReportService {
  private readonly deps: ExecutionReportDeps;
  private ownClient: Client | null = null;

  constructor(
    private readonly settings: AnalyticsSettings,
    deps: Partial<ExecutionReportDeps> & Pick<ExecutionReportDeps, 'vendors'>,
  ) {
    const realClient = (): Client => (this.ownClient ??= createEsClient(settings));
    this.deps = {
      client: deps.client ?? realClient(),
      es: deps.es ?? new ElasticsearchService(settings),
      vendors: deps.vendors,
      getTestMetadata: deps.getTestMetadata ?? getTestMetadata,
      readGuidance: deps.readGuidance ?? defaultReadGuidance,
      getRunStartTimes: deps.getRunStartTimes ?? getRunStartTimes,
      getAcceptances: deps.getAcceptances
        ?? ((names, org) => new RiskAcceptanceService(realClient()).getAcceptancesForControls(names, org)),
      budgetMs: deps.budgetMs ?? REPORT_BUDGET_MS,
      vendorBudgetMs: deps.vendorBudgetMs ?? VENDOR_BUDGET_MS,
    };
  }

  async generate(params: ExecutionReportParams, now: Date = new Date()): Promise<ExecutionReport> {
    try {
      return await this.build(params, now);
    } finally {
      this.closeOwnClient();
    }
  }

  /**
   * Close the ES client this service created (never an injected one). Not awaited: close() waits for
   * in-flight requests, and a request abandoned at the deadline must not hold the response.
   */
  private closeOwnClient(): void {
    const client = this.ownClient;
    this.ownClient = null;
    client?.close().catch((err: unknown) => console.warn(`Execution report: ES client close failed: ${errorMessage(err)}`));
  }

  private async build(params: ExecutionReportParams, now: Date): Promise<ExecutionReport> {
    const deadline = Date.now() + this.deps.budgetMs;
    const warnings: string[] = [];
    const tz = validateTimeZone(params.tz || 'UTC');
    const window = resolveReportWindow({ from: params.from, to: params.to }, now);
    const filterParams: FilterParams = { ...pickFilters(params), from: window.effectiveFrom, to: window.effectiveTo };
    const filters = this.deps.es.buildExtendedFilters(filterParams);
    const shardFailures: ShardFailures = { failed: 0, total: 0, indices: new Set(), reasons: new Set() };

    // ── Required phase ──
    let scopeRes: unknown;
    let testsRes: unknown;
    let runsRes: unknown;
    try {
      [scopeRes, testsRes, runsRes] = await Promise.all([
        this.search(scopeRequest(filters), deadline, shardFailures),
        this.search(testsRequest(filters), deadline, shardFailures),
        this.search(runsRequest(filters), deadline, shardFailures),
      ]);
    } catch (err) {
      throw new AppError(`Report query failed: ${errorMessage(err)}`, 502);
    }

    const scope = parseScope(scopeRes);
    const axis = computeTimeAxis(window, scope.firstExecution);
    const meta: ReportMeta = {
      reportId: makeReportId(now),
      generatedAt: now.toISOString(),
      tz,
      org: { id: params.org ?? null, name: params.org ? ORG_NAMES[params.org] ?? null : deploymentOrgName() },
      filters: echoFilters(params),
      outcomeFiltered: outcomeFilters(params),
      window: { ...window, ...axis, firstExecution: scope.firstExecution, lastExecution: scope.lastExecution },
      truncation: { runs: false, tests: false, lanes: false },
      warnings,
      unavailable: [],
      partial: null,
      edrVendors: this.adapters().map((a) => a.vendor),
    };
    if (scope.stageResults + scope.outcomes.skipped === 0) {
      meta.partial = await this.probePartialFailure(shardFailures, filters, deadline, warnings);
      return emptyReport(meta);
    }

    const allTests = parseTests(testsRes).map((t) => this.withCatalog(t));
    const laneKeys = allTests.slice(0, LANES_CAP).map((t) => t.testKey);
    let timelineRes: unknown = {};
    if (laneKeys.length > 0) {
      try {
        timelineRes = await this.search(timelineRequest(filters, laneKeys, axis.bucket, tz), deadline, shardFailures);
      } catch (err) {
        throw new AppError(`Report query failed: ${errorMessage(err)}`, 502);
      }
    }
    meta.partial = await this.probePartialFailure(shardFailures, filters, deadline, warnings);
    const runs = parseRuns(runsRes);

    // ── Optional phase ──
    const unavailable = new Set<ReportEnrichment>();
    const optional = async <T>(label: string, section: ReportEnrichment, work: () => Promise<T>): Promise<T | null> => {
      try {
        return await withDeadline(work(), deadline);
      } catch (err) {
        warnings.push(unavailableWarning(label, err));
        unavailable.add(section);
        return null;
      }
    };
    const taskIds = runs.flatMap((r) => (r.taskId ? [r.taskId] : []));
    const stageNames = [...new Set(allTests.flatMap((t) => t.stages.map((s) => s.name)))];

    const [defense, correlation, startTimes, acceptances] = await Promise.all([
      optional('Defense Score', 'defenseScore', () => this.deps.es.getDefenseScore({ ...filterParams, scoringMode: 'any-stage' })),
      optional('EDR alerts', 'alerts', () => this.correlate(runs, deadline)),
      scope.runs <= RUN_STRIP_MAX_RUNS && taskIds.length > 0
        ? optional('Run start times', 'startTimes', () => this.deps.getRunStartTimes(taskIds))
        : Promise.resolve(null),
      params.includeAcceptedRisks
        ? optional('Accepted risks', 'acceptedRisks', () => this.deps.getAcceptances(stageNames, params.acceptanceOrg))
        : Promise.resolve(null),
    ]);

    if (correlation) warnings.push(...correlation.warnings);
    for (const run of runs) {
      run.alerts = correlation?.alerts.get(run.key) ?? [];
      run.alertsChecked = correlation?.checked.has(run.key) ?? false;
      run.startedAt = run.taskId ? startTimes?.get(run.taskId) ?? null : null;
    }
    // "Never searched" must not read as "no alerts": with EDR configured and no run checked, the section is unavailable.
    if (meta.edrVendors.length > 0 && runs.length > 0 && !runs.some((r) => r.alertsChecked)) unavailable.add('alerts');
    meta.unavailable = ENRICHMENT_ORDER.filter((section) => unavailable.has(section));

    countStageAlerts(allTests, runs);

    const findings = attachGuidance(
      markAcceptedRisks(rankFindings(scope.techniques, allTests), allTests, acceptances ?? {}),
      allTests,
      this.deps.readGuidance,
    );

    meta.truncation = { runs: scope.runs > runs.length, tests: allTests.length > TESTS_CAP, lanes: allTests.length > LANES_CAP };

    return {
      meta,
      totals: {
        runs: scope.runs,
        runsApproximate: scope.runsApproximate,
        stageResults: scope.stageResults,
        endpoints: scope.endpoints,
        tests: scope.tests,
        techniques: scope.techniques.length,
        tactics: scope.tactics,
        actors: scope.actors.length,
        outcomes: scope.outcomes,
        highImpactUnprotected: scope.highImpactUnprotected,
      },
      defenseScore: toDefenseScore(defense),
      timeline: { lanes: buildLanes(allTests), buckets: parseTimeline(timelineRes, laneKeys) },
      tests: allTests.slice(0, TESTS_CAP),
      otherTests: allTests.slice(TESTS_CAP).map((t) => ({ testKey: t.testKey, name: t.name, runs: t.runs, outcomes: t.outcomes })),
      techniques: scope.techniques,
      actors: scope.actors,
      hosts: scope.hosts,
      findings,
      runs: payloadRuns(runs),
      acceptedRisks: params.includeAcceptedRisks
        ? toAcceptedRiskRows(acceptances, allTests, { names: scope.hosts.map((h) => h.hostname), capped: scope.hostsCapped })
        : null,
    };
  }

  /**
   * A required query (Q1–Q4), bounded by the request budget. Throws when every shard failed.
   * A partial shard failure is recorded in `failures` and the response is used as is;
   * probePartialFailure() later decides whether the report must say so.
   */
  private async search(body: Record<string, unknown>, deadline: number, failures: ShardFailures): Promise<unknown> {
    const response = await this.deps.client.search(
      { index: this.settings.indexPattern, ...body } as never,
      untilDeadline(deadline),
    );
    const shards = (response as { _shards?: ShardsInfo })._shards;
    const reasons = (shards?.failures ?? []).flatMap((f) => (f.reason?.reason ? [f.reason.reason] : []));
    if (shards && (shards.total ?? 0) > 0 && shards.successful === 0) {
      throw new Error(`all ${shards.total} shards failed${reasons[0] ? `: ${reasons[0]}` : ''}`);
    }
    const failed = shards?.failed ?? 0;
    if (failed > 0) {
      if (failed > failures.failed) {
        failures.failed = failed;
        failures.total = shards?.total ?? 0;
      }
      for (const f of shards?.failures ?? []) if (f.index) failures.indices.add(f.index);
      for (const reason of reasons) failures.reasons.add(reason);
    }
    return response;
  }

  /**
   * After a partial shard failure, count the docs in scope on the failed indices. None: the
   * report is complete and the failure is only logged. Some, or unknown (the probe failed, lost
   * shards itself, or no index was named): meta.partial plus a short warning. Never fails the report.
   */
  private async probePartialFailure(
    failures: ShardFailures,
    filters: unknown[],
    deadline: number,
    warnings: string[],
  ): Promise<ReportMeta['partial']> {
    if (failures.failed === 0) return null;
    const indices = [...failures.indices];
    const detail = `${failures.failed} of ${failures.total} shards failed on [${indices.join(', ')}]: ${[...failures.reasons].join('; ') || 'no reason given'}`;
    let inScope: string;
    try {
      if (indices.length === 0) throw new Error('no failed index named');
      const res = await withDeadline(
        this.deps.client.count({ index: indices, query: scopeQuery(filters) } as never, untilDeadline(deadline)),
        deadline,
      );
      const { count, _shards: probeShards } = res as { count?: unknown; _shards?: ShardsInfo };
      const lost = probeShards?.failed ?? 0;
      // A zero from a count that lost shards itself proves nothing.
      if (count === 0 && lost === 0) {
        console.warn(`Execution report: ${detail}; the failed indices hold no data in scope`);
        return null;
      }
      inScope = typeof count === 'number' ? `${count}${lost > 0 ? ` (the probe lost ${lost} shards)` : ''}` : 'unknown';
    } catch (err) {
      inScope = `unknown (probe failed: ${errorMessage(err)})`;
    }
    console.warn(`Execution report: ${detail}; docs in scope on the failed indices: ${inScope}`);
    warnings.push(PARTIAL_WARNING);
    return { failedShards: failures.failed, totalShards: failures.total };
  }

  /** Catalog fields win over ES fields; the display name stays ES's (what the console shows). */
  private withCatalog(test: ReportTest): ReportTest {
    const md = this.deps.getTestMetadata(test.testKey);
    if (!md) return test;
    return {
      ...test,
      description: md.description ?? null,
      threatActor: md.threatActor ?? test.threatActor,
      severity: md.severity ?? test.severity,
      score: md.score ?? test.score,
      complexity: md.complexity ?? test.complexity,
      category: md.category ?? test.category,
      subcategory: md.subcategory ?? test.subcategory,
      tags: md.tags?.length ? md.tags : test.tags,
      target: md.target?.length ? md.target : test.target,
    };
  }

  /** The EDR vendors configured for this report, in a fixed order. */
  private adapters(): VendorAdapter[] {
    return [
      ...(this.deps.vendors.defender ? [DEFENDER_ADAPTER] : []),
      ...(this.deps.vendors.crowdstrike ? [CROWDSTRIKE_ADAPTER] : []),
      ...(this.deps.vendors.sentinelone ? [SENTINELONE_ADAPTER] : []),
    ];
  }

  /**
   * Each vendor fails alone, inside its own budget: one vendor's rejection or hang drops only that
   * vendor's alerts. `correlateRuns` only checks its deadline between batches, so the race is what
   * bounds an msearch that is already in flight. A run counts as checked only when every vendor
   * searched it.
   */
  private async correlate(runs: ReportRun[], deadline: number): Promise<Correlation> {
    const adapters = this.adapters();
    const merged = new Map<string, ReportAlert[]>();
    const warnings: string[] = [];
    if (adapters.length === 0 || runs.length === 0) return { alerts: merged, warnings, checked: new Set() };

    const correlationRuns: CorrelationRun[] = runs.map((r) => ({
      key: r.key,
      testKey: r.testKey,
      hostname: r.hostname,
      completedAt: r.completedAt,
      bundleName: r.key.startsWith('bundle::') ? r.testName : undefined,
      techniques: [...new Set(r.stages.flatMap((s) => s.techniques ?? []))],
    }));
    const vendorDeadline = Math.min(deadline, Date.now() + this.deps.vendorBudgetMs);
    const settled = await Promise.allSettled(
      adapters.map((a) => withDeadline(
        correlateRuns(this.deps.client, a, correlationRuns, { deadline: vendorDeadline }),
        vendorDeadline,
      )),
    );

    let checked = new Set(runs.map((r) => r.key));
    settled.forEach((outcome, i) => {
      const label = VENDOR_LABEL[adapters[i].vendor];
      if (outcome.status === 'rejected') {
        checked = new Set();
        warnings.push(unavailableWarning(`${label} alerts`, outcome.reason));
        return;
      }
      const res = outcome.value;
      checked = new Set([...checked].filter((key) => res.searched.has(key)));
      if (!res.complete) warnings.push(`${label} alerts incomplete: time budget reached`);
      if (res.failed > 0) warnings.push(`${label} alerts partially unavailable: ${res.failed} searches failed`);
      for (const [key, list] of res.alerts) merged.set(key, [...(merged.get(key) ?? []), ...list]);
    });
    for (const list of merged.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { alerts: merged, warnings, checked };
  }
}
