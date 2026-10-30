// SB-PC-2026-001 compliance report — LockBit 3.0 double-extortion bundle.
//
// Read-only projection over bundle-control docs in `achilles-results-*`.
// Builds the SB bulletin section-04 envelope `{meta, executions[]}` with one
// row per technique/stage per endpoint. Outcome semantics mirror the offline
// reference converter (f0_library/utils/sb_report.py), adapted to what the
// ingested ES docs can observe:
//
//   exit 126/105/127                                  -> PREVENTED
//   *_prevented flag (vendor-confirmed)               -> PREVENTED
//      (defender_prevented: remediationStatus on the correlated alert;
//       crowdstrike_prevented: pattern_disposition on the correlated alert;
//       sentinelone_prevented: mitigation status on the correlated threat)
//   exit 101 (or 0) + EDR <vendor>_stage_detected     -> DETECTED
//      (any registry vendor; the run-wide <vendor>_detected flag, set on
//       every stage when an alert names the run, is never stage evidence —
//       same rule as Analytics)
//   exit 101 (or 0), exfiltration/impact tactics      -> EXPOSED
//   exit 101 (or 0), other tactics                    -> MISSED
//   exit 200/259/260 (inconclusive)                   -> ERROR ("inconclusive: <name>")
//   999 or anything else                              -> ERROR
//
// NOT_RUN is part of the outcome enum but is not emitted server-side: skipped
// controls are not ingested into ES, so there is no data signal to detect them.
//
// `techniques` = the techniques the stage executed (the bulletin's field: "de
// la lista aceptable del objetivo"): the result doc's own, plus every
// technique the test library declares for that stage (info card `Stage N`
// heading, via the test catalog). `detectedTechniques` (an additional field,
// which SB accepts and doesn't evaluate) = the ATT&CK techniques on the alerts
// that matched this stage's own binary, for each vendor that detected it.

import type { Client } from '@elastic/elasticsearch';
import { createEsClient } from '../analytics/client.js';
import { resolveErrorName } from '../analytics/elasticsearch.js';
import { orgShortName } from '../analytics/orgNames.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { AnalyticsSettings } from '../../types/analytics.js';
import { EDR_VENDOR_KEYS, edrFlagField, edrVendor } from '../outcomes/vendors.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';
import { getTestMetadata } from '../agent/test-catalog.service.js';
import { VENDOR_INDICES } from '../edr/edr-configured.js';
import { buildStageDefenderEvidenceQuery } from '../defender/evidence-correlation.js';
import { buildStageCrowdStrikeEvidenceQuery } from '../edr/evidence-correlation.js';

export const SB_BUNDLE_ID = 'SB-PC-2026-001';
export const SB_BUNDLE_NAME = 'Ransomware con doble extorsión — LockBit 3.0';

// SB-PC-2026-001 objective labels (bulletin section 02, keyed by stage 1–5).
export const SB_STAGE_LABELS: Record<number, string> = {
  1: 'Ejecución y degradación de defensas en los endpoints',
  2: 'Acceso a credenciales privilegiadas',
  3: 'Movimiento lateral y propagación hacia activos de valor',
  4: 'Exfiltración de datos previa al cifrado',
  5: 'Impacto por cifrado y bloqueo de recuperación',
};

// ATT&CK tactic kebab-case -> TA identifier (the SB format uses TA codes).
const TACTIC_TO_TA: Record<string, string> = {
  'reconnaissance': 'TA0043',
  'resource-development': 'TA0042',
  'initial-access': 'TA0001',
  'execution': 'TA0002',
  'persistence': 'TA0003',
  'privilege-escalation': 'TA0004',
  'defense-evasion': 'TA0005',
  'credential-access': 'TA0006',
  'discovery': 'TA0007',
  'lateral-movement': 'TA0008',
  'collection': 'TA0009',
  'exfiltration': 'TA0010',
  'command-and-control': 'TA0011',
  'impact': 'TA0040',
};

// Tactics whose stage success maps to EXPOSED instead of MISSED. Accept both
// the kebab-case names stored in ES and their TA codes, in case either form
// is ingested.
const EXPOSED_TACTICS = new Set(['exfiltration', 'impact', 'TA0010', 'TA0040']);

