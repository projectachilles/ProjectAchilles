// Elasticsearch service for analytics queries

import { Client } from '@elastic/elasticsearch';
import { createEsClient } from './client.js';
import { RiskAcceptanceService } from '../risk-acceptance/risk-acceptance.service.js';
import { attackSimulationExclusions } from './attack-simulation-filter.js';
import { AppError } from '../../middleware/error.middleware.js';
import {
  MAX_FRESHNESS_DAYS,
  applyOutcomeFilters,
  groupPairs,
  latestPairsAsOf,
  postureSeries,
  resolvePostureWindow,
  summarizePairs,
} from './posture.js';
import type { OutcomeFilters, PairRun, PostureWindow } from './posture.js';
import { TtlPromiseCache } from './postureCache.js';
import type { TtlCacheOptions } from './postureCache.js';
import type {
  ExecutionActivityResponse,
  AnalyticsSettings,
  AnalyticsQueryParams,
  DefenseScoreResponse,
  TrendDataPoint,
  BreakdownItem,
  TestExecution,
  OrganizationInfo,
  OrgBreakdownItem,
  ErrorTypeBreakdown,
  TestCoverageItem,
  TechniqueDistributionItem,
  HostTestMatrixCell,
  EnrichedTestExecution,
  PaginatedResponse,
  ExtendedAnalyticsQueryParams,
  PaginatedExecutionsParams,
  FilterOption,
  SeverityBreakdownItem,
  CategoryBreakdownItem,
  CategorySubcategoryBreakdownItem,
  SubcategoryBreakdownItem,
  ThreatActorCoverageItem,
  TechniqueOutcomeItem,
  TestResultItem,
  ChainDepthBucket,
  ChainDepthResponse,
  DefenseScoreByHostItem,
  CanonicalTestCountResponse,
  ErrorRateResponse,
  ErrorRateTrendDataPoint,
  SeverityLevel,
  CategoryType,
  ExecutionGroup,
  GroupedPaginatedResponse,
} from '../../types/analytics.js';

// Canonical error code → name mapping
// Categories: protected, failed, inconclusive, contextual, error
export const ERROR_CODE_MAP: Record<number, { name: string; description: string; category: string }> = {
  0:   { name: 'NormalExit',                description: 'Normal exit - varies by context',              category: 'inconclusive' },
  1:   { name: 'BinaryNotRecognized',       description: 'Binary not recognized or permission denied',   category: 'contextual' },
  101: { name: 'Unprotected',               description: 'Attack succeeded - endpoint unprotected',      category: 'failed' },
  105: { name: 'FileQuarantinedOnExtraction', description: 'File quarantined during extraction',          category: 'protected' },
  126: { name: 'ExecutionPrevented',         description: 'Execution blocked/prevented by AV/EDR',       category: 'protected' },
  127: { name: 'QuarantinedOnExecution',     description: 'Quarantined on execution attempt',            category: 'protected' },
  200: { name: 'NoOutput',                   description: 'No output - quick AV block before execution', category: 'inconclusive' },
  259: { name: 'StillActive',               description: 'Windows STILL_ACTIVE - process timeout',      category: 'inconclusive' },
  260: { name: 'BlockedPreExecution',      description: 'Blocked before execution by ASR/app-control - technique not evaluated', category: 'inconclusive' },
  999: { name: 'UnexpectedTestError',        description: 'Test error - prerequisites not met',          category: 'error' },
};

/** Resolve an error code to its canonical name, with optional fallback to f0rtika.error_name */
export function resolveErrorName(errorCode: number | undefined, storedName?: string): string {
  if (errorCode !== undefined && ERROR_CODE_MAP[errorCode]) {
    return ERROR_CODE_MAP[errorCode].name;
  }
  if (storedName) return storedName;
  return `Unknown (${errorCode ?? '?'})`;
}

/** Get field value from ES _source — handles both flattened (dot-key) and nested formats */
function getField(source: any, path: string): any {
  if (source[path] !== undefined) return source[path];
  const parts = path.split('.');
  let value = source;
  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }
  return value;
}

// ── basis=latest response-parsing helpers ──────────────────────────────────
// top_metrics returns booleans as "true"/"false" strings and dates as ISO
// strings (ES 8.17); composite terms on a date field key by epoch ms.

function esBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function parseEsTime(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.NaN;
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' ? [v] : [];
}

/** Canonical names of the codes plus any stored names (the outcome filter matches either). */
function errorNamesFor(codes: number[], storedNames: string[]): string[] {
  const names = new Set<string>();
  for (const c of codes) {
    const canonical = ERROR_CODE_MAP[c]?.name;
    if (canonical) names.add(canonical);
  }
  for (const n of storedNames) if (n) names.add(n);
  return [...names];
}

// ── basis=latest pair snapshots ────────────────────────────────────────────

/** A fetched set of pair runs, cached for a few seconds (postureCache.ts). */
interface PostureSnapshot {
  window: PostureWindow;
  runs: PairRun[];
  rawRuns: PairRun[] | null;
}

interface PairFetchOptions {
  withMetadata: boolean;
  latestOnly: boolean;
}

/**
 * An any-stage bundle run with what the chain-depth card needs. Only
 * fetchBundlePairRuns builds these; per-doc runs are plain PairRuns. Kept out
 * of posture.ts so the shared pure module stays untouched.
 */
interface ChainRun extends PairRun {
  /** Stages that ran: the run's conclusive control docs (skipped stages are exit 0, filtered out). */
  stagesRun: number;
  /** Some stage was Defender/CrowdStrike-detected without being blocked (is_protected false). */
  alertedUnblocked: boolean;
  /** "Stage N" numbers of the blocked stages; null when any blocked stage has no such validator. */
  blockedStages: number[] | null;
  /** "Stage N" numbers of the detected-but-unblocked stages; null when any has no such validator. */
  alertedStages: number[] | null;
}

function isChainRun(run: PairRun): run is ChainRun {
  return typeof (run as Partial<ChainRun>).stagesRun === 'number';
}

/** Pair key of an any-stage bundle pair: one per (oid, bundle_id, hostname). */
function bundlePairKey(oid: unknown, bundleId: string, hostname: string): string {
  return `${oid ?? ''}|bundle:${bundleId}|${hostname}`;
}

/**
 * Test (or bundle) UUID behind a pair key: plain `oid|<uuid>|host`, any-stage
 * bundle `oid|bundle:<id>|host`, cyber-hygiene control `oid|<bundle>::<control>|host`.
 */
export function pairTestUuid(pairKey: string): string {
  const id = pairKey.split('|')[1] ?? '';
  return (id.startsWith('bundle:') ? id.slice('bundle:'.length) : id).split('::')[0];
}

/**
 * Everything that shapes a basis=latest fetch, resolved once per request so
 * every query behind one answer uses the exact same clauses.
 */
interface PostureScope {
  window: PostureWindow;
  outcome: OutcomeFilters;
  isAnyStage: boolean;
  org: string | undefined;
  clauses: any[];
  exclusionFilter: unknown;
  /** Cache-key fields shared by every latest-basis fetch. */
  keyBase: Record<string, unknown>;
}

interface PostureShapeSpec extends PairFetchOptions {
  /** Widen the lower bound by one freshness window (series lookback). */
  lookback: boolean;
  /** Also fetch the runs without the risk-acceptance exclusion. */
  withRaw: boolean;
}

type PostureShape = 'series' | 'metadata';

/** The two snapshot shapes: tile + trend share 'series'; the four breakdowns share 'metadata'. */
const POSTURE_SHAPES: Record<PostureShape, PostureShapeSpec> = {
  series: { lookback: true, withMetadata: false, withRaw: true, latestOnly: false },
  metadata: { lookback: false, withMetadata: true, withRaw: false, latestOnly: true },
};

/**
 * 30 s from settle. Weight = runs + rawRuns, measured at ~450 B per PairRun
 * (V8, ~140-char pair keys). A snapshot over 500k runs is served but not
 * kept, and all cached snapshots together hold at most 500k runs (~225 MB),
 * so the cache adds at most the footprint of one maximal snapshot. The
 * chain-depth inconclusive-runs cache is separate and much smaller
 * (INCONCLUSIVE_CACHE_MAX_ENTRIES pair entries in total).
 */
const POSTURE_CACHE_OPTIONS: TtlCacheOptions<PostureSnapshot> = {
  ttlMs: 30_000,
  maxEntries: 16,
  maxEntryWeight: 500_000,
  maxTotalWeight: 500_000,
  weigh: (s) => s.runs.length + (s.rawRuns?.length ?? 0),
};

/**
 * Budget of the chain-depth inconclusive-runs cache, in pair entries across
 * all cached maps (one pair key + one timestamp each, ~200 B, so ~10 MB at
 * most). It holds only the sparse errored chain runs; a map over this is
 * served but not kept.
 */
const INCONCLUSIVE_CACHE_MAX_ENTRIES = 50_000;

const DAY_MS = 86_400_000;
const RANGE_UNIT_MS: Record<string, number> = { h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS, m: 30 * DAY_MS, M: 30 * DAY_MS };

/** Epoch ms of a range bound: now, now-N<unit> or an absolute date; NaN otherwise. */
function parseRangeTime(v: string, nowMs: number): number {
  const m = v.match(/^now(?:-(\d+)([dhwmM]))?$/);
  if (m) return m[1] ? nowMs - parseInt(m[1], 10) * RANGE_UNIT_MS[m[2]] : nowMs;
  return Date.parse(v);
}

/** A from/to value resolvePostureWindow can parse: absent, now[-N<unit>] or a date. */
function isPostureTime(v: string | undefined): boolean {
  if (v === undefined) return true;
  return /^now(?:-\d+[dhwmM])?$/.test(v) || !Number.isNaN(Date.parse(v));
}

// Organization UUID → short-name mapping
export const ORG_NAMES: Record<string, string> = {
  '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': 'SB',
  'b2f8dccb-6d23-492e-aa87-a0a8a6103189': 'TPSGL',
  '9634119d-fa6b-42b8-9b9b-90ad8f22e482': 'RGA',
};

/**
 * Run identity: one key per test run. The fourth segment is the EXACT
 * routing.event_time in ms — every control of one bundle dispatch shares
 * result.completed_at (set once per run on the agent), so members cluster,
 * and two runs of the same bundle on one host never merge. (A 30-minute
 * bucket here once merged distinct runs; don't reintroduce bucketing.)
 *   bundle controls  → "bundle::<bundle_id>::<hostname>::<event_time_ms>"
 *   standalone tests → "standalone::<test_uuid>::<hostname>::<event_time_ms>"
 * Shared by the executions tab (grouped mode) and the execution report.
 */
export const RUN_GROUP_KEY_SCRIPT = {
  source: `
    long t = doc['routing.event_time'].value.toInstant().toEpochMilli();
    if (doc.containsKey('f0rtika.is_bundle_control')
        && doc['f0rtika.is_bundle_control'].size() > 0
        && doc['f0rtika.is_bundle_control'].value == true) {
      return 'bundle::' + doc['f0rtika.bundle_id'].value + '::' + doc['routing.hostname'].value + '::' + t;
    } else {
      return 'standalone::' + doc['f0rtika.test_uuid'].value + '::' + doc['routing.hostname'].value + '::' + t;
    }
  `,
  lang: 'painless' as const,
};

/** Test identity: bundle_id for bundle controls, test_uuid otherwise. */
export const TEST_KEY_SCRIPT = {
  source: `
    if (doc.containsKey('f0rtika.is_bundle_control')
        && doc['f0rtika.is_bundle_control'].size() > 0
        && doc['f0rtika.is_bundle_control'].value == true
        && doc.containsKey('f0rtika.bundle_id')
        && doc['f0rtika.bundle_id'].size() > 0) {
      return doc['f0rtika.bundle_id'].value;
    }
    return doc['f0rtika.test_uuid'].value;
  `,
  lang: 'painless' as const,
};

/** Exit code for a test binary blocked before it ran (e.g. an ASR prevalence rule). */
const BLOCKED_PRE_EXECUTION_CODE = 260;

/** Newest inconclusive run of a chain (see fetchBundleInconclusiveRuns). */
interface InconclusiveRun {
  ts: number;
  /** The run had a stage blocked before execution (260). */
  preExec: boolean;
  bundleName?: string;
}

const STAGE_VALIDATOR_RE = /^Stage (\d+)$/;

/**
 * Stage numbers from a filter agg's `stages` terms on control_validator, or
 * null when a doc in the filter has no "Stage N" validator (older runs) or
 * the terms didn't cover every doc, so callers fall back to counting stages.
 */
function stageNumbers(agg: any): number[] | null {
  const buckets: any[] = agg?.stages?.buckets ?? [];
  const numbers: number[] = [];
  let covered = 0;
  for (const b of buckets) {
    const match = STAGE_VALIDATOR_RE.exec(String(b.key));
    if (!match) return null;
    numbers.push(Number(match[1]));
    covered += Number(b.doc_count) || 0;
  }
  return covered === (Number(agg?.doc_count) || 0) ? numbers : null;
}

/**
 * Where a blocked chain was stopped and whether an earlier stage alerted.
 * The stop is the lowest-numbered blocked stage, so a chain that keeps
 * running after a block (LockBit 298cc137) lands where it was first stopped.
 * Without stage numbers it falls back to the stages that ran, which is the
 * same stage for orchestrators that stop at the first block.
 */
function chainStop(run: ChainRun): { stage: number; alertedBefore: boolean } {
  if (run.blockedStages && run.blockedStages.length > 0) {
    const stage = Math.min(...run.blockedStages);
    const alertedBefore = run.alertedStages
      ? run.alertedStages.some(n => n < stage)
      : run.alertedUnblocked;
    return { stage, alertedBefore };
  }
  return { stage: run.stagesRun, alertedBefore: run.alertedUnblocked };
}

/**
 * Deterministic order for the members of a bundle run. All stages of a run
 * share routing.event_time, so ES returns them in arbitrary order. "Stage N"
 * validators sort numerically first; the rest follow by validator then
 * control_id. Returns a new array; the input is not mutated.
 */
export function sortBundleMembers(members: EnrichedTestExecution[]): EnrichedTestExecution[] {
  const stageNo = (m: EnrichedTestExecution): number | null => {
    const match = STAGE_VALIDATOR_RE.exec(m.control_validator ?? '');
    return match ? Number(match[1]) : null;
  };
  return [...members].sort((a, b) => {
    const sa = stageNo(a);
    const sb = stageNo(b);
    if (sa !== null && sb !== null) return sa - sb || (a.control_id ?? '').localeCompare(b.control_id ?? '');
    if (sa !== null) return -1;
    if (sb !== null) return 1;
    return (a.control_validator ?? '').localeCompare(b.control_validator ?? '')
      || (a.control_id ?? '').localeCompare(b.control_id ?? '');
  });
}

export class ElasticsearchService {
  private client: Client;
  private settings: AnalyticsSettings;

  // Conclusive test outcome codes (used for Defense Score)
  private readonly CONCLUSIVE_ERROR_CODES = [101, 105, 126, 127];

  // Distinct control_validator values per bundle run for chain depth (chains have <= 7 stages)
  private readonly CHAIN_STAGE_TERMS = 20;

  // Error codes representing failed/inconclusive test attempts (used for Error Rate)
  private readonly ERROR_CODES = [0, 1, 259, 999];

  // Upload confirmation code — not a test outcome, excluded from everything
  private readonly UPLOAD_CONFIRMATION_CODE = 200;

  // Risk acceptance service for Defense Score exclusion filter
  private riskAcceptanceService: RiskAcceptanceService | null = null;

  constructor(settings: AnalyticsSettings) {
    this.settings = settings;
    this.client = createEsClient(settings);
  }

  // Test the connection
  async testConnection(): Promise<string> {
    const info = await this.client.info();
    return info.version.number;
  }

