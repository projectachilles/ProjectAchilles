// SB-PC-2026-001 compliance report — LockBit 3.0 double-extortion bundle.
//
// Read-only projection over bundle-control docs in `achilles-results-*`.
// Builds the SB bulletin section-04 envelope `{meta, executions[]}` with one
// row per technique/stage per endpoint. Outcome semantics mirror the offline
// reference converter (f0_library/utils/sb_report.py), adapted to what the
// ingested ES docs can observe:
//
//   exit 126/105/127                                  -> PREVENTED
//   exit 101 (or 0) + defender_stage/detected flag    -> DETECTED
//   exit 101 (or 0), exfiltration/impact tactics      -> EXPOSED
//   exit 101 (or 0), other tactics                    -> MISSED
//   exit 200/259/260 (inconclusive)                   -> ERROR ("inconclusive: <name>")
//   999 or anything else                              -> ERROR
//
// NOT_RUN is part of the outcome enum but is not emitted server-side: skipped
// controls are not ingested into ES, so there is no data signal to detect them.

import type { Client } from '@elastic/elasticsearch';
import { createEsClient } from '../analytics/client.js';
import { ORG_NAMES, resolveErrorName } from '../analytics/elasticsearch.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { AnalyticsSettings } from '../../types/analytics.js';

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

const MICROSOFT_DEFENDER = 'Microsoft Defender for Endpoint';

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

/** Normalize a timestamp to ISO 8601 with an explicit timezone (SB requires the zone). */
function isoWithTz(ts: unknown): string {
  if (typeof ts !== 'string' || !ts.trim()) return '';
  const value = ts.trim();
  if (value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

/** Decide the SB outcome for one bundle-control doc. */
function mapOutcome(exitCode: number | undefined, rawTactics: string[], defenderDetected: boolean): SbOutcome {
  if (exitCode !== undefined && PREVENTED_EXIT_CODES.has(exitCode)) return 'PREVENTED';
  if (exitCode !== undefined && EXECUTED_EXIT_CODES.has(exitCode)) {
    if (defenderDetected) return 'DETECTED';
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
      { range: { 'routing.event_time': { gte: params.from, lte: params.to } } },
    ];
    if (params.org) filters.push({ term: { 'routing.oid': params.org } });
    if (params.bundleUuid) filters.push({ term: { 'f0rtika.bundle_id': params.bundleUuid } });

    const response = await this.client.search({
      index: this.settings.indexPattern,
      size: MAX_REPORT_DOCS,
      query: { bool: { filter: filters } },
      sort: [{ 'routing.event_time': 'asc' }],
    });

    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value ?? 0;
    if (total > MAX_REPORT_DOCS) {
      console.warn(
        `[sb-report] window ${params.from}..${params.to} matched ${total} docs; ` +
        `report truncated to first ${MAX_REPORT_DOCS}`,
      );
    }

    const executions = this.buildRows(response.hits.hits);

    return {
      meta: {
        organization: params.orgCode
          || (params.org ? ORG_NAMES[params.org] : undefined)
          || params.org
          || 'unknown',
        vendor: params.vendor || 'ProjectAchilles',
        window: { from: params.from, to: params.to },
        generatedAt: new Date().toISOString(),
      },
      executions,
    };
  }

  /** Map raw ES hits to report rows, resolving stage numbers and outcomes. */
  private buildRows(hits: any[]): SbReportExecutionRow[] {
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
      const techniques: string[] = getField(source, 'f0rtika.techniques')
        ?? [getField(source, 'f0rtika.control_id')].filter(Boolean);
      const controlName = getField(source, 'f0rtika.control_name');
      const defenderDetected = Boolean(
        getField(source, 'f0rtika.defender_stage_detected') ?? getField(source, 'f0rtika.defender_detected'),
      );

      const stage = parseStageFromValidator(getField(source, 'f0rtika.control_validator'))
        ?? fallbackStage.get(hit)
        ?? 0;
      const outcome = mapOutcome(exitCode, rawTactics, defenderDetected);
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
        tactics: rawTactics.map((t) => TACTIC_TO_TA[t] ?? t),
        outcome,
        isProtected: outcome === 'PREVENTED' || outcome === 'DETECTED',
        preventedBy: outcome === 'PREVENTED' && defenderDetected ? [MICROSOFT_DEFENDER] : [],
        detectedBy: outcome === 'DETECTED' ? [MICROSOFT_DEFENDER] : [],
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