const PREVENTED_EXIT_CODES = new Set([126, 105, 127]);
const EXECUTED_EXIT_CODES = new Set([101, 0]);
const INCONCLUSIVE_EXIT_CODES = new Set([200, 259, 260]);

// Hard cap on documents pulled for one report. A report window realistically
// covers a handful of bundle runs (5 controls × endpoints × runs); 10k is the
// ES default max_result_window and far above any legitimate window.
const MAX_REPORT_DOCS = 10000;

// Stage alert lookups for detectedTechniques: sub-searches per msearch call,
// and alerts read per stage and vendor.
const MSEARCH_CHUNK = 100;
const ALERTS_PER_STAGE = 50;
const ATTACK_TECHNIQUE_ID = /^T\d{4}(?:\.\d{3})?$/;


export type SbOutcome = 'PREVENTED' | 'DETECTED' | 'MISSED' | 'EXPOSED' | 'NOT_RUN' | 'ERROR';

export interface SbReportExecutionRow {
  sourceEventId: string;
  timestamp: string;
  bundleId: string;
  bundleName: string;
  testName: string;
  hostname: string;
  stage: number;
  stageLabel: string;
  techniques: string[];
  /** Additional field: techniques on the alerts that matched this stage (sorted). */
  detectedTechniques: string[];
  tactics: string[];
  outcome: SbOutcome;
  isProtected: boolean;
  preventedBy: string[];
  detectedBy: string[];
  evidenceRef: string;
}

export interface SbReport {
  meta: {
    organization: string;
    vendor: string;
    window: { from: string; to: string };
    generatedAt: string;
  };
  executions: SbReportExecutionRow[];
}

export interface SbReportParams {
  /** Window start (ISO date or datetime) applied to routing.event_time. */
  from: string;
  /** Window end (ISO date or datetime) applied to routing.event_time. */
  to: string;
  /** Organization UUID filter (routing.oid). */
  org?: string;
  /** SB entity code for meta.organization (defaults to the org short name). */
  orgCode?: string;
  /** meta.vendor (default "ProjectAchilles"). */
  vendor?: string;
  /** Optional f0rtika.bundle_id (bundle UUID) filter. */
  bundleUuid?: string;
  /** Comma-separated f0rtika.tags scope filter (OR semantics). */
  tags?: string;
  /** Comma-separated routing.hostname scope filter (OR semantics). */
  hostnames?: string;
  /** Comma-separated f0rtika.test_name scope filter (OR semantics). */
  tests?: string;
  /** Comma-separated f0rtika.bundle_name scope filter (OR semantics). */
  bundleNames?: string;
}

/** Get field value from ES _source — handles both flattened (dot-key) and nested formats. */
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

/**
 * Validate a report window. Both bounds are required, must parse as dates,
 * and from must be strictly before to. Throws AppError(400) on bad input.
 * Returns the bounds unchanged (ES range queries accept both date-only and
 * full ISO forms).
 */
export function parseSbReportWindow(from: unknown, to: unknown): { from: string; to: string } {
  if (typeof from !== 'string' || !from.trim() || typeof to !== 'string' || !to.trim()) {
    throw new AppError('from and to query parameters are required (ISO dates)', 400);
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new AppError('from and to must be valid ISO dates', 400);
  }
  if (fromMs >= toMs) {
    throw new AppError('from must be before to', 400);
  }
  return { from: from.trim(), to: to.trim() };
}

/** Extract the stage number from a control_validator like "Stage 2: ...". */
function parseStageFromValidator(validator: unknown): number | undefined {
  if (validator === undefined || validator === null) return undefined;
  const m = String(validator).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Build a scope filter for a comma-separated value list, mirroring the
 * analytics filter-bar semantics (buildTagsFilter et al. in
 * services/analytics/elasticsearch.ts): single value → term clause,
 * multiple values → bool should of terms with minimum_should_match 1.
 */
function buildScopeFilter(csv: string | undefined, field: string): any | null {
  if (!csv) return null;
  const values = csv.split(',').map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) return null;
  if (values.length === 1) {
    return { term: { [field]: values[0] } };
  }
  return {
    bool: {
      should: values.map((v) => ({ term: { [field]: v } })),
      minimum_should_match: 1,
    },
  };
}