  // Build date range filter
  private buildDateFilter(from?: string, to?: string): any {
    if (!from && !to) {
      return { range: { 'routing.event_time': { gte: 'now-7d' } } };
    }

    const filter: any = { range: { 'routing.event_time': {} } };
    if (from) filter.range['routing.event_time'].gte = from;
    if (to) filter.range['routing.event_time'].lte = to;

    return filter;
  }

  // Build org filter
  private buildOrgFilter(org?: string): any | null {
    if (!org) return null;
    return { term: { 'routing.oid': org } };
  }

  // Filter for valid test execution data only
  // Excludes incomplete records (cleanup operations, etc.)
  private buildTestDataFilter(): any {
    return {
      bool: {
        must: [
          { exists: { field: 'f0rtika.test_uuid' } },
          { exists: { field: 'f0rtika.test_name' } }
        ]
      }
    };
  }

  // Filter to only conclusive test outcomes (for Defense Score calculations)
  private buildConclusiveResultsFilter(): any {
    return { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } };
  }

  // Filter to exclude upload confirmations (for Error Rate — real test activity only)
  private buildTestActivityFilter(): any {
    return {
      bool: {
        must_not: [{ term: { 'event.ERROR': this.UPLOAD_CONFIRMATION_CODE } }]
      }
    };
  }

  /** Get or create the RiskAcceptanceService instance. */
  private getRiskAcceptanceService(): RiskAcceptanceService {
    if (!this.riskAcceptanceService) {
      this.riskAcceptanceService = new RiskAcceptanceService(this.client);
    }
    return this.riskAcceptanceService;
  }

  /**
   * Build the complete filter array for Defense Score queries.
   * Includes: test data filter, date filter, conclusive results filter,
   * optional org filter, and risk acceptance exclusion filter.
   */
  async buildDefenseScoreFilters(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<any[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter(),
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const exclusionFilter = await this.getRiskAcceptanceService().buildExclusionFilter(params.org);
    if (exclusionFilter) filters.push(exclusionFilter);

    return filters;
  }

  /** Invalidate the risk acceptance cache (call after accept/revoke). */
  invalidateRiskAcceptanceCache(): void {
    this.riskAcceptanceService?.invalidateCache();
    this.postureCache.clear();
  }

  /**
   * Build Defense Score filters WITHOUT risk acceptance exclusion.
   * Synchronous — used as the "real score" baseline for dual-query comparison.
   */
  buildDefenseScoreFiltersWithoutExclusion(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): any[] {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildConclusiveResultsFilter(),
    ];
    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);
    filters.push(...this.buildFilterBarClauses(params));
    return filters;
  }

  /**
   * Run a score query that returns both combined (is_protected OR defender_detected
   * OR crowdstrike_detected) and strict (is_protected only) counts in a single ES request.
   */
  private async runCombinedScoreQuery(filters: any[]): Promise<{
    total: number;
    combinedProtected: number;
    strictProtected: number;
  }> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      // hits.total caps at 10,000 without this, while the aggs below keep
      // counting — the score denominator must cover every matching doc.
      track_total_hits: true,
      query: { bool: { filter: filters } },
      aggs: {
        combined: {
          filter: {
            bool: {
              should: [
                { term: { 'f0rtika.is_protected': true } },
                { term: { 'f0rtika.defender_detected': true } },
                { term: { 'f0rtika.crowdstrike_detected': true } },
                { term: { 'f0rtika.sentinelone_detected': true } },
              ],
              minimum_should_match: 1,
            },
          },
        },
        strict: { filter: { term: { 'f0rtika.is_protected': true } } },
      },
    });
    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value || 0;
    const combinedProtected = (response.aggregations?.combined as any)?.doc_count || 0;
    const strictProtected = (response.aggregations?.strict as any)?.doc_count || 0;
    return { total, combinedProtected, strictProtected };
  }

  /**
   * Any-stage combined query: returns both combined and strict counts
   * split into per-doc and per-bundle subsets.
   */
  private async runAnyStageCombinedQuery(
    filters: any[],
  ): Promise<{ total: number; combinedProtected: number; strictProtected: number }> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        per_doc: {
          filter: this.PER_DOC_FILTER,
          aggs: {
            combined: {
              filter: {
                bool: {
                  should: [
                    { term: { 'f0rtika.is_protected': true } },
                    { term: { 'f0rtika.defender_detected': true } },
                    { term: { 'f0rtika.crowdstrike_detected': true } },
                    { term: { 'f0rtika.sentinelone_detected': true } },
                  ],
                  minimum_should_match: 1,
                },
              },
            },
            strict: { filter: { term: { 'f0rtika.is_protected': true } } },
          },
        },
        per_bundle: {
          filter: this.PER_BUNDLE_FILTER,
          aggs: {
            bundles: {
              terms: { script: this.BUNDLE_GROUP_SCRIPT, size: 10000 },
              aggs: {
                has_combined: {
                  filter: {
                    bool: {
                      should: [
                        { term: { 'f0rtika.is_protected': true } },
                        { term: { 'f0rtika.defender_detected': true } },
                        { term: { 'f0rtika.crowdstrike_detected': true } },
                        { term: { 'f0rtika.sentinelone_detected': true } },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                },
                has_strict: { filter: { term: { 'f0rtika.is_protected': true } } },
              },
            },
          },
        },
      },
    });

    const perDoc = (response.aggregations as any)?.per_doc;
    const perDocTotal = perDoc?.doc_count || 0;
    const perDocCombined = perDoc?.combined?.doc_count || 0;
    const perDocStrict = perDoc?.strict?.doc_count || 0;

    const perBundle = (response.aggregations as any)?.per_bundle;
    const bundleBuckets: any[] = perBundle?.bundles?.buckets || [];
    const bundleTotal = bundleBuckets.length;
    const bundleCombined = bundleBuckets.filter((b: any) => (b.has_combined?.doc_count || 0) > 0).length;
    const bundleStrict = bundleBuckets.filter((b: any) => (b.has_strict?.doc_count || 0) > 0).length;

    return {
      total: perDocTotal + bundleTotal,
      combinedProtected: perDocCombined + bundleCombined,
      strictProtected: perDocStrict + bundleStrict,
    };
  }

  // ============================================================================
  // ANY-STAGE SCORING — treats each non-CH bundle as a single scoring unit
  // ============================================================================

  /**
   * Build the "has_detected" filter for per-bundle scoring. A stage is
   * "detected" if the agent reported is_protected:true OR the Defender
   * enrichment pass marked defender_detected:true OR the CrowdStrike
   * enrichment pass marked crowdstrike_detected:true OR the SentinelOne
   * enrichment pass marked sentinelone_detected:true.
   */
  private buildDetectedFilter(): Record<string, any> {
    return {
      filter: {
        bool: {
          should: [
            { term: { 'f0rtika.is_protected': true } },
            { term: { 'f0rtika.defender_detected': true } },
            { term: { 'f0rtika.crowdstrike_detected': true } },
            { term: { 'f0rtika.sentinelone_detected': true } },
          ],
          minimum_should_match: 1,
        },
      },
    };
  }

  /** Filter matching standalone tests + cyber-hygiene bundle controls (scored per-document). */
  private readonly PER_DOC_FILTER = {
    bool: {
      should: [
        { bool: { must_not: [{ term: { 'f0rtika.is_bundle_control': true } }] } },
        { term: { 'f0rtika.category': 'cyber-hygiene' } },
      ],
      minimum_should_match: 1,
    },
  };

  /** Filter matching non-cyber-hygiene bundle controls (scored per-bundle-group). */
  private readonly PER_BUNDLE_FILTER = {
    bool: {
      must: [
        { term: { 'f0rtika.is_bundle_control': true } },
        { bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] } },
      ],
    },
  };

  /** Painless script that groups non-CH bundle controls by bundle_id + hostname. */
  private readonly BUNDLE_GROUP_SCRIPT = {
    source: "doc['f0rtika.bundle_id'].value + '::' + doc['routing.hostname'].value",
    lang: 'painless',
  };

  /** Build any-stage aggregations for use inside a date_histogram or terms bucket. */
  private buildAnyStageSubAggs(): Record<string, any> {
    const detectedFilter = this.buildDetectedFilter();
    return {
      per_doc: {
        filter: this.PER_DOC_FILTER,
        aggs: {
          protected: { filter: { term: { 'f0rtika.is_protected': true } } },
        },
      },
      per_bundle: {
        filter: this.PER_BUNDLE_FILTER,
        aggs: {
          bundles: {
            terms: { script: this.BUNDLE_GROUP_SCRIPT, size: 10000 },
            aggs: {
              has_protected: detectedFilter,
            },
          },
        },
      },
    };
  }

  /** Parse any-stage totals from a sub-bucket (date_histogram bucket or terms bucket). */
  private parseAnyStageSubBucket(bucket: any): { total: number; protectedCount: number } {
    const perDocTotal = bucket.per_doc?.doc_count || 0;
    const perDocProtected = bucket.per_doc?.protected?.doc_count || 0;

    const bundleBuckets: any[] = bucket.per_bundle?.bundles?.buckets || [];
    const bundleTotal = bundleBuckets.length;
    const bundleProtected = bundleBuckets.filter(
      (b: any) => (b.has_protected?.doc_count || 0) > 0
    ).length;

    return {
      total: perDocTotal + bundleTotal,
      protectedCount: perDocProtected + bundleProtected,
    };
  }

  /**
   * extended_bounds for trend date_histograms so the series runs to the end of
   * the range (default 'now') instead of stopping at the last bucket with data.
   * min is omitted when there is no lower bound (the date filter then defaults to 7d).
   * min is clamped to `to − 365d − lookbackDays`: "All time" sends from=2000-01-01,
   * which would otherwise pad ~9.4k empty daily buckets. extended_bounds only
   * pads (it never clips), so buckets that hold data are all still returned.
   */
  private buildExtendedBounds(from?: string, to?: string, lookbackDays = 0): { min?: string; max: string } {
    const bounds: { min?: string; max: string } = { max: to ?? 'now' };
    if (!from) return bounds;
    bounds.min = from;
    const nowMs = Date.now();
    const toMs = to ? parseRangeTime(to, nowMs) : nowMs;
    const fromMs = parseRangeTime(from, nowMs);
    const floorMs = toMs - (MAX_FRESHNESS_DAYS + lookbackDays) * DAY_MS;
    if (Number.isFinite(fromMs) && Number.isFinite(floorMs) && fromMs < floorMs) {
      bounds.min = new Date(floorMs).toISOString();
    }
    return bounds;
  }

  /** Run an any-stage trend query (date_histogram with split sub-aggs). */
  private async runAnyStageTrendQuery(
    filters: any[],
    interval: string,
    boundsFrom?: string,
    boundsTo?: string,
    lookbackDays = 0,
  ): Promise<any> {
    return this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: interval as 'day' | 'week' | 'month' | 'hour',
            min_doc_count: 0,
            extended_bounds: this.buildExtendedBounds(boundsFrom, boundsTo, lookbackDays),
          },
          aggs: this.buildAnyStageSubAggs(),
        },
      },
    });
  }

  // Get overall defense score (basis=executions). Its score is never null —
  // an empty range scores 0, as it always has (alerts.service relies on it).
  async getDefenseScore(
    params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>,
  ): Promise<DefenseScoreResponse & { score: number }> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const rawFilters = this.buildDefenseScoreFiltersWithoutExclusion(params);
    const adjustedFilters = await this.buildDefenseScoreFilters(params);
    const hasExclusion = adjustedFilters.length > rawFilters.length;

    const runQuery = isAnyStage
      ? (f: any[]) => this.runAnyStageCombinedQuery(f)
      : (f: any[]) => this.runCombinedScoreQuery(f);

    if (!hasExclusion) {
      const counts = await runQuery(adjustedFilters);
      const combinedScore = counts.total > 0 ? (counts.combinedProtected / counts.total) * 100 : 0;
      const strictScore = counts.total > 0 ? (counts.strictProtected / counts.total) * 100 : 0;
      const rounded = Math.round(combinedScore * 100) / 100;
      return {
        score: rounded,
        protectedCount: counts.strictProtected,
        detectedCount: counts.combinedProtected - counts.strictProtected,
        unprotectedCount: counts.total - counts.combinedProtected,
        totalExecutions: counts.total,
        realScore: Math.round(strictScore * 100) / 100,
        rawScore: rounded, // no exclusion ⇒ raw == adjusted
        riskAcceptedCount: 0,
      };
    }

    const [adjusted, raw] = await Promise.all([
      runQuery(adjustedFilters),
      runQuery(rawFilters),
    ]);

    const adjustedCombined = adjusted.total > 0 ? (adjusted.combinedProtected / adjusted.total) * 100 : 0;
    const adjustedStrict = adjusted.total > 0 ? (adjusted.strictProtected / adjusted.total) * 100 : 0;
    const rawCombined = raw.total > 0 ? (raw.combinedProtected / raw.total) * 100 : 0;

    return {
      score: Math.round(adjustedCombined * 100) / 100,
      protectedCount: adjusted.strictProtected,
      detectedCount: adjusted.combinedProtected - adjusted.strictProtected,
      unprotectedCount: adjusted.total - adjusted.combinedProtected,
      totalExecutions: adjusted.total,
      realScore: Math.round(adjustedStrict * 100) / 100,
      realProtectedCount: raw.combinedProtected,
      realUnprotectedCount: raw.total - raw.combinedProtected,
      realTotalExecutions: raw.total,
      rawScore: Math.round(rawCombined * 100) / 100,
      riskAcceptedCount: Math.max(0, raw.total - adjusted.total),
    };
  }

  /** Run a date histogram trend query and return raw ES response. */
  private async runTrendQuery(filters: any[], interval: string, boundsFrom?: string, boundsTo?: string, lookbackDays = 0): Promise<any> {
    return this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: interval as 'day' | 'week' | 'month' | 'hour',
            min_doc_count: 0,
            extended_bounds: this.buildExtendedBounds(boundsFrom, boundsTo, lookbackDays),
          },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });
  }

  // Get defense score trend over time
  async getDefenseScoreTrend(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TrendDataPoint[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const rawFilters = this.buildDefenseScoreFiltersWithoutExclusion(params);
    const adjustedFilters = await this.buildDefenseScoreFilters(params);
    // Defender tab opts into attack-simulation-only scoping so its
    // test-volume trend matches the detection-rate metric. Added to both
    // filter sets equally, so the raw-vs-adjusted risk-acceptance diff
    // (hasExclusion) is unaffected.
    if (params.excludeCyberHygiene) {
      const attackSimOnly = { bool: { must_not: attackSimulationExclusions() } };
      rawFilters.push(attackSimOnly);
      adjustedFilters.push(attackSimOnly);
    }
    const hasExclusion = adjustedFilters.length > rawFilters.length;
    const interval = params.interval || 'day';

    const runTrend = isAnyStage
      ? (f: any[]) => this.runAnyStageTrendQuery(f, interval, params.from, params.to)
      : (f: any[]) => this.runTrendQuery(f, interval, params.from, params.to);

    const parseBucket = isAnyStage
      ? (b: any) => this.parseAnyStageSubBucket(b)
      : (b: any) => ({ total: b.doc_count, protectedCount: b.protected?.doc_count || 0 });

    if (!hasExclusion) {
      const response = await runTrend(adjustedFilters);
      const buckets = (response.aggregations?.over_time as any)?.buckets || [];
      return buckets.map((bucket: any) => {
        const { total, protectedCount } = parseBucket(bucket);
        const score = total > 0 ? (protectedCount / total) * 100 : null;
        return {
          timestamp: bucket.key_as_string,
          score: score === null ? null : Math.round(score * 100) / 100,
          total,
          protected: protectedCount,
        };
      });
    }

    // Dual query: adjusted + raw
    const [adjustedResponse, rawResponse] = await Promise.all([
      runTrend(adjustedFilters),
      runTrend(rawFilters),
    ]);

    const adjustedBuckets = (adjustedResponse.aggregations?.over_time as any)?.buckets || [];
    const rawBuckets = (rawResponse.aggregations?.over_time as any)?.buckets || [];

    const rawByKey = new Map<string, { total: number; protected: number }>();
    for (const bucket of rawBuckets) {
      const parsed = parseBucket(bucket);
      rawByKey.set(bucket.key_as_string, { total: parsed.total, protected: parsed.protectedCount });
    }

    return adjustedBuckets.map((bucket: any) => {
      const { total, protectedCount } = parseBucket(bucket);
      const score = total > 0 ? (protectedCount / total) * 100 : null;

      const raw = rawByKey.get(bucket.key_as_string);
      const rawTotal = raw?.total ?? total;
      const rawProtected = raw?.protected ?? protectedCount;
      const rawScore = rawTotal > 0 ? (rawProtected / rawTotal) * 100 : null;

      return {
        timestamp: bucket.key_as_string,
        score: score === null ? null : Math.round(score * 100) / 100,
        total,
        protected: protectedCount,
        realScore: rawScore === null ? null : Math.round(rawScore * 100) / 100,
        realTotal: rawTotal,
        realProtected: rawProtected,
      };
    });
  }

  // Extend a date string by windowDays for lookback period
  // Handles both 'now-Xd' format and ISO date strings
  private extendDateRange(from: string | undefined, windowDays: number): string {
    if (!from) {
      return `now-${7 + windowDays - 1}d`; // Default to 7d + lookback
    }

    // Handle 'now-Xd' format
    const nowMatch = from.match(/^now-(\d+)([dhwm])$/);
    if (nowMatch) {
      const value = parseInt(nowMatch[1], 10);
      const unit = nowMatch[2];
      // Convert to days for extension
      const daysMap: Record<string, number> = { d: 1, h: 1/24, w: 7, m: 30 };
      const totalDays = Math.ceil(value * (daysMap[unit] || 1)) + windowDays - 1;
      return `now-${totalDays}d`;
    }

    // Handle ISO date string - subtract windowDays-1
    const date = new Date(from);
    if (!isNaN(date.getTime())) {
      date.setDate(date.getDate() - (windowDays - 1));
      return date.toISOString();
    }

    // Fallback
    return from;
  }

  // Check if a timestamp is within the display range (after the extended lookback)
  private isWithinDisplayRange(timestamp: string, displayFrom: string | undefined): boolean {
    const pointDate = new Date(parseInt(timestamp, 10) || timestamp);

    if (!displayFrom) {
      // Default 7d range
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      cutoff.setHours(0, 0, 0, 0);
      return pointDate >= cutoff;
    }

    // Handle 'now-Xd' format
    const nowMatch = displayFrom.match(/^now-(\d+)([dhwm])$/);
    if (nowMatch) {
      const value = parseInt(nowMatch[1], 10);
      const unit = nowMatch[2];
      const daysMap: Record<string, number> = { d: 1, h: 1/24, w: 7, m: 30 };
      const days = Math.ceil(value * (daysMap[unit] || 1));
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cutoff.setHours(0, 0, 0, 0);
      return pointDate >= cutoff;
    }

    // Handle ISO date string
    const cutoffDate = new Date(displayFrom);
    cutoffDate.setHours(0, 0, 0, 0);
    return pointDate >= cutoffDate;
  }

  // Get defense score trend with rolling window aggregation
  async getDefenseScoreTrendRolling(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TrendDataPoint[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const windowDays = params.windowDays || 7;
    const displayFrom = params.from;
    const interval = params.interval || 'day';

    // Extend date range to include lookback period
    const extendedFrom = this.extendDateRange(params.from, windowDays);
    const extendedParams = { ...params, from: extendedFrom };

    const rawFilters = this.buildDefenseScoreFiltersWithoutExclusion(extendedParams);
    const adjustedFilters = await this.buildDefenseScoreFilters(extendedParams);
    const hasExclusion = adjustedFilters.length > rawFilters.length;

    const runTrend = isAnyStage
      ? (f: any[]) => this.runAnyStageTrendQuery(f, interval, extendedFrom, params.to, windowDays)
      : (f: any[]) => this.runTrendQuery(f, interval, extendedFrom, params.to, windowDays);

    const normalizeBuckets = isAnyStage
      ? (buckets: any[]) => buckets.map((b: any) => {
          const parsed = this.parseAnyStageSubBucket(b);
          return { ...b, doc_count: parsed.total, protected: { doc_count: parsed.protectedCount } };
        })
      : (buckets: any[]) => buckets;

    if (!hasExclusion) {
      const response = await runTrend(adjustedFilters);
      const buckets = normalizeBuckets((response.aggregations?.over_time as any)?.buckets || []);
      return this.computeRollingWindow(buckets, windowDays, displayFrom);
    }

    // Dual query: adjusted + raw (both with extended date range)
    const [adjustedResponse, rawResponse] = await Promise.all([
      runTrend(adjustedFilters),
      runTrend(rawFilters),
    ]);

    const adjustedBuckets = normalizeBuckets((adjustedResponse.aggregations?.over_time as any)?.buckets || []);
    const rawBuckets = normalizeBuckets((rawResponse.aggregations?.over_time as any)?.buckets || []);

    const adjustedResults = this.computeRollingWindow(adjustedBuckets, windowDays, displayFrom);
    const rawResults = this.computeRollingWindow(rawBuckets, windowDays, displayFrom);

    const rawByTimestamp = new Map<string, TrendDataPoint>();
    for (const point of rawResults) {
      rawByTimestamp.set(point.timestamp, point);
    }

    return adjustedResults.map(point => {
      const raw = rawByTimestamp.get(point.timestamp);
      return {
        ...point,
        realScore: raw?.score ?? point.score,
        realTotal: raw?.total ?? point.total,
        realProtected: raw?.protected ?? point.protected,
      };
    });
  }

  /** Compute rolling window sums from date histogram buckets. */
  private computeRollingWindow(
    buckets: any[],
    windowDays: number,
    displayFrom: string | undefined,
  ): TrendDataPoint[] {
    const results: TrendDataPoint[] = [];

    for (let i = 0; i < buckets.length; i++) {
      const currentBucket = buckets[i];
      const timestamp = currentBucket.key_as_string;

      let windowTotal = 0;
      let windowProtected = 0;

      const windowStart = Math.max(0, i - windowDays + 1);
      for (let j = windowStart; j <= i; j++) {
        windowTotal += buckets[j].doc_count;
        windowProtected += buckets[j].protected?.doc_count || 0;
      }

      if (!this.isWithinDisplayRange(currentBucket.key.toString(), displayFrom)) {
        continue;
      }

      const score = windowTotal > 0 ? (windowProtected / windowTotal) * 100 : null;

      results.push({
        timestamp,
        score: score === null ? null : Math.round(score * 100) / 100,
        total: windowTotal,
        protected: windowProtected,
      });
    }

    return results;
  }

  // ============================================================================
  // LATEST-RESULT POSTURE (basis=latest)
  // Share of test × endpoint pairs whose latest conclusive result in the
  // freshness window is protected. ES returns per-pair runs; the rules
  // (latest pick, freshness, outcome filters, series) live in posture.ts.
  // ============================================================================

  /** Composite page size for per-doc pair runs (one bucket per pair × UTC day, or per pair). */
  private readonly PAIR_PAGE_SIZE = 10000;

  /**
   * Composite page size for any-stage bundle runs. Each bucket carries terms
   * sub-aggregations (codes, names), which count toward search.max_buckets
   * (65,536 by default), so this stays well below PAIR_PAGE_SIZE.
   */
  private readonly BUNDLE_RUN_PAGE_SIZE = 1000;

  /** Upper bound on distinct techniques per bundle in the metadata pass. */
  private readonly BUNDLE_TECHNIQUES_SIZE = 1000;

  private readonly PAIR_OID_SOURCE = { oid: { terms: { field: 'routing.oid', missing_bucket: true } } };
  // No missing_bucket on hostname: docs without routing.hostname form no pairs.
  private readonly PAIR_HOST_SOURCE = { host: { terms: { field: 'routing.hostname' } } };
  /**
   * Composite sources of one any-stage bundle run. Every control of one run
   * shares routing.event_time (= result.completed_at), so the exact timestamp
   * isolates a run.
   */
  private readonly BUNDLE_RUN_SOURCES = [
    this.PAIR_OID_SOURCE,
    { bundle: { terms: { field: 'f0rtika.bundle_id' } } },
    this.PAIR_HOST_SOURCE,
    { ts: { terms: { field: 'routing.event_time' } } },
  ];

  /**
   * Bundle-stage codes that do NOT make a chain run inconclusive: conclusive
   * outcomes, Skipped (0) and the upload confirmation (200). Anything else on
   * a stage (999 error, 260 ASR blocked pre-execution, ...) means the chain
   * neither ran end to end nor was blocked by a defense at that stage.
   */
  private readonly CHAIN_SETTLED_CODES = [0, 101, 105, 126, 127, 200];

  /** Latest inconclusive bundle run per pair (chain depth): same TTL as the posture snapshots, own small budget. */
  private readonly inconclusiveCache = new TtlPromiseCache<Map<string, InconclusiveRun>>({
    ttlMs: POSTURE_CACHE_OPTIONS.ttlMs,
    maxEntries: POSTURE_CACHE_OPTIONS.maxEntries,
    maxEntryWeight: INCONCLUSIVE_CACHE_MAX_ENTRIES,
    maxTotalWeight: INCONCLUSIVE_CACHE_MAX_ENTRIES,
    weigh: (m) => m.size,
  });

  private readonly PAIR_DAY_SOURCE = {
    day: { date_histogram: { field: 'routing.event_time', calendar_interval: 'day', time_zone: 'UTC' } },
  };

  /**
   * Short-lived pair-snapshot cache (postureCache.ts), private to this
   * instance: a settings change builds a new ElasticsearchService, which drops
   * it. Keyed by everything that shapes the ES fetch and never by the outcome
   * filters, which are applied in memory after the latest pick. A relative
   * range (now-7d) resolves when the snapshot is fetched, so a hit can be up
   * to ttlMs stale.
   */
  private readonly postureCache = new TtlPromiseCache<PostureSnapshot>(POSTURE_CACHE_OPTIONS);

  /**
   * Run a composite aggregation to exhaustion, following after_key until a
   * page is short. Each bucket goes to onBucket as its page arrives; pages are
   * not retained, so only the caller's (much smaller) PairRuns stay in memory.
   */
  private async paginateComposite(
    filters: any[],
    aggName: string,
    pageSize: number,
    sources: Record<string, unknown>[],
    subAggs: Record<string, unknown>,
    onBucket: (bucket: any) => void,
  ): Promise<void> {
    let after: Record<string, unknown> | undefined;
    for (;;) {
      const response = await this.client.search({
        index: this.settings.indexPattern,
        size: 0,
        query: { bool: { filter: filters } },
        aggs: {
          [aggName]: {
            composite: { size: pageSize, sources, ...(after ? { after } : {}) },
            ...(Object.keys(subAggs).length > 0 ? { aggs: subAggs } : {}),
          },
        },
      } as any);
      const agg = (response.aggregations as any)?.[aggName];
      const page: any[] = agg?.buckets ?? [];
      for (const b of page) onBucket(b);
      if (page.length < pageSize || !agg?.after_key) break;
      after = agg.after_key;
    }
  }

  /**
   * Fetch PairRuns for the docs matching `filters`.
   * Standard mode: every doc is a per-doc pair (bundle controls carry their
   * composite test_uuid). Any-stage: standalone + cyber-hygiene docs are
   * per-doc pairs; each non-CH bundle × host is one pair whose runs are the
   * control docs sharing an exact event_time.
   * withMetadata=false skips the metadata passes: testName is '' and
   * techniques are [] — enough for the score tile and trend, which only need
   * verdicts. latestOnly=true keeps only the latest run per pair (no per-day
   * runs), which is all the breakdowns need.
   */
  private async fetchPairRuns(
    filters: any[],
    isAnyStage: boolean,
    opts: PairFetchOptions = { withMetadata: true, latestOnly: false },
  ): Promise<PairRun[]> {
    if (!isAnyStage) return this.fetchDocPairRuns(filters, opts);
    const [docRuns, bundleRuns] = await Promise.all([
      this.fetchDocPairRuns([...filters, this.PER_DOC_FILTER], opts),
      this.fetchBundlePairRuns([...filters, this.PER_BUNDLE_FILTER], opts),
    ]);
    return docRuns.concat(bundleRuns);
  }

  /** Per-doc pairs: the latest doc per (oid, test_uuid, hostname[, UTC day]). */
  private async fetchDocPairRuns(filters: any[], opts: PairFetchOptions): Promise<PairRun[]> {
    const runs: PairRun[] = [];
    const uuidOf: string[] = []; // test_uuid of runs[i], for the metadata join
    await this.paginateComposite(
      filters,
      'pairs',
      this.PAIR_PAGE_SIZE,
      [
        this.PAIR_OID_SOURCE,
        { test: { terms: { field: 'f0rtika.test_uuid' } } },
        this.PAIR_HOST_SOURCE,
        ...(opts.latestOnly ? [] : [this.PAIR_DAY_SOURCE]),
      ],
      {
        latest: {
          top_metrics: {
            metrics: [
              'routing.event_time',
              'f0rtika.is_protected',
              'f0rtika.defender_detected',
              'f0rtika.crowdstrike_detected',
              'f0rtika.sentinelone_detected',
              'event.ERROR',
              'f0rtika.error_name',
            ].map(field => ({ field })),
            sort: { 'routing.event_time': 'desc' },
          },
        },
      },
      (b) => {
        const top = b.latest?.top?.[0];
        if (!top) return;
        const m = top.metrics ?? {};
        const ts = parseEsTime(m['routing.event_time'] ?? top.sort?.[0]);
        if (!Number.isFinite(ts)) return;
        const testUuid = String(b.key.test);
        const hostname = String(b.key.host);
        // top_metrics reports a missing field as null; Number(null) would be 0.
        const code = m['event.ERROR'] == null ? Number.NaN : Number(m['event.ERROR']);
        const codes = Number.isFinite(code) ? [code] : [];
        const isProtected = esBool(m['f0rtika.is_protected']);
        runs.push({
          pairKey: `${b.key.oid ?? ''}|${testUuid}|${hostname}`,
          ts,
          protected: isProtected || esBool(m['f0rtika.defender_detected']) || esBool(m['f0rtika.crowdstrike_detected']) || esBool(m['f0rtika.sentinelone_detected']),
          strictProtected: isProtected,
          errorCodes: codes,
          errorNames: errorNamesFor(codes, typeof m['f0rtika.error_name'] === 'string' ? [m['f0rtika.error_name']] : []),
          hostname,
          testName: '',
          techniques: [],
        });
        uuidOf.push(testUuid);
      },
    );
    if (!opts.withMetadata || runs.length === 0) return runs;

    // top_metrics can't return multi-valued fields (techniques), so the
    // static per-test metadata comes from one terms + top_hits pass.
    const meta = await this.fetchTestMetadata(filters, new Set(uuidOf).size);
    runs.forEach((run, i) => {
      const info = meta.get(uuidOf[i]);
      run.testName = info?.testName ?? uuidOf[i];
      run.category = info?.category;
      run.subcategory = info?.subcategory;
      run.techniques = info?.techniques ?? [];
      run.threatActor = info?.threatActor;
    });
    return runs;
  }

  /** Static per-test metadata (latest doc per test_uuid). */
  private async fetchTestMetadata(
    filters: any[],
    testCount: number,
  ): Promise<Map<string, { testName?: string; category?: string; subcategory?: string; techniques: string[]; threatActor?: string }>> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        test_meta: {
          terms: { field: 'f0rtika.test_uuid', size: Math.max(1, testCount) },
          aggs: {
            doc: {
              top_hits: {
                size: 1,
                sort: [{ 'routing.event_time': { order: 'desc' } }],
                _source: ['f0rtika.test_name', 'f0rtika.category', 'f0rtika.subcategory', 'f0rtika.techniques', 'f0rtika.threat_actor'],
              },
            },
          },
        },
      },
    });
    const out = new Map<string, { testName?: string; category?: string; subcategory?: string; techniques: string[]; threatActor?: string }>();
    const buckets: any[] = (response.aggregations as any)?.test_meta?.buckets ?? [];
    for (const b of buckets) {
      const src = b.doc?.hits?.hits?.[0]?._source ?? {};
      out.set(String(b.key), {
        testName: optString(getField(src, 'f0rtika.test_name')),
        category: optString(getField(src, 'f0rtika.category')),
        subcategory: optString(getField(src, 'f0rtika.subcategory')),
        techniques: toStringArray(getField(src, 'f0rtika.techniques')),
        threatActor: optString(getField(src, 'f0rtika.threat_actor')),
      });
    }
    return out;
  }

  /**
   * Any-stage bundle pairs: one run per (oid, bundle_id, hostname, exact
   * event_time). The composite carries verdict counts only (no top_hits);
   * metadata is joined afterwards, once per bundle_id.
   */
  private async fetchBundlePairRuns(filters: any[], opts: PairFetchOptions): Promise<PairRun[]> {
    const all: PairRun[] = [];
    const allBundles: string[] = []; // bundle_id of all[i]
    await this.paginateComposite(
      filters,
      'bundle_runs',
      this.BUNDLE_RUN_PAGE_SIZE,
      this.BUNDLE_RUN_SOURCES,
      {
        combined: this.buildDetectedFilter(),
        strict: {
          filter: { term: { 'f0rtika.is_protected': true } },
          // Chain depth: which stages blocked ("Stage N" validators).
          aggs: { stages: { terms: { field: 'f0rtika.control_validator', size: this.CHAIN_STAGE_TERMS } } },
        },
        // Chain depth: a detection that did not block (the chain went on).
        alerted_unblocked: {
          filter: {
            bool: {
              should: [
                { term: { 'f0rtika.defender_detected': true } },
                { term: { 'f0rtika.crowdstrike_detected': true } },
                { term: { 'f0rtika.sentinelone_detected': true } },
              ],
              minimum_should_match: 1,
              must_not: [{ term: { 'f0rtika.is_protected': true } }],
            },
          },
          aggs: { stages: { terms: { field: 'f0rtika.control_validator', size: this.CHAIN_STAGE_TERMS } } },
        },
        codes: { terms: { field: 'event.ERROR', size: 10 } },
        names: { terms: { field: 'f0rtika.error_name', size: 20 } },
      },
      (b) => {
        const ts = parseEsTime(b.key?.ts);
        if (!Number.isFinite(ts)) return;
        const bundleId = String(b.key.bundle);
        const hostname = String(b.key.host);
        const codes = ((b.codes?.buckets ?? []) as any[])
          .map(c => Number(c.key))
          .filter(n => Number.isFinite(n))
          .sort((x, y) => x - y);
        const storedNames = ((b.names?.buckets ?? []) as any[]).map(n => String(n.key));
        const run: ChainRun = {
          pairKey: bundlePairKey(b.key.oid, bundleId, hostname),
          ts,
          protected: (b.combined?.doc_count ?? 0) > 0,
          strictProtected: (b.strict?.doc_count ?? 0) > 0,
          errorCodes: codes,
          errorNames: errorNamesFor(codes, storedNames),
          hostname,
          testName: '',
          techniques: [],
          stagesRun: Number(b.doc_count) || 0,
          alertedUnblocked: (b.alerted_unblocked?.doc_count ?? 0) > 0,
          blockedStages: stageNumbers(b.strict),
          alertedStages: stageNumbers(b.alerted_unblocked),
        };
        all.push(run);
        allBundles.push(bundleId);
      },
    );

    let runs = all;
    let bundleOf = allBundles;
    if (opts.latestOnly) {
      const latestIdx = new Map<string, number>(); // pairKey → index into all
      all.forEach((r, i) => {
        const j = latestIdx.get(r.pairKey);
        if (j === undefined || r.ts >= all[j].ts) latestIdx.set(r.pairKey, i);
      });
      const idx = [...latestIdx.values()];
      runs = idx.map(i => all[i]);
      bundleOf = idx.map(i => allBundles[i]);
    }
    if (!opts.withMetadata || runs.length === 0) return runs;

    const meta = await this.fetchBundleMetadata(filters, new Set(bundleOf).size);
    runs.forEach((run, i) => {
      const info = meta.get(bundleOf[i]);
      run.testName = info?.bundleName ?? bundleOf[i];
      run.category = info?.category;
      run.subcategory = info?.subcategory;
      run.techniques = info?.techniques ?? [];
      run.threatActor = info?.threatActor;
    });
    return runs;
  }

  /**
   * Static per-bundle metadata, once per bundle_id (mirrors fetchTestMetadata):
   * bundle_name / category / subcategory from the bundle's latest control doc,
   * the union of f0rtika.techniques over its control docs, and the most
   * common f0rtika.threat_actor (every control carries the bundle's actor).
   * Strictly, a pair's techniques are those of its latest RUN's controls. A
   * bundle's controls are stable across runs, so the per-bundle_id union is
   * the same set, without fetching control docs for every historical run.
   */
  private async fetchBundleMetadata(
    filters: any[],
    bundleCount: number,
  ): Promise<Map<string, { bundleName?: string; category?: string; subcategory?: string; techniques: string[]; threatActor?: string }>> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        bundle_meta: {
          terms: { field: 'f0rtika.bundle_id', size: Math.max(1, bundleCount) },
          aggs: {
            doc: {
              top_hits: {
                size: 1,
                sort: [{ 'routing.event_time': { order: 'desc' } }],
                _source: ['f0rtika.bundle_name', 'f0rtika.category', 'f0rtika.subcategory'],
              },
            },
            techniques: { terms: { field: 'f0rtika.techniques', size: this.BUNDLE_TECHNIQUES_SIZE } },
            threat_actor: { terms: { field: 'f0rtika.threat_actor', size: 1 } },
          },
        },
      },
    });
    const out = new Map<string, { bundleName?: string; category?: string; subcategory?: string; techniques: string[]; threatActor?: string }>();
    const buckets: any[] = (response.aggregations as any)?.bundle_meta?.buckets ?? [];
    for (const b of buckets) {
      const src = b.doc?.hits?.hits?.[0]?._source ?? {};
      out.set(String(b.key), {
        bundleName: optString(getField(src, 'f0rtika.bundle_name')),
        category: optString(getField(src, 'f0rtika.category')),
        subcategory: optString(getField(src, 'f0rtika.subcategory')),
        techniques: ((b.techniques?.buckets ?? []) as any[]).map(t => String(t.key)),
        threatActor: optString(b.threat_actor?.buckets?.[0]?.key),
      });
    }
    return out;
  }

  /** Validate and resolve the freshness window for basis=latest. */
  private resolveLatestWindow(params: AnalyticsQueryParams): PostureWindow {
    const from = params.from || undefined;
    const to = params.to || undefined;
    if (!isPostureTime(from) || !isPostureTime(to)) throw new AppError('Invalid date range', 400);
    const window = resolvePostureWindow(from, to, Date.now());
    // freshnessMs is max(0, to − from): 0 means from ≥ to.
    if (window.freshnessMs <= 0) throw new AppError('Invalid date range', 400);
    return window;
  }

  /** Outcome filter-bar params, applied by posture.ts after the latest pick. */
  private parseOutcomeFilters(params: Partial<ExtendedAnalyticsQueryParams>): OutcomeFilters {
    const out: OutcomeFilters = {};
    const results = ['all', 'protected', 'unprotected', 'inconclusive'] as const;
    if (params.result && (results as readonly string[]).includes(params.result)) out.result = params.result;
    const codes = (params.errorCodes ?? '').split(',').map(c => parseInt(c.trim(), 10)).filter(n => !Number.isNaN(n));
    if (codes.length > 0) out.errorCodes = codes;
    const names = (params.errorNames ?? '').split(',').map(n => n.trim()).filter(Boolean);
    if (names.length > 0) out.errorNames = names;
    return out;
  }

  /**
   * Pair runs for basis=latest, served from the snapshot cache. Docs are
   * filtered (conclusive, org, filter bar minus outcome clauses,
   * risk-acceptance exclusion) BEFORE the latest pick; the outcome filters
   * are parsed per call and applied by the caller.
   * Shapes (POSTURE_SHAPES):
   * - 'series' (tile + trend): per-day runs, no metadata, lower bound widened
   *   by one freshness window so the first trend point has its full lookback,
   *   and rawRuns (no exclusion) for the "Actual" figures. The tile reads
   *   latestPairsAsOf(runs, toMs, freshnessMs) from this same snapshot, so the
   *   tile and the line's last point come from one query.
   * - 'metadata' (the four breakdowns): latest run per pair in the window,
   *   with metadata, no rawRuns.
   * rawRuns is null when nothing is excluded or the shape skips it.
   */
  async getLatestPosture(
    params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>,
    shape: PostureShape,
  ): Promise<PostureSnapshot & { outcome: OutcomeFilters }> {
    return this.latestPostureFor(await this.resolvePostureScope(params), shape);
  }

  /** Window, filter-bar clauses and risk-acceptance exclusion of a latest-basis request. */
  private async resolvePostureScope(
    params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>,
  ): Promise<PostureScope> {
    const window = this.resolveLatestWindow(params); // 400 before any ES call
    const outcome = this.parseOutcomeFilters(params);
    const isAnyStage = params.scoringMode === 'any-stage';
    const clauses = this.buildFilterBarClauses(params, { excludeOutcome: true });
    const exclusionFilter: unknown = (await this.getRiskAcceptanceService().buildExclusionFilter(params.org)) ?? null;
    return {
      window,
      outcome,
      isAnyStage,
      org: params.org,
      clauses,
      exclusionFilter,
      keyBase: {
        index: this.settings.indexPattern,
        from: params.from || null,
        to: params.to || null,
        org: params.org || null,
        clauses,
        exclusion: exclusionFilter,
      },
    };
  }

  private async latestPostureFor(
    scope: PostureScope,
    shape: PostureShape,
  ): Promise<PostureSnapshot & { outcome: OutcomeFilters }> {
    const spec = POSTURE_SHAPES[shape];
    const key = JSON.stringify({
      ...scope.keyBase,
      scoringMode: scope.isAnyStage ? 'any-stage' : 'all-stages',
      shape,
      ...spec,
    });
    const snapshot = await this.postureCache.get(key, () =>
      this.fetchPostureSnapshot(scope.window, scope.org, scope.clauses, scope.exclusionFilter, scope.isAnyStage, spec),
    );
    return { ...snapshot, outcome: scope.outcome };
  }

  /**
   * Base filters of a latest-basis fetch, in one place so the posture
   * snapshot and the chain-depth inconclusive pass can't drift apart: test
   * data, [lowerMs, toMs], the code clause, org, filter-bar clauses.
   */
  private buildPostureFilters(lowerMs: number, toMs: number, codeFilter: any, org: string | undefined, clauses: any[]): any[] {
    const filters: any[] = [
      this.buildTestDataFilter(),
      {
        range: {
          'routing.event_time': {
            gte: new Date(lowerMs).toISOString(),
            lte: new Date(toMs).toISOString(),
          },
        },
      },
      codeFilter,
    ];
    const orgFilter = this.buildOrgFilter(org);
    if (orgFilter) filters.push(orgFilter);
    filters.push(...clauses);
    return filters;
  }

  /** Latest inconclusive bundle run per any-stage pair, served from its own short cache. */
  private getBundleInconclusiveRuns(scope: PostureScope): Promise<Map<string, InconclusiveRun>> {
    const key = JSON.stringify({ ...scope.keyBase, kind: 'bundle-inconclusive' });
    return this.inconclusiveCache.get(key, () => this.fetchBundleInconclusiveRuns(scope));
  }

  /**
   * pairKey -> newest non-cyber-hygiene bundle run in the freshness window
   * that has a stage which is neither conclusive nor Skipped (e.g. 999 error,
   * 260 blocked before execution), with whether that run had a 260 stage and
   * the bundle name. Same window, org, filter-bar and risk-acceptance clauses
   * as the posture snapshot. Two small sub-aggregations, so pages use the
   * bundle-run size to stay far under the 65,536-bucket limit.
   */
  private async fetchBundleInconclusiveRuns(scope: PostureScope): Promise<Map<string, InconclusiveRun>> {
    const filters = this.buildPostureFilters(
      scope.window.fromMs,
      scope.window.toMs,
      { bool: { must_not: [{ terms: { 'event.ERROR': this.CHAIN_SETTLED_CODES } }] } },
      scope.org,
      scope.clauses,
    );
    filters.push({ exists: { field: 'event.ERROR' } }, this.PER_BUNDLE_FILTER);
    if (scope.exclusionFilter) filters.push(scope.exclusionFilter);
    const latest = new Map<string, InconclusiveRun>();
    const subAggs = {
      pre_exec: { filter: { term: { 'event.ERROR': BLOCKED_PRE_EXECUTION_CODE } } },
      bundle_name: { terms: { field: 'f0rtika.bundle_name', size: 1 } },
    };
    await this.paginateComposite(filters, 'bundle_inconclusive', this.BUNDLE_RUN_PAGE_SIZE, this.BUNDLE_RUN_SOURCES, subAggs, (b) => {
      const ts = parseEsTime(b.key?.ts);
      if (!Number.isFinite(ts)) return;
      const key = bundlePairKey(b.key.oid, String(b.key.bundle), String(b.key.host));
      const cur = latest.get(key);
      if (cur !== undefined && ts <= cur.ts) return;
      const name = b.bundle_name?.buckets?.[0]?.key;
      latest.set(key, { ts, preExec: (b.pre_exec?.doc_count ?? 0) > 0, bundleName: name != null ? String(name) : undefined });
    });
    return latest;
  }

  private async fetchPostureSnapshot(
    window: PostureWindow,
    org: string | undefined,
    clauses: any[],
    exclusionFilter: unknown,
    isAnyStage: boolean,
    spec: PostureShapeSpec,
  ): Promise<PostureSnapshot> {
    const lowerMs = spec.lookback ? window.fromMs - window.freshnessMs : window.fromMs;
    const filters = this.buildPostureFilters(lowerMs, window.toMs, this.buildConclusiveResultsFilter(), org, clauses);

    const fetchOpts: PairFetchOptions = { withMetadata: spec.withMetadata, latestOnly: spec.latestOnly };
    if (!exclusionFilter) {
      return { window, runs: await this.fetchPairRuns(filters, isAnyStage, fetchOpts), rawRuns: null };
    }
    if (!spec.withRaw) {
      return { window, runs: await this.fetchPairRuns([...filters, exclusionFilter], isAnyStage, fetchOpts), rawRuns: null };
    }
    const [runs, rawRuns] = await Promise.all([
      this.fetchPairRuns([...filters, exclusionFilter], isAnyStage, fetchOpts),
      this.fetchPairRuns(filters, isAnyStage, fetchOpts),
    ]);
    return { window, runs, rawRuns };
  }

  /** Outcome-filtered latest pair per key, as of window.toMs (exclusions applied). */
  async getLatestPairs(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<PairRun[]> {
    const { window, runs, outcome } = await this.getLatestPosture(params, 'metadata');
    return applyOutcomeFilters(latestPairsAsOf(runs, window.toMs, window.freshnessMs), outcome);
  }

  /** Defense Score, basis=latest. Same snapshot and calculation as the trend's last point. */
  async getDefenseScoreLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<DefenseScoreResponse> {
    const { window, runs, rawRuns, outcome } = await this.getLatestPosture(params, 'series');
    const summarize = (rs: PairRun[]) =>
      summarizePairs(applyOutcomeFilters(latestPairsAsOf(rs, window.toMs, window.freshnessMs), outcome));
    const latest = summarize(runs);
    const raw = rawRuns ? summarize(rawRuns) : latest;

    const response: DefenseScoreResponse = {
      score: latest.score,
      protectedCount: latest.strictProtectedCount,
      detectedCount: latest.protectedCount - latest.strictProtectedCount,
      unprotectedCount: latest.pairCount - latest.protectedCount,
      totalExecutions: latest.pairCount,
      realScore: latest.strictScore,
      rawScore: raw.score,
      riskAcceptedCount: Math.max(0, raw.pairCount - latest.pairCount),
      basis: 'latest',
      pairCount: latest.pairCount,
    };
    if (rawRuns) {
      response.realProtectedCount = raw.protectedCount;
      response.realUnprotectedCount = raw.pairCount - raw.protectedCount;
      response.realTotalExecutions = raw.pairCount;
    }
    return response;
  }

  /**
   * Defense Score trend, basis=latest: each point is the tile's calculation
   * as of that day (weekly over 90d); the last point is as of window.toMs.
   * realScore/realTotal/realProtected keep their existing meaning — the
   * pre-risk-acceptance (raw) series — and are set only when exclusions exist.
   */
  async getDefenseScoreTrendLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TrendDataPoint[]> {
    const { window, runs, rawRuns, outcome } = await this.getLatestPosture(params, 'series');
    const points = postureSeries(runs, window, outcome);
    const rawPoints = rawRuns ? postureSeries(rawRuns, window, outcome) : null;
    return points.map((p, i) => {
      const point: TrendDataPoint = { timestamp: p.timestamp, score: p.score, total: p.total, protected: p.protected };
      const raw = rawPoints?.[i];
      if (raw) {
        point.realScore = raw.score;
        point.realTotal = raw.total;
        point.realProtected = raw.protected;
      }
      return point;
    });
  }

  /**
   * Run a breakdown query with optional any-stage scoring.
   * When isAnyStage is true, non-CH bundles inside each breakdown bucket are
   * grouped and scored per-bundle rather than per-document.
   */
  private async runBreakdownQuery(
    filters: any[],
    aggName: string,
    fieldOrScript: string | { script: any },
    size: number,
    isAnyStage: boolean,
  ): Promise<{ key: string; total: number; protectedCount: number }[]> {
    const termsConfig = typeof fieldOrScript === 'string'
      ? { field: fieldOrScript, size }
      : { ...fieldOrScript, size };

    const subAggs = isAnyStage
      ? this.buildAnyStageSubAggs()
      : { protected: { filter: { term: { 'f0rtika.is_protected': true } } } };

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: { [aggName]: { terms: termsConfig, aggs: subAggs } },
    });

    const buckets = (response.aggregations?.[aggName] as any)?.buckets || [];

    return buckets.map((bucket: any) => {
      if (isAnyStage) {
        const parsed = this.parseAnyStageSubBucket(bucket);
        return { key: bucket.key, total: parsed.total, protectedCount: parsed.protectedCount };
      }
      return { key: bucket.key, total: bucket.doc_count, protectedCount: bucket.protected?.doc_count || 0 };
    });
  }

  // Get defense score by test
  async getDefenseScoreByTest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<BreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_test', 'f0rtika.test_name', params.limit || 50, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return { name: key, score: Math.round(score * 100) / 100, count: total, protected: protectedCount };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Get defense score by technique
  async getDefenseScoreByTechnique(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<BreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_technique', 'f0rtika.techniques', 50, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return { name: key, score: Math.round(score * 100) / 100, count: total, protected: protectedCount };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Get recent test executions
  async getRecentExecutions(params: AnalyticsQueryParams): Promise<TestExecution[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: params.limit || 50,
      query: {
        bool: { filter: filters },
      },
      sort: [{ 'routing.event_time': 'desc' }],
    });

    return response.hits.hits.map((hit: any) => {
      const source = hit._source;
      const orgUuid = getField(source, 'routing.oid') || '';

      return {
        test_uuid: getField(source, 'f0rtika.test_uuid') || '',
        test_name: getField(source, 'f0rtika.test_name') || 'Unknown Test',
        hostname: getField(source, 'routing.hostname') || 'Unknown',
        is_protected: getField(source, 'f0rtika.is_protected') || false,
        org: ORG_NAMES[orgUuid] || (orgUuid ? orgUuid.substring(0, 8) : ''),
        timestamp: getField(source, 'routing.event_time') || '',
        error_code: getField(source, 'event.ERROR'),
        error_name: resolveErrorName(getField(source, 'event.ERROR'), getField(source, 'f0rtika.error_name')),
      };
    });
  }

  // Get list of organizations
  async getOrganizations(): Promise<OrganizationInfo[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      aggs: {
        orgs: {
          terms: { field: 'routing.oid', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.orgs as any)?.buckets || [];

    // Known organization mapping
    const knownOrgs: Record<string, { shortName: string; fullName: string }> = {
      '09b59276-9efb-4d3d-bbdd-4b4663ef0c42': {
        shortName: 'SB',
        fullName: 'Superintendency of Banks',
      },
      'b2f8dccb-6d23-492e-aa87-a0a8a6103189': {
        shortName: 'TPSGL',
        fullName: 'Transact Pay',
      },
      '9634119d-fa6b-42b8-9b9b-90ad8f22e482': {
        shortName: 'RGA',
        fullName: 'RG Associates',
      },
    };

    return buckets.map((bucket: any) => {
      const uuid = bucket.key;
      const known = knownOrgs[uuid];

      return {
        uuid,
        shortName: known?.shortName || uuid.substring(0, 8),
        fullName: known?.fullName || uuid,
      };
    });
  }

  // Get unique hostname count
  async getUniqueHostnames(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<number> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        unique_hostnames: {
          cardinality: { field: 'routing.hostname' },
        },
      },
    });

    return (response.aggregations?.unique_hostnames as any)?.value || 0;
  }

  // Get unique test count
  async getUniqueTests(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<number> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        unique_tests: {
          cardinality: { field: 'f0rtika.test_uuid' },
        },
      },
    });

    return (response.aggregations?.unique_tests as any)?.value || 0;
  }

  // Build tests filter (OR logic for multiple tests)
  private buildTestsFilter(tests?: string): any | null {
    if (!tests) return null;

    const testList = tests.split(',').map(t => t.trim()).filter(Boolean);
    if (testList.length === 0) return null;

    if (testList.length === 1) {
      return { term: { 'f0rtika.test_name': testList[0] } };
    }

    return {
      bool: {
        should: testList.map(test => ({ term: { 'f0rtika.test_name': test } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build techniques filter (OR logic for multiple techniques)
  private buildTechniquesFilter(techniques?: string): any | null {
    if (!techniques) return null;

    const techniqueList = techniques.split(',').map(t => t.trim()).filter(Boolean);
    if (techniqueList.length === 0) return null;

    if (techniqueList.length === 1) {
      return { term: { 'f0rtika.techniques': techniqueList[0] } };
    }

    return {
      bool: {
        should: techniqueList.map(technique => ({ term: { 'f0rtika.techniques': technique } })),
        minimum_should_match: 1,
      },
    };
  }

  // Get results by error type (for pie chart)
  async getResultsByErrorType(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ErrorTypeBreakdown[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_error_code: {
          terms: { field: 'event.ERROR', size: 20 },
        },
      },
    });

    const buckets = (response.aggregations?.by_error_code as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      name: resolveErrorName(bucket.key),
      code: bucket.key as number,
      count: bucket.doc_count,
    }));
  }

  // Get test coverage (protected vs unprotected counts per test)
  async getTestCoverage(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TestCoverageItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_test: {
          terms: { field: 'f0rtika.test_name', size: 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            unprotected: {
              filter: { term: { 'f0rtika.is_protected': false } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_test as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      name: bucket.key,
      protected: bucket.protected?.doc_count || 0,
      unprotected: bucket.unprotected?.doc_count || 0,
    }));
  }

  // Get technique distribution (protected vs unprotected counts per technique)
  async getTechniqueDistribution(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TechniqueDistributionItem[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_technique: {
          terms: { field: 'f0rtika.techniques', size: 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            unprotected: {
              filter: { term: { 'f0rtika.is_protected': false } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_technique as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      technique: bucket.key,
      protected: bucket.protected?.doc_count || 0,
      unprotected: bucket.unprotected?.doc_count || 0,
    }));
  }

  // Get host-test matrix for heatmap
  async getHostTestMatrix(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<HostTestMatrixCell[]> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        host_test_matrix: {
          composite: {
            size: 1000,
            sources: [
              { hostname: { terms: { field: 'routing.hostname' } } },
              { test_name: { terms: { field: 'f0rtika.test_name' } } },
            ],
          },
        },
      },
    });

    const buckets = (response.aggregations?.host_test_matrix as any)?.buckets || [];

    return buckets.map((bucket: any) => ({
      hostname: bucket.key.hostname,
      testName: bucket.key.test_name,
      count: bucket.doc_count,
    }));
  }

  // Get list of available tests (for filter dropdown)
  async getAvailableTests(): Promise<string[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: [this.buildTestDataFilter()] }
      },
      aggs: {
        tests: {
          terms: { field: 'f0rtika.test_name', size: 100 },
        },
      },
    });

    const buckets = (response.aggregations?.tests as any)?.buckets || [];
    return buckets.map((bucket: any) => bucket.key);
  }

  // Get list of test UUIDs that have been executed (for NRY filter)
  async getExecutedTestUuids(): Promise<string[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: [this.buildTestDataFilter()] }
      },
      aggs: {
        uuids: {
          terms: { field: 'f0rtika.test_uuid', size: 10000 },
        },
      },
    });

    const buckets = (response.aggregations?.uuids as any)?.buckets || [];
    return buckets.map((bucket: any) => bucket.key);
  }

  // Get list of available techniques (for filter dropdown)
  async getAvailableTechniques(): Promise<string[]> {
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: [this.buildTestDataFilter()] }
      },
      aggs: {
        techniques: {
          terms: { field: 'f0rtika.techniques', size: 100 },
        },
      },
    });

    const buckets = (response.aggregations?.techniques as any)?.buckets || [];
    return buckets.map((bucket: any) => bucket.key);
  }

  // Get defense score by organization
  async getDefenseScoreByOrg(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<OrgBreakdownItem[]> {
    const filters = await this.buildDefenseScoreFilters(params);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        by_org: {
          terms: { field: 'routing.oid', size: 20 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_org as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          org: bucket.key,
          orgName: ORG_NAMES[bucket.key] || bucket.key.substring(0, 8),
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
        };
      })
      .sort((a: OrgBreakdownItem, b: OrgBreakdownItem) => b.score - a.score);
  }

  // ============================================
  // New Filter Builders (for enriched fields)
  // ============================================

  // Build hostnames filter (OR logic)
  private buildHostnamesFilter(hostnames?: string): any | null {
    if (!hostnames) return null;
    const hostnameList = hostnames.split(',').map(h => h.trim()).filter(Boolean);
    if (hostnameList.length === 0) return null;
    if (hostnameList.length === 1) {
      return { term: { 'routing.hostname': hostnameList[0] } };
    }
    return {
      bool: {
        should: hostnameList.map(h => ({ term: { 'routing.hostname': h } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build categories filter (OR logic)
  private buildCategoriesFilter(categories?: string): any | null {
    if (!categories) return null;
    const categoryList = categories.split(',').map(c => c.trim()).filter(Boolean);
    if (categoryList.length === 0) return null;
    if (categoryList.length === 1) {
      return { term: { 'f0rtika.category': categoryList[0] } };
    }
    return {
      bool: {
        should: categoryList.map(c => ({ term: { 'f0rtika.category': c } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build severities filter (OR logic)
  private buildSeveritiesFilter(severities?: string): any | null {
    if (!severities) return null;
    const severityList = severities.split(',').map(s => s.trim()).filter(Boolean);
    if (severityList.length === 0) return null;
    if (severityList.length === 1) {
      return { term: { 'f0rtika.severity': severityList[0] } };
    }
    return {
      bool: {
        should: severityList.map(s => ({ term: { 'f0rtika.severity': s } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build threat actors filter (OR logic)
  private buildThreatActorsFilter(threatActors?: string): any | null {
    if (!threatActors) return null;
    const actorList = threatActors.split(',').map(a => a.trim()).filter(Boolean);
    if (actorList.length === 0) return null;
    if (actorList.length === 1) {
      return { term: { 'f0rtika.threat_actor': actorList[0] } };
    }
    return {
      bool: {
        should: actorList.map(a => ({ term: { 'f0rtika.threat_actor': a } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build tags filter (OR logic)
  private buildTagsFilter(tags?: string): any | null {
    if (!tags) return null;
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length === 0) return null;
    if (tagList.length === 1) {
      return { term: { 'f0rtika.tags': tagList[0] } };
    }
    return {
      bool: {
        should: tagList.map(t => ({ term: { 'f0rtika.tags': t } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build bundle names filter (OR logic)
  private buildBundleNamesFilter(bundleNames?: string): any | null {
    if (!bundleNames) return null;
    const nameList = bundleNames.split(',').map(n => n.trim()).filter(Boolean);
    if (nameList.length === 0) return null;
    if (nameList.length === 1) {
      return { term: { 'f0rtika.bundle_name': nameList[0] } };
    }
    return {
      bool: {
        should: nameList.map(n => ({ term: { 'f0rtika.bundle_name': n } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build error names filter (OR logic) — resolves canonical names to error codes
  private buildErrorNamesFilter(errorNames?: string): any | null {
    if (!errorNames) return null;
    const nameList = errorNames.split(',').map(n => n.trim()).filter(Boolean);
    if (nameList.length === 0) return null;

    // Reverse-resolve canonical names to numeric error codes
    const codes: number[] = [];
    for (const name of nameList) {
      const entry = Object.entries(ERROR_CODE_MAP).find(([, v]) => v.name === name);
      if (entry) {
        codes.push(Number(entry[0]));
      }
    }

    if (codes.length > 0) {
      return { terms: { 'event.ERROR': codes } };
    }

    // Fallback: try matching against the stored field for any unrecognised names
    if (nameList.length === 1) {
      return { term: { 'f0rtika.error_name': nameList[0] } };
    }
    return {
      bool: {
        should: nameList.map(n => ({ term: { 'f0rtika.error_name': n } })),
        minimum_should_match: 1,
      },
    };
  }

  // Build error codes filter (OR logic, numeric field)
  private buildErrorCodesFilter(errorCodes?: string): any | null {
    if (!errorCodes) return null;
    const codeList = errorCodes.split(',').map(c => parseInt(c.trim(), 10)).filter(n => !isNaN(n));
    if (codeList.length === 0) return null;
    return { terms: { 'event.ERROR': codeList } };
  }

  // Build result filter (protected/unprotected/inconclusive)
  private buildResultFilter(result?: 'all' | 'protected' | 'unprotected' | 'inconclusive'): any | null {
    if (!result || result === 'all') return null;
    if (result === 'protected') return { terms: { 'event.ERROR': [105, 126, 127] } };
    if (result === 'unprotected') return { term: { 'event.ERROR': 101 } };
    // inconclusive: everything NOT in [101, 105, 126, 127]
    return { bool: { must_not: { terms: { 'event.ERROR': [101, 105, 126, 127] } } } };
  }

  /**
   * Build filter clauses from extended (filter-bar) params.
   * Returns only the clauses — caller is responsible for base filters (testData, date, org).
   * Shared by both paginated-executions and dashboard endpoints.
   */
  private buildFilterBarClauses(
    params: Partial<ExtendedAnalyticsQueryParams>,
    opts: { excludeOutcome?: boolean } = {},
  ): any[] {
    const clauses: any[] = [];
    // basis=latest applies the outcome filters (result/errorCodes/errorNames)
    // AFTER each pair's latest result is picked, so they must not reach ES.
    const outcome = !opts.excludeOutcome;

    const testsFilter = this.buildTestsFilter(params.tests);
    if (testsFilter) clauses.push(testsFilter);

    const techniquesFilter = this.buildTechniquesFilter(params.techniques);
    if (techniquesFilter) clauses.push(techniquesFilter);

    const hostnamesFilter = this.buildHostnamesFilter(params.hostnames);
    if (hostnamesFilter) clauses.push(hostnamesFilter);

    const categoriesFilter = this.buildCategoriesFilter(params.categories);
    if (categoriesFilter) clauses.push(categoriesFilter);

    const severitiesFilter = this.buildSeveritiesFilter(params.severities);
    if (severitiesFilter) clauses.push(severitiesFilter);

    const threatActorsFilter = this.buildThreatActorsFilter(params.threatActors);
    if (threatActorsFilter) clauses.push(threatActorsFilter);

    const tagsFilter = this.buildTagsFilter(params.tags);
    if (tagsFilter) clauses.push(tagsFilter);

    const errorNamesFilter = outcome ? this.buildErrorNamesFilter(params.errorNames) : null;
    if (errorNamesFilter) clauses.push(errorNamesFilter);

    const errorCodesFilter = outcome ? this.buildErrorCodesFilter(params.errorCodes) : null;
    if (errorCodesFilter) clauses.push(errorCodesFilter);

    const bundleNamesFilter = this.buildBundleNamesFilter(params.bundleNames);
    if (bundleNamesFilter) clauses.push(bundleNamesFilter);

    const resultFilter = outcome ? this.buildResultFilter(params.result) : null;
    if (resultFilter) clauses.push(resultFilter);

    return clauses;
  }

  /**
   * Build all extended filters (base + filter-bar clauses). Public: the
   * execution report reuses it so its scope is exactly the tab's.
   */
  buildExtendedFilters(params: Partial<ExtendedAnalyticsQueryParams>): any[] {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to)
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    return filters;
  }

  // ============================================
  // New Query Methods
  // ============================================

  // Get paginated executions with enriched data
  async getPaginatedExecutions(params: PaginatedExecutionsParams): Promise<PaginatedResponse<EnrichedTestExecution>> {
    const filters = this.buildExtendedFilters(params);

    const page = params.page || 1;
    const pageSize = Math.min(params.pageSize || 25, 100); // Max 100 per page
    const from = (page - 1) * pageSize;

    // Build sort configuration
    const sortField = params.sortField || 'routing.event_time';
    const sortOrder = params.sortOrder || 'desc';
    const sort: any[] = [{ [sortField]: sortOrder }];

    // First get total count
    const countResponse = await this.client.count({
      index: this.settings.indexPattern,
      query: { bool: { filter: filters } },
    });
    const totalItems = countResponse.count;

    // Then get paginated results
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: pageSize,
      from,
      query: { bool: { filter: filters } },
      sort,
    });

    const data: EnrichedTestExecution[] = response.hits.hits.map(
      (hit: any) => this.mapHitToExecution(hit)
    );

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      data,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  // Get paginated executions collapsed by display group (bundle or standalone).
  // Each collapsed group counts as 1 "row" for pagination, so "25 per page" = ~25 visible rows.
  // Uses terms aggregation with a Painless script (collapse doesn't support scripted/runtime fields).
  async getGroupedPaginatedExecutions(params: PaginatedExecutionsParams): Promise<GroupedPaginatedResponse> {
    const filters = this.buildExtendedFilters(params);
    const page = params.page || 1;
    const pageSize = Math.min(params.pageSize || 25, 100);
    const from = (page - 1) * pageSize;
    const sortField = params.sortField || 'routing.event_time';
    const sortOrder = params.sortOrder || 'desc';

    // Total document count (for badge/info display)
    const countResponse = await this.client.count({
      index: this.settings.indexPattern,
      query: { bool: { filter: filters } },
    });

    // Single search with size:0 (results come from agg buckets, not top-level hits):
    //   - terms agg with Painless script for grouping, ordered by most recent event
    //   - top_hits sub-agg returns member docs per group
    //   - cardinality agg with same script gives total distinct group count
    // Pagination: over-fetch page*pageSize buckets and slice client-side for the requested page.
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        total_groups: {
          cardinality: {
            script: RUN_GROUP_KEY_SCRIPT,
            precision_threshold: 10000,
          },
        },
        display_groups: {
          terms: {
            script: RUN_GROUP_KEY_SCRIPT,
            size: page * pageSize,
            order: { sort_value: sortOrder },
          },
          aggs: {
            members: {
              top_hits: {
                size: 100,
                sort: [{ [sortField]: sortOrder }],
                _source: true,
              },
            },
            sort_value: {
              max: { field: 'routing.event_time' },
            },
          },
        },
      },
    });

    const totalDocuments = countResponse.count;
    const totalGroups = (response.aggregations?.total_groups as any)?.value ?? 0;
    const totalPages = Math.ceil(totalGroups / pageSize);

    // Slice the over-fetched buckets to the requested page window
    const allBuckets = (response.aggregations?.display_groups as any)?.buckets || [];
    const pageBuckets = allBuckets.slice(from, from + pageSize);

    const groups: ExecutionGroup[] = pageBuckets.map((bucket: any) => {
      const groupKey: string = bucket.key;
      const isBundle = groupKey.startsWith('bundle::');
      const memberHits = bucket.members?.hits?.hits || [];
      const mapped: EnrichedTestExecution[] = memberHits.map((hit: any) => this.mapHitToExecution(hit));
      const members = isBundle ? sortBundleMembers(mapped) : mapped;
      const representative = members[0] || this.mapHitToExecution({ _source: {} });

      // Warn if top_hits were truncated (bundle exceeds 100 controls)
      if (isBundle && memberHits.length >= 100) {
        console.warn(`Bundle group ${groupKey} has ${memberHits.length}+ members (top_hits may be truncated)`);
      }

      let protectedCount = 0;
      let unprotectedCount = 0;
      for (const m of members) {
        if (m.error_code === 105 || m.error_code === 126 || m.error_code === 127) protectedCount++;
        else if (m.error_code === 101) unprotectedCount++;
      }

      return {
        groupKey,
        type: isBundle ? 'bundle' as const : 'standalone' as const,
        representative,
        members,
        protectedCount,
        unprotectedCount,
        totalCount: members.length,
      };
    });

    // Roll up defender_detected / crowdstrike_detected / *_prevented
    // from member docs. The enrichment passes (DefenderEnrichmentService /
    // CrowdStrikeEnrichmentService) populate f0rtika.* flags on each eligible
    // doc; the badges show if any stage of a bundle group is detected/prevented.
    for (const group of groups) {
      group.defenderDetected = group.members.some((m) => m.defender_detected === true);
      group.crowdstrikeDetected = group.members.some((m) => m.crowdstrike_detected === true);
      group.defenderPrevented = group.members.some((m) => m.defender_prevented === true);
      group.crowdstrikePrevented = group.members.some((m) => m.crowdstrike_prevented === true);
      group.sentineloneDetected = group.members.some((m) => m.sentinelone_detected === true);
      group.sentinelonePrevented = group.members.some((m) => m.sentinelone_prevented === true);
    }

    return {
      groups,
      pagination: {
        page,
        pageSize,
        totalGroups,
        totalDocuments,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  // Map a single ES hit (from search or inner_hits) to EnrichedTestExecution
  private mapHitToExecution(hit: any): EnrichedTestExecution {
    const source = hit._source;
    const orgUuid = getField(source, 'routing.oid') || '';

    return {
      test_uuid: getField(source, 'f0rtika.test_uuid') || '',
      test_name: getField(source, 'f0rtika.test_name') || 'Unknown Test',
      hostname: getField(source, 'routing.hostname') || 'Unknown',
      is_protected: getField(source, 'f0rtika.is_protected') || false,
      org: ORG_NAMES[orgUuid] || (orgUuid ? orgUuid.substring(0, 8) : ''),
      timestamp: getField(source, 'routing.event_time') || '',
      error_code: getField(source, 'event.ERROR'),
      error_name: resolveErrorName(getField(source, 'event.ERROR'), getField(source, 'f0rtika.error_name')),
      category: getField(source, 'f0rtika.category') as CategoryType | undefined,
      subcategory: getField(source, 'f0rtika.subcategory'),
      severity: getField(source, 'f0rtika.severity') as SeverityLevel | undefined,
      techniques: getField(source, 'f0rtika.techniques'),
      tactics: getField(source, 'f0rtika.tactics'),
      target: getField(source, 'f0rtika.target'),
      complexity: getField(source, 'f0rtika.complexity'),
      threat_actor: getField(source, 'f0rtika.threat_actor'),
      tags: getField(source, 'f0rtika.tags'),
      score: getField(source, 'f0rtika.score'),
      bundle_id: getField(source, 'f0rtika.bundle_id'),
      bundle_name: getField(source, 'f0rtika.bundle_name'),
      control_id: getField(source, 'f0rtika.control_id'),
      control_validator: getField(source, 'f0rtika.control_validator'),
      control_description: getField(source, 'f0rtika.control_description'),
      is_bundle_control: getField(source, 'f0rtika.is_bundle_control') ?? false,
      defender_detected: getField(source, 'f0rtika.defender_detected') ?? false,
      defender_stage_detected: getField(source, 'f0rtika.defender_stage_detected') ?? false,
      defender_prevented: getField(source, 'f0rtika.defender_prevented') ?? false,
      defender_prevention_action: getField(source, 'f0rtika.defender_prevention_action'),
      crowdstrike_detected: getField(source, 'f0rtika.crowdstrike_detected') ?? false,
      crowdstrike_stage_detected: getField(source, 'f0rtika.crowdstrike_stage_detected') ?? false,
      crowdstrike_prevented: getField(source, 'f0rtika.crowdstrike_prevented') ?? false,
      crowdstrike_prevention_action: getField(source, 'f0rtika.crowdstrike_prevention_action'),
      sentinelone_detected: getField(source, 'f0rtika.sentinelone_detected') ?? false,
      sentinelone_stage_detected: getField(source, 'f0rtika.sentinelone_stage_detected') ?? false,
      sentinelone_prevented: getField(source, 'f0rtika.sentinelone_prevented') ?? false,
      sentinelone_prevention_action: getField(source, 'f0rtika.sentinelone_prevention_action'),
    };
  }

  // Get available hostnames with counts
  // Note: For filter dropdowns, we show all available values unless date range is explicitly specified
  async getAvailableHostnames(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      // Only apply date filter if explicitly provided (don't default to 7d for filter options)
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        hostnames: {
          terms: { field: 'routing.hostname', size: 200 },
        },
      },
    });

    const buckets = (response.aggregations?.hostnames as any)?.buckets || [];
    return buckets.map((bucket: any) => ({
      value: bucket.key,
      label: bucket.key,
      count: bucket.doc_count,
    }));
  }

  // Get available categories with counts
  async getAvailableCategories(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        categories: {
          terms: { field: 'f0rtika.category', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.categories as any)?.buckets || [];
    return buckets.map((bucket: any) => ({
      value: bucket.key,
      label: bucket.key,
      count: bucket.doc_count,
    }));
  }

  // Get available severities with counts
  async getAvailableSeverities(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        severities: {
          terms: { field: 'f0rtika.severity', size: 10 },
        },
      },
    });

    const buckets = (response.aggregations?.severities as any)?.buckets || [];
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key.charAt(0).toUpperCase() + bucket.key.slice(1),
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) =>
        severityOrder.indexOf(a.value) - severityOrder.indexOf(b.value)
      );
  }

  // Get available threat actors with counts
  async getAvailableThreatActors(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        threat_actors: {
          terms: { field: 'f0rtika.threat_actor', size: 100 },
        },
      },
    });

    const buckets = (response.aggregations?.threat_actors as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available tags with counts
  async getAvailableTags(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        tags: {
          terms: { field: 'f0rtika.tags', size: 200 },
        },
      },
    });

    const buckets = (response.aggregations?.tags as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available error names with counts
  async getAvailableErrorNames(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        error_codes: {
          terms: { field: 'event.ERROR', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.error_codes as any)?.buckets || [];
    return buckets
      .map((bucket: any) => {
        const name = resolveErrorName(bucket.key);
        return {
          value: name,
          label: name,
          count: bucket.doc_count,
        };
      })
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available error codes with counts
  async getAvailableErrorCodes(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        error_codes: {
          terms: { field: 'event.ERROR', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.error_codes as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: String(bucket.key),
        label: `${bucket.key} (${resolveErrorName(bucket.key)})`,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get available bundle names with counts
  async getAvailableBundleNames(params?: AnalyticsQueryParams): Promise<FilterOption[]> {
    const filters: any[] = [this.buildTestDataFilter()];
    if (params) {
      if (params.from || params.to) {
        filters.push(this.buildDateFilter(params.from, params.to));
      }
      const orgFilter = this.buildOrgFilter(params.org);
      if (orgFilter) filters.push(orgFilter);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        bundle_names: {
          terms: { field: 'f0rtika.bundle_name', size: 50 },
        },
      },
    });

    const buckets = (response.aggregations?.bundle_names as any)?.buckets || [];
    return buckets
      .map((bucket: any) => ({
        value: bucket.key,
        label: bucket.key,
        count: bucket.doc_count,
      }))
      .sort((a: FilterOption, b: FilterOption) => b.count - a.count);
  }

  // Get defense score by severity
  async getDefenseScoreBySeverity(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<SeverityBreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_severity', 'f0rtika.severity', 10, isAnyStage);
    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          severity: key as SeverityLevel,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
        };
      })
      .sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  }

  // Get defense score by category
  async getDefenseScoreByCategory(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<CategoryBreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_category', 'f0rtika.category', 20, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          category: key as CategoryType,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Get defense score by category with nested subcategories
  async getDefenseScoreByCategoryWithSubcategories(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<CategorySubcategoryBreakdownItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);

    const subAggs: Record<string, any> = isAnyStage
      ? { ...this.buildAnyStageSubAggs(), by_subcategory: { terms: { field: 'f0rtika.subcategory', size: 50 }, aggs: this.buildAnyStageSubAggs() } }
      : { protected: { filter: { term: { 'f0rtika.is_protected': true } } }, by_subcategory: { terms: { field: 'f0rtika.subcategory', size: 50 }, aggs: { protected: { filter: { term: { 'f0rtika.is_protected': true } } } } } };

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: { by_category: { terms: { field: 'f0rtika.category', size: 20 }, aggs: subAggs } },
    });

    const buckets = (response.aggregations?.by_category as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const { total, protectedCount } = isAnyStage
          ? this.parseAnyStageSubBucket(bucket)
          : { total: bucket.doc_count, protectedCount: bucket.protected?.doc_count || 0 };
        const score = total > 0 ? (protectedCount / total) * 100 : 0;

        const subBuckets = bucket.by_subcategory?.buckets || [];
        const subcategories: SubcategoryBreakdownItem[] = subBuckets
          .map((sub: any) => {
            const subParsed = isAnyStage
              ? this.parseAnyStageSubBucket(sub)
              : { total: sub.doc_count, protectedCount: sub.protected?.doc_count || 0 };
            const subScore = subParsed.total > 0 ? (subParsed.protectedCount / subParsed.total) * 100 : 0;
            return {
              subcategory: sub.key,
              score: Math.round(subScore * 100) / 100,
              count: subParsed.total,
              protected: subParsed.protectedCount,
              unprotected: subParsed.total - subParsed.protectedCount,
            };
          })
          .sort((a: SubcategoryBreakdownItem, b: SubcategoryBreakdownItem) => b.count - a.count);

        return {
          category: bucket.key as CategoryType,
          score: Math.round(score * 100) / 100,
          count: total,
          protected: protectedCount,
          unprotected: total - protectedCount,
          subcategories,
        };
      })
      .sort((a: CategorySubcategoryBreakdownItem, b: CategorySubcategoryBreakdownItem) => b.score - a.score);
  }

  // Get defense score by hostname
  async getDefenseScoreByHostname(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<DefenseScoreByHostItem[]> {
    const isAnyStage = params.scoringMode === 'any-stage';
    const filters = await this.buildDefenseScoreFilters(params);
    const results = await this.runBreakdownQuery(filters, 'by_hostname', 'routing.hostname', params.limit || 50, isAnyStage);

    return results
      .map(({ key, total, protectedCount }) => {
        const score = total > 0 ? (protectedCount / total) * 100 : 0;
        return {
          hostname: key,
          score: Math.round(score * 100) / 100,
          protected: protectedCount,
          unprotected: total - protectedCount,
          total,
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /** Defense score by category with nested subcategories, basis=latest (pairs). */
  async getDefenseScoreByCategoryWithSubcategoriesLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<CategorySubcategoryBreakdownItem[]> {
    const pairs = await this.getLatestPairs(params);
    const round = (x: number) => Math.round(x * 100) / 100;
    const byCategory = groupPairs(pairs, p => p.category);
    const items: CategorySubcategoryBreakdownItem[] = [];
    for (const [category, summary] of byCategory) {
      if (summary.score === null) continue;
      const inCategory = pairs.filter(p => p.category === category);
      const subcategories: SubcategoryBreakdownItem[] = [];
      for (const [subcategory, sub] of groupPairs(inCategory, p => p.subcategory)) {
        if (sub.score === null) continue;
        subcategories.push({
          subcategory,
          score: round(sub.score),
          count: sub.pairCount,
          protected: sub.protectedCount,
          unprotected: sub.pairCount - sub.protectedCount,
        });
      }
      subcategories.sort((a, b) => b.count - a.count);
      items.push({
        category: category as CategoryType,
        score: round(summary.score),
        count: summary.pairCount,
        protected: summary.protectedCount,
        unprotected: summary.pairCount - summary.protectedCount,
        subcategories,
      });
    }
    return items.sort((a, b) => b.score - a.score);
  }

  /** Defense score by hostname, basis=latest (counts are pairs). */
  async getDefenseScoreByHostnameLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<DefenseScoreByHostItem[]> {
    const pairs = await this.getLatestPairs(params);
    const items: DefenseScoreByHostItem[] = [];
    for (const [hostname, s] of groupPairs(pairs, p => p.hostname || undefined)) {
      if (s.score === null) continue;
      items.push({
        hostname,
        score: Math.round(s.score * 100) / 100,
        protected: s.protectedCount,
        unprotected: s.pairCount - s.protectedCount,
        total: s.pairCount,
      });
    }
    return items.sort((a, b) => b.total - a.total).slice(0, params.limit || 50);
  }

  /** Technique distribution, basis=latest: a pair counts under each of its techniques. */
  async getTechniqueDistributionLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TechniqueDistributionItem[]> {
    // Always per-stage: an any-stage bundle pair carries one verdict for all
    // of its techniques, which would mark a technique protected even when its
    // own stage got through. Per-control pairs score each technique honestly.
    const pairs = await this.getLatestPairs({ ...params, scoringMode: 'all-stages' });
    const items: TechniqueDistributionItem[] = [];
    for (const [technique, s] of groupPairs(pairs, p => (p.techniques.length > 0 ? p.techniques : undefined))) {
      items.push({ technique, protected: s.protectedCount, unprotected: s.pairCount - s.protectedCount });
    }
    return items
      .sort((a, b) => (b.protected + b.unprotected) - (a.protected + a.unprotected) || a.technique.localeCompare(b.technique))
      .slice(0, 50);
  }

  /** Test coverage, basis=latest: per test, protected/unprotected hosts (one pair = one host x test). */
  async getTestCoverageLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TestCoverageItem[]> {
    const pairs = await this.getLatestPairs(params);
    const items: TestCoverageItem[] = [];
    for (const [name, s] of groupPairs(pairs, p => p.testName || undefined)) {
      items.push({ name, protected: s.protectedCount, unprotected: s.pairCount - s.protectedCount });
    }
    return items
      .sort((a, b) => (b.protected + b.unprotected) - (a.protected + a.unprotected) || a.name.localeCompare(b.name))
      .slice(0, 50);
  }

  /**
   * Threat actor coverage, basis=latest: per actor, the share of its test x
   * endpoint pairs whose latest result is protected (combined verdict), worst
   * first. Pairs without a threat actor are left out.
   */
  async getThreatActorCoverageLatest(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ThreatActorCoverageItem[]> {
    const pairs = await this.getLatestPairs(params);
    const byActor = new Map<string, PairRun[]>();
    for (const p of pairs) {
      if (!p.threatActor) continue;
      const list = byActor.get(p.threatActor);
      if (list) list.push(p);
      else byActor.set(p.threatActor, [p]);
    }
    const items: ThreatActorCoverageItem[] = [];
    for (const [threatActor, actorPairs] of byActor) {
      const s = summarizePairs(actorPairs);
      if (s.score === null) continue;
      const lastTs = actorPairs.reduce((m, p) => Math.max(m, p.ts), Number.NEGATIVE_INFINITY);
      items.push({
        threatActor,
        coverage: s.score,
        testCount: new Set(actorPairs.map(p => p.testName)).size,
        protectedCount: s.protectedCount,
        totalExecutions: s.pairCount,
        pairCount: s.pairCount,
        lastTestedAt: new Date(lastTs).toISOString(),
      });
    }
    return items.sort((a, b) =>
      a.coverage - b.coverage || b.totalExecutions - a.totalExecutions || a.threatActor.localeCompare(b.threatActor));
  }

  /**
   * Fleet result per test for the test library: over the last 90 days, each
   * test's (or bundle's) latest pairs, scored like the Defense Score tile
   * (any-stage, combined protected rule). Cyber-hygiene control pairs fold
   * into their bundle. The usual filter-bar params apply, but the window
   * and scoring rule are fixed: a caller's from/to/basis/scoringMode are overridden.
   */
  async getTestResults(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TestResultItem[]> {
    const pairs = await this.getLatestPairs({
      ...params,
      from: 'now-90d',
      to: 'now',
      basis: 'latest',
      scoringMode: 'any-stage',
    });
    const byTest = new Map<string, { pairs: number; protected: number; hosts: Set<string>; lastTs: number }>();
    for (const p of pairs) {
      const id = pairTestUuid(p.pairKey);
      let t = byTest.get(id);
      if (!t) {
        t = { pairs: 0, protected: 0, hosts: new Set(), lastTs: Number.NEGATIVE_INFINITY };
        byTest.set(id, t);
      }
      t.pairs++;
      if (p.protected) t.protected++;
      t.hosts.add(p.hostname);
      if (p.ts > t.lastTs) t.lastTs = p.ts;
    }
    return [...byTest].map(([testUuid, t]) => ({
      testUuid,
      pairCount: t.pairs,
      protectedCount: t.protected,
      hostCount: t.hosts.size,
      lastRunAt: new Date(t.lastTs).toISOString(),
    }));
  }

  /**
   * Per-technique outcomes, basis=latest: each per-stage pair under each of
   * its techniques counts as blocked (is_protected), detected-only (combined
   * but not strict) or got through. Always per-stage, for the same reason as
   * getTechniqueDistributionLatest. Every technique is returned (no top-N).
   */
  async getTechniqueOutcomes(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<TechniqueOutcomeItem[]> {
    const pairs = await this.getLatestPairs({ ...params, scoringMode: 'all-stages' });
    const byTechnique = new Map<string, { protected: number; detected: number; unprotected: number; lastTs: number }>();
    for (const p of pairs) {
      for (const technique of new Set(p.techniques)) {
        let t = byTechnique.get(technique);
        if (!t) {
          t = { protected: 0, detected: 0, unprotected: 0, lastTs: Number.NEGATIVE_INFINITY };
          byTechnique.set(technique, t);
        }
        if (p.strictProtected) t.protected++;
        else if (p.protected) t.detected++;
        else t.unprotected++;
        if (p.ts > t.lastTs) t.lastTs = p.ts;
      }
    }
    const items: TechniqueOutcomeItem[] = [];
    for (const [technique, t] of byTechnique) {
      items.push({
        technique,
        protected: t.protected,
        detected: t.detected,
        unprotected: t.unprotected,
        lastTestedAt: new Date(t.lastTs).toISOString(),
      });
    }
    const total = (i: TechniqueOutcomeItem) => i.protected + i.detected + i.unprotected;
    return items.sort((a, b) => total(b) - total(a) || a.technique.localeCompare(b.technique));
  }

  /**
   * How deep attack chains get, basis=latest. A chain is the latest run of a
   * non-cyber-hygiene bundle on a host: the any-stage bundle pairs the Defense
   * Score counts, from the same snapshot, so every filter-bar param applies
   * and the date range is the freshness window. Standalone tests and
   * cyber-hygiene controls are not chains and are left out.
   * A run with a blocked stage was stopped at its lowest-numbered blocked
   * "Stage N" (4 and deeper share the 4+ bucket); otherwise it ran end to end.
   * Most f0_library orchestrators stop at the first block and ingest the rest
   * as Skipped, but LockBit (298cc137) runs every stage, so the stage count
   * is only the fallback for runs without stage numbers (see chainStop).
   * A detection without a block doesn't stop a chain. alertedNotBlocked is a
   * detected, unblocked stage numbered before the stop.
   * A run with a stage that is neither conclusive nor Skipped (999 error, 260
   * ASR blocked pre-execution) also stops the chain, but not because a
   * defense blocked that stage: when such a run is the pair's latest (its
   * time >= the latest conclusive run's), the pair is `inconclusive` and in
   * no bucket. That also covers a newest run that errored at stage 1, which
   * has no conclusive docs and would otherwise leave an older run standing.
   * Inconclusive pairs are counted only when the outcome filters let
   * inconclusive results through (no result=protected|unprotected, no
   * errorCodes/errorNames: their codes aren't fetched).
   */
  async getChainDepth(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ChainDepthResponse> {
    const scope = await this.resolvePostureScope({ ...params, scoringMode: 'any-stage' });
    const [{ window, runs, outcome }, inconclusiveRuns] = await Promise.all([
      this.latestPostureFor(scope, 'metadata'),
      this.getBundleInconclusiveRuns(scope),
    ]);

    const inconclusiveKeys = new Set(inconclusiveRuns.keys());
    const settled: PairRun[] = [];
    for (const p of latestPairsAsOf(runs, window.toMs, window.freshnessMs)) {
      if (!isChainRun(p)) continue;
      const errored = inconclusiveRuns.get(p.pairKey);
      if (errored !== undefined && errored.ts >= p.ts) continue; // latest run is inconclusive
      inconclusiveKeys.delete(p.pairKey);
      settled.push(p);
    }
    const result = outcome.result ?? 'all';
    const showInconclusive = (result === 'all' || result === 'inconclusive') && !outcome.errorCodes && !outcome.errorNames;

    const stages = [1, 2, 3, 4] as const;
    const buckets = stages.map(stage => ({ stage, blocked: 0, alertedNotBlocked: 0, names: new Set<string>() }));
    const endToEndNames = new Set<string>();
    const endToEndAlertedNames = new Set<string>();
    const endToEndUndetectedNames = new Set<string>();
    let chains = 0;
    let endToEnd = 0;
    let endToEndAlerted = 0;
    for (const p of applyOutcomeFilters(settled, outcome)) {
      if (!isChainRun(p)) continue;
      chains++;
      if (p.strictProtected) {
        const stop = chainStop(p);
        const bucket = buckets[Math.min(Math.max(stop.stage, 1), 4) - 1];
        bucket.blocked++;
        if (stop.alertedBefore) bucket.alertedNotBlocked++;
        if (p.testName) bucket.names.add(p.testName);
      } else {
        endToEnd++;
        if (p.alertedUnblocked) endToEndAlerted++;
        if (p.testName) {
          endToEndNames.add(p.testName);
          (p.alertedUnblocked ? endToEndAlertedNames : endToEndUndetectedNames).add(p.testName);
        }
      }
    }
    const sorted = (names: Set<string>) => [...names].sort((a, b) => a.localeCompare(b));
    // A pre-execution block (260) means a control stopped the test binary, so
    // it wins over a stage error in the same run. The technique was never
    // evaluated: this is reported separately, never as a blocked stage.
    const blockedBeforeRun = [...inconclusiveKeys]
      .map(key => inconclusiveRuns.get(key))
      .filter((r): r is InconclusiveRun => r !== undefined && r.preExec);
    return {
      chains,
      buckets: buckets.map((b): ChainDepthBucket => ({
        stage: b.stage,
        blocked: b.blocked,
        alertedNotBlocked: b.alertedNotBlocked,
        bundleNames: sorted(b.names),
      })),
      endToEnd,
      endToEndAlerted,
      endToEndBundleNames: sorted(endToEndNames),
      endToEndAlertedBundleNames: sorted(endToEndAlertedNames),
      endToEndUndetectedBundleNames: sorted(endToEndUndetectedNames),
      inconclusive: showInconclusive ? inconclusiveKeys.size : 0,
      blockedBeforeRun: showInconclusive ? blockedBeforeRun.length : 0,
      blockedBeforeRunBundleNames: showInconclusive ? sorted(new Set(blockedBeforeRun.flatMap(r => (r.bundleName ? [r.bundleName] : [])))) : [],
      stageErrors: showInconclusive ? inconclusiveKeys.size - blockedBeforeRun.length : 0,
    };
  }

  // Get canonical test count (stable denominator for coverage calculations)
  // Returns all unique tests seen in the last 90 days
  async getCanonicalTestCount(params?: { org?: string; days?: number }): Promise<CanonicalTestCountResponse> {
    const days = params?.days || 90;
    const filters: any[] = [
      this.buildTestDataFilter(),
      { range: { 'routing.event_time': { gte: `now-${days}d` } } }
    ];

    const orgFilter = this.buildOrgFilter(params?.org);
    if (orgFilter) filters.push(orgFilter);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        unique_test_count: {
          cardinality: { field: 'f0rtika.test_name' },
        },
        test_names: {
          terms: { field: 'f0rtika.test_name', size: 500 },
        },
      },
    });

    const count = (response.aggregations?.unique_test_count as any)?.value || 0;
    const buckets = (response.aggregations?.test_names as any)?.buckets || [];
    const tests = buckets.map((bucket: any) => bucket.key);

    return { count, tests, days };
  }

  // Get threat actor coverage
  async getThreatActorCoverage(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ThreatActorCoverageItem[]> {
    const filters = await this.buildDefenseScoreFilters(params);

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        by_threat_actor: {
          terms: { field: 'f0rtika.threat_actor', size: 50 },
          aggs: {
            protected: {
              filter: { term: { 'f0rtika.is_protected': true } },
            },
            unique_tests: {
              cardinality: { field: 'f0rtika.test_uuid' },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.by_threat_actor as any)?.buckets || [];

    return buckets
      .map((bucket: any) => {
        const total = bucket.doc_count;
        const protectedCount = bucket.protected?.doc_count || 0;
        const testCount = bucket.unique_tests?.value || 0;
        const coverage = total > 0 ? (protectedCount / total) * 100 : 0;

        return {
          threatActor: bucket.key,
          coverage: Math.round(coverage * 100) / 100,
          testCount,
          protectedCount,
          totalExecutions: total,
        };
      })
      .sort((a: ThreatActorCoverageItem, b: ThreatActorCoverageItem) => b.totalExecutions - a.totalExecutions);
  }

  // Get error rate trend with rolling window aggregation
  async getErrorRateTrendRolling(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ErrorRateTrendDataPoint[]> {
    const windowDays = params.windowDays || 7;
    const displayFrom = params.from;

    // Extend date range to include lookback period
    const extendedFrom = this.extendDateRange(params.from, windowDays);

    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(extendedFrom, params.to),
      this.buildTestActivityFilter()  // excludes code 200
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const interval = params.interval || 'day';

    // Query ES with extended range
    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        over_time: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: interval as 'day' | 'week' | 'month' | 'hour',
            min_doc_count: 0,
            extended_bounds: this.buildExtendedBounds(extendedFrom, params.to, windowDays),
          },
          aggs: {
            errors: {
              filter: { terms: { 'event.ERROR': this.ERROR_CODES } },
            },
            conclusive: {
              filter: { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } },
            },
          },
        },
      },
    });

    const buckets = (response.aggregations?.over_time as any)?.buckets || [];

    // Compute rolling sums
    const rollingResults: ErrorRateTrendDataPoint[] = [];

    for (let i = 0; i < buckets.length; i++) {
      const currentBucket = buckets[i];
      const timestamp = currentBucket.key_as_string;

      // Sum over the window (current day + previous windowDays-1 days)
      let windowErrors = 0;
      let windowConclusive = 0;

      const windowStart = Math.max(0, i - windowDays + 1);
      for (let j = windowStart; j <= i; j++) {
        windowErrors += buckets[j].errors?.doc_count || 0;
        windowConclusive += buckets[j].conclusive?.doc_count || 0;
      }

      // Skip points that are in the lookback-only period
      if (!this.isWithinDisplayRange(currentBucket.key.toString(), displayFrom)) {
        continue;
      }

      const total = windowErrors + windowConclusive;
      const errorRate = total > 0 ? (windowErrors / total) * 100 : null;

      rollingResults.push({
        timestamp,
        errorRate: errorRate === null ? null : Math.round(errorRate * 100) / 100,
        errorCount: windowErrors,
        conclusiveCount: windowConclusive,
        total,
      });
    }

    return rollingResults;
  }

  // Get error rate (proportion of non-conclusive test activity)
  async getErrorRate(params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>): Promise<ErrorRateResponse> {
    const filters: any[] = [
      this.buildTestDataFilter(),
      this.buildDateFilter(params.from, params.to),
      this.buildTestActivityFilter()  // excludes code 200
    ];

    const orgFilter = this.buildOrgFilter(params.org);
    if (orgFilter) filters.push(orgFilter);

    filters.push(...this.buildFilterBarClauses(params));

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: {
        bool: { filter: filters },
      },
      aggs: {
        errors: {
          filter: { terms: { 'event.ERROR': this.ERROR_CODES } },
        },
        conclusive: {
          filter: { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } },
        },
      },
    });

    const errorCount = (response.aggregations?.errors as any)?.doc_count || 0;
    const conclusiveCount = (response.aggregations?.conclusive as any)?.doc_count || 0;
    const totalTestActivity = errorCount + conclusiveCount;
    const errorRate = totalTestActivity > 0 ? (errorCount / totalTestActivity) * 100 : 0;

    return {
      errorRate: Math.round(errorRate * 100) / 100,
      errorCount,
      conclusiveCount,
      totalTestActivity,
    };
  }

  /**
   * Execution activity for the dashboard cadence card: per-UTC-day counts
   * (protected / got through / inconclusive) plus 7-day headline numbers.
   * Fixed recent window, counted per result document (bundle stages count
   * individually). Days are zero-filled, oldest first.
   *
   * Counted documents are real test results only: the test-data filter, no
   * upload confirmations (exit 200) and no skipped bundle stages (exit 0 on a
   * bundle-control document — a chain stopped at stage 1 must not draw its
   * unreached stages as inconclusive). Protected = conclusive AND (blocked OR
   * detected); got through = conclusive AND NOT protected; inconclusive = the
   * rest. The 7-day numbers cover the last 7 UTC days (today included), i.e.
   * exactly the last 7 bars.
   */
  async getExecutionActivity(params: { org?: string; days?: number } = {}): Promise<ExecutionActivityResponse> {
    const requested = Number.isFinite(params.days) ? Math.trunc(params.days as number) : 14;
    const days = Math.max(1, Math.min(90, requested));
    // The query window must also cover the 7-day headline numbers.
    const spanDays = Math.max(days, 7);
    const todayMs = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const dayKeys: string[] = [];
    for (let i = spanDays - 1; i >= 0; i--) {
      dayKeys.push(new Date(todayMs - i * DAY_MS).toISOString().slice(0, 10));
    }

    const orgFilter = this.buildOrgFilter(params.org);
    // Real test results only (see the doc comment above).
    const countedFilter = {
      bool: {
        filter: [this.buildTestDataFilter(), ...(orgFilter ? [orgFilter] : [])],
        must_not: [
          { term: { 'event.ERROR': this.UPLOAD_CONFIRMATION_CODE } },
          {
            bool: {
              filter: [
                { term: { 'f0rtika.is_bundle_control': true } },
                { term: { 'event.ERROR': 0 } },
              ],
            },
          },
        ],
      },
    };
    const filters: any[] = [
      { range: { 'routing.event_time': { gte: `now-${spanDays - 1}d/d` } } },
      countedFilter,
    ];

    const conclusive = { terms: { 'event.ERROR': this.CONCLUSIVE_ERROR_CODES } };
    const detected = {
      bool: {
        should: [
          { term: { 'f0rtika.is_protected': true } },
          { term: { 'f0rtika.defender_detected': true } },
          { term: { 'f0rtika.crowdstrike_detected': true } },
          { term: { 'f0rtika.sentinelone_detected': true } },
        ],
        minimum_should_match: 1,
      },
    };
    const protectedFilter = { bool: { filter: [conclusive, detected] } };
    const unprotectedFilter = { bool: { filter: [conclusive], must_not: [detected] } };
    const inconclusiveFilter = { bool: { must_not: [conclusive] } };

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: 0,
      query: { bool: { filter: filters } },
      aggs: {
        per_day: {
          date_histogram: {
            field: 'routing.event_time',
            calendar_interval: 'day',
            min_doc_count: 0,
            extended_bounds: { min: dayKeys[0], max: dayKeys[dayKeys.length - 1] },
          },
          aggs: {
            protected: { filter: protectedFilter },
            unprotected: { filter: unprotectedFilter },
            inconclusive: { filter: inconclusiveFilter },
          },
        },
        // All-time newest result for the org: global ignores the window filter above
        // (the query's only other filter is the counted filter, re-applied here).
        all_time: {
          global: {},
          aggs: {
            org: {
              filter: countedFilter,
              aggs: { last: { max: { field: 'routing.event_time' } } },
            },
          },
        },
        last_7d: {
          filter: { range: { 'routing.event_time': { gte: 'now-6d/d' } } },
          aggs: {
            endpoints: { cardinality: { field: 'routing.hostname' } },
            conclusive: { filter: conclusive },
            protected: { filter: protectedFilter },
          },
        },
      },
    });

    const aggs = response.aggregations as any;
    const byDay = new Map<string, { protected: number; unprotected: number; inconclusive: number }>();
    for (const b of (aggs?.per_day?.buckets ?? []) as any[]) {
      const key = typeof b.key === 'number'
        ? new Date(b.key).toISOString().slice(0, 10)
        : String(b.key_as_string ?? b.key).slice(0, 10);
      byDay.set(key, {
        protected: b.protected?.doc_count ?? 0,
        unprotected: b.unprotected?.doc_count ?? 0,
        inconclusive: b.inconclusive?.doc_count ?? 0,
      });
    }
    const dayRows = dayKeys.slice(-days).map((date) => ({
      date,
      ...(byDay.get(date) ?? { protected: 0, unprotected: 0, inconclusive: 0 }),
    }));

    const last = aggs?.all_time?.org?.last;
    const lastExecutionAt: string | null =
      last?.value != null ? (last.value_as_string ?? new Date(last.value).toISOString()) : null;

    const w = aggs?.last_7d;
    const conclusive7d: number = w?.conclusive?.doc_count ?? 0;
    const protected7d: number = w?.protected?.doc_count ?? 0;

    return {
      days: dayRows,
      lastExecutionAt,
      executions7d: w?.doc_count ?? 0,
      protectedPct7d: conclusive7d > 0 ? Math.round((protected7d / conclusive7d) * 1000) / 10 : null,
      endpointsTested7d: w?.endpoints?.value ?? 0,
    };
  }

  // ================================================================
  // Archive operations
  // ================================================================

  /** Derive archive index name from the active index pattern. */
  private getArchiveIndexName(): string {
    // Strip trailing wildcard: "achilles-results-*" → "achilles-results-"
    // Then remove any trailing dash/wildcard characters to get the base.
    const base = (this.settings.indexPattern || 'achilles-results-*')
      .replace(/[\-\*]+$/, '');
    // Reversed prefix so it does NOT match "achilles-results-*"
    return `archived-${base}`;
  }

  /**
   * Convert any Elasticsearch client error into an AppError that propagates a
   * useful message to the response body. Without this, ES errors on HEAD-only
   * operations (like indices.exists) reach the global error handler with an
   * empty/'Response Error' message and the user just sees "Internal Server
   * Error" — which obscures e.g. "API key lacks create_index on archived-*".
   */
  private wrapEsError(operation: string, err: unknown): never {
    const e = err as {
      statusCode?: number;
      message?: string;
      meta?: { body?: { error?: { type?: string; reason?: string; root_cause?: Array<{ type?: string; reason?: string }> } } };
    };
    const status = typeof e.statusCode === 'number' ? e.statusCode : 500;
    const body = e.meta?.body?.error;

    let detail = '';
    if (body) {
      const rootCause = body.root_cause?.[0];
      detail = rootCause?.reason ?? body.reason ?? body.type ?? '';
    }
    if (!detail && e.message && e.message !== 'Response Error') {
      detail = e.message;
    }
    if (!detail) {
      detail = `Elasticsearch returned ${status} with no body (likely HEAD request). Check API key privileges on the target index pattern.`;
    }

    // Surface to server logs with full context — the global handler only logs message.
    console.error(`[Archive] ${operation} failed (status=${status}):`, detail, body ? { esError: body } : '');

    throw new AppError(`Archive ${operation}: ${detail}`, status);
  }

  /** Ensure the archive index exists with the correct mapping. */
  private async ensureArchiveIndex(): Promise<string> {
    const archiveIndex = this.getArchiveIndexName();
    let exists: boolean;
    try {
      exists = await this.client.indices.exists({ index: archiveIndex });
    } catch (err) {
      this.wrapEsError(`indices.exists(${archiveIndex})`, err);
    }
    if (!exists) {
      const { RESULTS_INDEX_MAPPING } = await import('./index-management.service.js');
      try {
        await this.client.indices.create({
          index: archiveIndex,
          ...RESULTS_INDEX_MAPPING,
        });
      } catch (err) {
        this.wrapEsError(`indices.create(${archiveIndex})`, err);
      }
    }
    return archiveIndex;
  }

  /**
   * Archive executions by group keys.
   *
   * Group key format (matches what the Executions listing emits — see
   * RUN_GROUP_KEY_SCRIPT earlier in this file):
   *   "bundle::<bundle_id>::<hostname>::<event_time_ms>"     — one specific run
   *   "standalone::<test_uuid>::<hostname>::<event_time_ms>" — one specific run
   *
   * The fourth segment is the EXACT `routing.event_time` in milliseconds
   * since epoch. Archive scopes its filter to a 1-ms window centered on
   * that timestamp — every control of a single bundle dispatch shares the
   * same `result.completed_at`, so the entire run's docs are captured.
   *
   * Was previously a 30-min bucket (`event_time_ms / 1_800_000`); the
   * bucketing collapsed two runs in the same half-hour into one group,
   * which broke both the listing AND archive scoping. The new key is
   * exact-millis, so each run gets its own row and archive scoping
   * targets that one run's docs.
   *
   * Legacy 3-part keys (pre-millis-bucket era, pre-c28fee4 / 2026-04-08)
   * are rejected — UI hasn't emitted them in over a month.
   */
  async archiveByGroupKeys(
    groupKeys: string[],
  ): Promise<{ archived: number; errors: string[] }> {
    const errors: string[] = [];
    const shouldClauses: any[] = [];

    // Match the exact event_time millis. We use a 1-ms range rather than a
    // term filter because `routing.event_time` is a date field and ES is
    // pickier about term equality on dates than on a small range.
    const eventTimeRange = (eventTimeMs: number) => ({
      range: {
        'routing.event_time': {
          gte: eventTimeMs,
          lt: eventTimeMs + 1,
          format: 'epoch_millis',
        },
      },
    });

    for (const key of groupKeys) {
      const parts = key.split('::');
      if (parts.length !== 4) {
        errors.push(`Invalid group key (expected 4 parts, got ${parts.length}): ${key}`);
        continue;
      }
      const [prefix, id, hostname, eventTimeStr] = parts;
      const eventTimeMs = Number.parseInt(eventTimeStr, 10);
      if (!Number.isFinite(eventTimeMs) || eventTimeMs <= 0) {
        errors.push(`Invalid event_time millis in group key: ${key}`);
        continue;
      }

      if (prefix === 'bundle') {
        shouldClauses.push({
          bool: {
            filter: [
              { term: { 'f0rtika.bundle_id': id } },
              { term: { 'routing.hostname': hostname } },
              eventTimeRange(eventTimeMs),
            ],
          },
        });
      } else if (prefix === 'standalone') {
        shouldClauses.push({
          bool: {
            filter: [
              { term: { 'f0rtika.test_uuid': id } },
              { term: { 'routing.hostname': hostname } },
              { bool: { must_not: [{ term: { 'f0rtika.is_bundle_control': true } }] } },
              eventTimeRange(eventTimeMs),
            ],
          },
        });
      } else {
        errors.push(`Unknown group key prefix: ${key}`);
      }
    }

    if (shouldClauses.length === 0) {
      return { archived: 0, errors };
    }

    const query = {
      bool: {
        filter: [this.buildTestDataFilter()],
        should: shouldClauses,
        minimum_should_match: 1,
      },
    };

    const archiveIndex = await this.ensureArchiveIndex();

    // Step 1: Reindex to archive
    let reindexResult: unknown;
    try {
      reindexResult = await this.client.reindex({
        source: { index: this.settings.indexPattern, query },
        dest: { index: archiveIndex },
        refresh: true,
      });
    } catch (err) {
      this.wrapEsError(`reindex(${this.settings.indexPattern} → ${archiveIndex})`, err);
    }

    const archived = (reindexResult as { total?: number }).total || 0;

    if (archived === 0) {
      return { archived: 0, errors };
    }

    // Step 2: Delete from source
    try {
      await this.client.deleteByQuery({
        index: this.settings.indexPattern,
        query,
        refresh: true,
      });
    } catch (err) {
      this.wrapEsError(`deleteByQuery(${this.settings.indexPattern})`, err);
    }

    return { archived, errors };
  }

  /** Archive all executions before a given date. */
  async archiveByDateRange(
    before: string,
  ): Promise<{ archived: number; errors: string[] }> {
    const errors: string[] = [];

    const query = {
      bool: {
        filter: [
          this.buildTestDataFilter(),
          { range: { 'routing.event_time': { lt: before } } },
        ],
      },
    };

    const archiveIndex = await this.ensureArchiveIndex();

    let reindexResult: unknown;
    try {
      reindexResult = await this.client.reindex({
        source: { index: this.settings.indexPattern, query },
        dest: { index: archiveIndex },
        refresh: true,
      });
    } catch (err) {
      this.wrapEsError(`reindex(${this.settings.indexPattern} → ${archiveIndex})`, err);
    }

    const archived = (reindexResult as { total?: number }).total || 0;

    if (archived === 0) {
      return { archived: 0, errors };
    }

    try {
      await this.client.deleteByQuery({
        index: this.settings.indexPattern,
        query,
        refresh: true,
      });
    } catch (err) {
      this.wrapEsError(`deleteByQuery(${this.settings.indexPattern})`, err);
    }

    return { archived, errors };
  }
}