/** Normalize a timestamp to ISO 8601 with an explicit timezone (SB requires the zone). */
function isoWithTz(ts: unknown): string {
  if (typeof ts !== 'string' || !ts.trim()) return '';
  const value = ts.trim();
  if (value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

/**
 * The techniques a stage executed: the result doc's own, then every technique
 * the library declares for that stage (matched by its primary technique, the
 * control id), without repeats.
 */
function stageTechniques(source: any): string[] {
  const controlId = getField(source, 'f0rtika.control_id');
  const own: string[] = getField(source, 'f0rtika.techniques') ?? [controlId].filter(Boolean);
  const bundleId = getField(source, 'f0rtika.bundle_id');
  const declared = bundleId && controlId
    ? getTestMetadata(String(bundleId))?.stages?.find((s) => s.technique === controlId)?.techniques
    : undefined;
  return [...new Set([...own, ...(declared ?? [])])];
}

/** Decide the SB outcome for one bundle-control doc. */
function mapOutcome(
  exitCode: number | undefined,
  rawTactics: string[],
  edrDetected: boolean,
  vendorPrevented: boolean,
): SbOutcome {
  if (exitCode !== undefined && PREVENTED_EXIT_CODES.has(exitCode)) return 'PREVENTED';
  // Vendor-confirmed prevention (prevention disposition/remediationStatus on
  // the correlated alert) → PREVENTED, including error/inconclusive exits
  // (999/259/0) — a stage killed at launch never reaches a conclusive code.
  // The one exception is 101 (conclusively executed unprotected): a succeeded
  // attack cannot have been prevented. Enrichment writes the flag under the
  // same rule (stage matches always qualify; wide matches only for
  // non-conclusive docs), so a 101 + flag combo shouldn't occur — the guard
  // is belt-and-braces.
  if (vendorPrevented && exitCode !== 101) return 'PREVENTED';
  if (exitCode !== undefined && EXECUTED_EXIT_CODES.has(exitCode)) {
    if (edrDetected) return 'DETECTED';
    if (rawTactics.some((t) => EXPOSED_TACTICS.has(t))) return 'EXPOSED';
    return 'MISSED';
  }
  return 'ERROR';
}

export class SbReportService {
  private client: Client;
  private settings: AnalyticsSettings;

  constructor(settings: AnalyticsSettings) {
    this.settings = settings;
    this.client = createEsClient(settings);
  }

  /** Query bundle-control docs in the window and build the SB report envelope. */
  async generateSbReport(params: SbReportParams): Promise<SbReport> {
    const filters: any[] = [
      { term: { 'f0rtika.is_bundle_control': true } },
      // Same test-data parity filter the analytics query uses (excludes
      // incomplete records such as cleanup operations).
      {
        bool: {
          must: [
            { exists: { field: 'f0rtika.test_uuid' } },
            { exists: { field: 'f0rtika.test_name' } },
          ],
        },
      },
      { range: { 'routing.event_time': { gte: params.from, lte: params.to } } },
    ];
    if (params.org) filters.push({ term: { 'routing.oid': params.org } });
    if (params.bundleUuid) filters.push({ term: { 'f0rtika.bundle_id': params.bundleUuid } });

    // Scope filters only — outcome/result filters would falsify a compliance report.
    const scopeFilters = [
      buildScopeFilter(params.tags, 'f0rtika.tags'),
      buildScopeFilter(params.hostnames, 'routing.hostname'),
      buildScopeFilter(params.tests, 'f0rtika.test_name'),
      buildScopeFilter(params.bundleNames, 'f0rtika.bundle_name'),
    ];
    for (const f of scopeFilters) {
      if (f) filters.push(f);
    }

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: MAX_REPORT_DOCS,
      query: { bool: { filter: filters } },
      // Newest first: if the 10k cap ever truncates, recent runs survive.
      sort: [{ 'routing.event_time': 'desc' }],
    });

    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value ?? 0;
    if (total > MAX_REPORT_DOCS) {
      console.warn(
        `[sb-report] window ${params.from}..${params.to} matched ${total} docs; ` +
        `report truncated to the newest ${MAX_REPORT_DOCS}`,
      );
    }

    // SB reports are per-bulletin: a single export must not mix bundles.
    const distinctBundles = new Set(
      response.hits.hits.map((hit: any) => getField(hit._source ?? {}, 'f0rtika.bundle_id')).filter(Boolean),
    );
    if (distinctBundles.size > 1) {
      console.warn(
        `[sb-report] WARNING: export mixes ${distinctBundles.size} distinct bundles ` +
        `(${[...distinctBundles].join(', ')}). SB reports are per-bulletin — ` +
        `narrow the export with the bundle filter or bundle_uuid.`,
      );
    }

    const detectedTechniques = await this.stageAlertTechniques(response.hits.hits);
    const executions = this.buildRows(response.hits.hits, detectedTechniques);

    return {
      meta: {
        organization: params.orgCode
          || (params.org ? orgShortName(params.org) : undefined)
          || params.org
          || 'unknown',
        vendor: params.vendor || 'ProjectAchilles',
        window: { from: params.from, to: params.to },
        generatedAt: new Date().toISOString(),
      },
      executions,
    };
  }

  /**
   * ATT&CK techniques on the alerts that matched each stage's own binary, keyed
   * by result doc _id. Searched only for vendors whose <vendor>_stage_detected
   * flag is set, with the same stage query the enrichment pass used to set it.
   * Optional data: a failed search is logged and leaves the stage empty.
   */
  private async stageAlertTechniques(hits: any[]): Promise<Map<string, string[]>> {
    const lookups: Array<{ id: string; index: string; query: Record<string, unknown> }> = [];
    for (const hit of hits) {
      const source = hit._source ?? {};
      const input = {
        test_uuid: getField(source, 'f0rtika.test_uuid') ?? '',
        routing_event_time: getField(source, 'routing.event_time') ?? '',
        routing_hostname: getField(source, 'routing.hostname') ?? '',
        control_id: getField(source, 'f0rtika.control_id') ?? '',
      };
      for (const { vendor, index } of VENDOR_INDICES) {
        if (getField(source, edrFlagField(vendor, 'stage_detected')) !== true) continue;
        const query = vendor === 'defender'
          ? buildStageDefenderEvidenceQuery(input)
          : buildStageCrowdStrikeEvidenceQuery(input);
        if (query) lookups.push({ id: String(hit._id ?? ''), index, query });
      }
    }

    const found = new Map<string, Set<string>>();
    for (let start = 0; start < lookups.length; start += MSEARCH_CHUNK) {
      const chunk = lookups.slice(start, start + MSEARCH_CHUNK);
      try {
        const response: any = await this.client.msearch({
          searches: chunk.flatMap((l) => [
            { index: l.index },
            { size: ALERTS_PER_STAGE, _source: ['mitre_techniques'], query: l.query },
          ]),
        });
        (response.responses ?? []).forEach((r: any, i: number) => {
          if (r?.error) {
            console.warn(`[sb-report] stage alert search in ${chunk[i].index} failed: ${r.error.type ?? JSON.stringify(r.error)}`);
            return;
          }
          const set = found.get(chunk[i].id) ?? new Set<string>();
          for (const alert of r?.hits?.hits ?? []) {
            for (const t of alert._source?.mitre_techniques ?? []) {
              if (typeof t === 'string' && ATTACK_TECHNIQUE_ID.test(t)) set.add(t);
            }
          }
          found.set(chunk[i].id, set);
        });
      } catch (err) {
        console.warn(`[sb-report] stage alert search failed; detectedTechniques left empty: ${err instanceof Error ? err.message : err}`);
      }
    }
    return new Map([...found].map(([id, set]) => [id, [...set].sort()]));
  }

  /** Map raw ES hits to report rows, resolving stage numbers and outcomes. */
  private buildRows(hits: any[], detectedTechniques = new Map<string, string[]>()): SbReportExecutionRow[] {
    // Pre-pass: per execution group (bundle run on one host), docs whose
    // control_validator carries no "Stage N" fall back to their position when
    // members are ordered by control_id.
    const fallbackStage = new Map<any, number>();
    const groups = new Map<string, any[]>();
    for (const hit of hits) {
      const source = hit._source ?? {};
      const key = [
        getField(source, 'f0rtika.bundle_id') ?? '',
        getField(source, 'routing.hostname') ?? '',
        getField(source, 'routing.event_time') ?? '',
      ].join('::');
      const list = groups.get(key);
      if (list) list.push(hit);
      else groups.set(key, [hit]);
    }
    for (const members of groups.values()) {
      const sorted = [...members].sort((a, b) => {
        const ac = String(getField(a._source ?? {}, 'f0rtika.control_id') ?? '');
        const bc = String(getField(b._source ?? {}, 'f0rtika.control_id') ?? '');
        return ac.localeCompare(bc);
      });
      sorted.forEach((hit, index) => fallbackStage.set(hit, index + 1));
    }

    const rows: SbReportExecutionRow[] = hits.map((hit) => {
      const source = hit._source ?? {};
      const exitCode = getField(source, 'event.ERROR');
      const errorName = resolveErrorName(exitCode, getField(source, 'f0rtika.error_name'));
      const rawTactics: string[] = getField(source, 'f0rtika.tactics') ?? [];
      const techniques = stageTechniques(source);
      const controlName = getField(source, 'f0rtika.control_name');
      // Per registry vendor: detected (this stage's own flag only, never the
      // run-wide <vendor>_detected that every stage of the run carries) and
      // vendor-confirmed prevention — deterministic evidence from the
      // correlated alert (e.g. Defender remediationStatus / Falcon
      // pattern_disposition), not inference.
      const detected = (k: EdrVendorKey) => getField(source, edrFlagField(k, 'stage_detected')) === true;
      const prevented = (k: EdrVendorKey) => Boolean(getField(source, edrFlagField(k, 'prevented')));
      // Vendor attribution — when several vendors detected the stage, list them all.
      const detectingVendors = EDR_VENDOR_KEYS.filter(detected).map((k) => edrVendor(k).productName);
      // preventedBy lists each vendor whose prevented flag is set. Defender
      // keeps its pre-flag exit-code attribution too (a Defender-detected
      // stage that ended 105/126/127 was already credited to Defender).
      const preventingVendors = EDR_VENDOR_KEYS
        .filter((k) => prevented(k) || (k === 'defender' && detected(k)))
        .map((k) => edrVendor(k).productName);
      const anyVendorPrevented = EDR_VENDOR_KEYS.some(prevented);
      const edrDetected = detectingVendors.length > 0;

      const stage = parseStageFromValidator(getField(source, 'f0rtika.control_validator'))
        ?? fallbackStage.get(hit)
        ?? 0;
      const outcome = mapOutcome(exitCode, rawTactics, edrDetected, anyVendorPrevented);
      const sourceEventId = String(hit._id ?? '');

      const inconclusive = exitCode !== undefined && INCONCLUSIVE_EXIT_CODES.has(exitCode);
      const evidenceRef = inconclusive
        ? `${sourceEventId} (inconclusive: ${errorName})`
        : `${sourceEventId} (${errorName})`;

      return {
        sourceEventId,
        timestamp: isoWithTz(getField(source, 'routing.event_time')),
        bundleId: SB_BUNDLE_ID,
        bundleName: SB_BUNDLE_NAME,
        testName: getField(source, 'f0rtika.test_name') || 'Unknown Test',
        hostname: getField(source, 'routing.hostname') || 'unknown',
        stage,
        stageLabel: SB_STAGE_LABELS[stage] || controlName || `Stage ${stage}`,
        techniques,
        detectedTechniques: detectedTechniques.get(sourceEventId) ?? [],
        tactics: rawTactics.map((t) => TACTIC_TO_TA[t] ?? t),
        outcome,
        isProtected: outcome === 'PREVENTED' || outcome === 'DETECTED',
        preventedBy: outcome === 'PREVENTED' ? preventingVendors : [],
        detectedBy: outcome === 'DETECTED' ? detectingVendors : [],
        evidenceRef,
      };
    });

    rows.sort((a, b) =>
      a.hostname.localeCompare(b.hostname)
      || a.timestamp.localeCompare(b.timestamp)
      || a.stage - b.stage);

    return rows;
  }
}
