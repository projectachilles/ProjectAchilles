import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, SkipForward } from 'lucide-react';
import { format, formatDistanceToNow, isValid } from 'date-fns';
import type {
  CategoryType,
  EnrichedTestExecution,
  ExecutionGroup,
  SeverityLevel,
} from '@/services/api/analytics';
import {
  formatPreventionAction,
  isConfirmedPrevention,
} from '../../utils/prevention';

// ── Timestamps ─────────────────────────────────────────────────────

/** Parse timestamp — handles both epoch-ms strings and ISO strings. */
export function parseTimestamp(timestamp: string): Date {
  if (/^\d+$/.test(timestamp)) {
    return new Date(parseInt(timestamp, 10));
  }
  return new Date(timestamp);
}

export function formatTimestamp(timestamp: string, relative = true): string {
  if (!timestamp) return 'Unknown';
  try {
    const date = parseTimestamp(timestamp);
    if (!isValid(date)) return 'Unknown';
    if (relative) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    return format(date, 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return 'Unknown';
  }
}

// ── Alert time annotations (related-alert panels) ──────────────────

/** Fields both vendors' alert items carry for the run-relative annotation. */
export interface AlertTimingFields {
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const TERMINAL_ALERT_STATUSES = new Set(['resolved', 'closed']);

/**
 * Re-fire watermark (mirrors the backend window rule in
 * docs/edr-alert-refire-watermark.md): a terminal alert whose updated_at is
 * more than 60s after its resolved_at re-fired — the bump is vendor evidence
 * activity, not the resolution itself (resolution-adjacent bumps like comment
 * POSTs land within the 60s epsilon).
 */
const REFIRE_WATERMARK_MS = 60_000;

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = parseTimestamp(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function relativeToRun(runMs: number, alertMs: number): string {
  const deltaMin = Math.round(Math.abs(alertMs - runMs) / 60000);
  const direction = alertMs > runMs ? 'after' : 'before';
  return deltaMin < 60 ? `${deltaMin}m ${direction}` : `${Math.round(deltaMin / 60)}h ${direction}`;
}

/**
 * Run-relative annotation for a correlated alert row. Default: created_at vs
 * the run time ("13m after" / "49h before"). Re-fired terminal alerts (status
 * resolved/closed with updated_at > resolved_at + 60s) are annotated from the
 * re-fire time instead, with the original first-seen date — "re-fired 3m
 * after · first seen Oct 10" — so an old aggregated alert re-surfaced by the
 * watermark rule doesn't read as a 49-hour-old echo. Missing or unparseable
 * fields fall back to the created-relative annotation.
 */
export function alertRunTimeAnnotation(runTimestamp: string, alert: AlertTimingFields): string {
  const runMs = parseTimestamp(runTimestamp).getTime();
  const isTerminal = TERMINAL_ALERT_STATUSES.has(alert.status?.toLowerCase());
  const resolvedMs = toEpochMs(alert.resolved_at);
  const updatedMs = toEpochMs(alert.updated_at);

  if (isTerminal && resolvedMs !== null && updatedMs !== null && updatedMs > resolvedMs + REFIRE_WATERMARK_MS) {
    const createdMs = toEpochMs(alert.created_at);
    const firstSeen = createdMs !== null ? format(parseTimestamp(alert.created_at), 'MMM d') : 'unknown';
    return `re-fired ${relativeToRun(runMs, updatedMs)} · first seen ${firstSeen}`;
  }

  const createdMs = new Date(alert.created_at).getTime();
  return relativeToRun(runMs, createdMs);
}

// ── Severity / error-code semantics ────────────────────────────────

export const SEVERITY_VARIANTS: Record<SeverityLevel, string> = {
  critical: 'bg-danger-dim text-danger border-danger/30',
  high: 'bg-warning-dim text-warning border-warning/30',
  medium: 'bg-warning-dim text-warning border-warning/30',
  low: 'bg-info-dim text-info border-info/30',
  info: 'bg-raised text-muted border-border',
};

export const ALERT_SEVERITY_CLASSES: Record<string, string> = {
  critical: 'bg-danger-dim text-danger border-danger/30',
  high: 'bg-danger-dim text-danger border-danger/30',
  medium: 'bg-warning-dim text-warning border-warning/30',
  low: 'bg-accent-dim text-accent border-accent/30',
  informational: 'bg-info-dim text-info border-info/30',
};

/** Error code → category mapping (mirrors backend ERROR_CODE_MAP). */
export const ERROR_CODE_CATEGORIES: Record<number, string> = {
  0: 'inconclusive',
  1: 'contextual',
  101: 'failed',
  105: 'protected',
  126: 'protected',
  127: 'protected',
  200: 'inconclusive',
  259: 'inconclusive',
  999: 'error',
};

export const ERROR_CATEGORY_COLORS: Record<string, string> = {
  protected: 'text-accent',
  failed: 'text-danger',
  inconclusive: 'text-warning',
  contextual: 'text-warning',
  error: 'text-warning',
};

const PROTECTED_CODES = new Set([105, 126, 127]);
const UNPROTECTED_CODES = new Set([101]);

export function getResultFromErrorCode(
  errorCode: number | undefined,
): 'protected' | 'unprotected' | 'inconclusive' {
  if (errorCode === undefined || errorCode === null) return 'inconclusive';
  if (UNPROTECTED_CODES.has(errorCode)) return 'unprotected';
  if (PROTECTED_CODES.has(errorCode)) return 'protected';
  return 'inconclusive';
}

/** Skipped bundle stages: non-cyber-hygiene with exit code 0. */
export function isSkippedStage(exec: EnrichedTestExecution): boolean {
  return Boolean(exec.is_bundle_control && exec.error_code === 0 && exec.category !== 'cyber-hygiene');
}

// ── Display rows (bundle grouping) ─────────────────────────────────

export interface BundleGroup {
  type: 'bundle';
  key: string;
  bundle_id: string;
  bundle_name: string;
  hostname: string;
  timestamp: string;
  controls: EnrichedTestExecution[];
  protectedCount: number;
  unprotectedCount: number;
  totalCount: number;
  category?: CategoryType;
  defenderDetected?: boolean;
  crowdstrikeDetected?: boolean;
  crowdstrikePrevented?: boolean;
  defenderPrevented?: boolean;
  sentineloneDetected?: boolean;
  sentinelonePrevented?: boolean;
}

export interface StandaloneRow {
  type: 'standalone';
  key: string;
  execution: EnrichedTestExecution;
}

export type DisplayRow = BundleGroup | StandaloneRow;

/** Map server-provided ExecutionGroups to DisplayRows for rendering. */
export function mapGroupsToDisplayRows(groups: ExecutionGroup[]): DisplayRow[] {
  return groups.map((group) => {
    if (group.type === 'bundle') {
      const rep = group.representative;
      return {
        type: 'bundle' as const,
        key: group.groupKey,
        bundle_id: rep.bundle_id || '',
        bundle_name: rep.bundle_name || 'Bundle',
        hostname: rep.hostname,
        timestamp: rep.timestamp,
        controls: group.members,
        protectedCount: group.protectedCount,
        unprotectedCount: group.unprotectedCount,
        totalCount: group.totalCount,
        category: rep.category,
        defenderDetected: group.defenderDetected,
        crowdstrikeDetected: group.crowdstrikeDetected,
        crowdstrikePrevented: group.crowdstrikePrevented,
        defenderPrevented: group.defenderPrevented,
        sentineloneDetected: group.sentineloneDetected,
        sentinelonePrevented: group.sentinelonePrevented,
      };
    }
    return {
      type: 'standalone' as const,
      key: group.groupKey,
      execution: group.representative,
    };
  });
}

// ── Result labels ──────────────────────────────────────────────────

export type ExecutionOutcome = 'skipped' | 'protected' | 'prevented' | 'detected' | 'unprotected' | 'inconclusive';

/**
 * The console's stage outcome rule, as a pure function. The execution
 * report's backend implements the same rule
 * (backend/src/services/reports/stageOutcome.ts); both are pinned by the same
 * golden table.
 */
export function classifyExecution(exec: EnrichedTestExecution): ExecutionOutcome {
  if (isSkippedStage(exec)) return 'skipped';
  const result = getResultFromErrorCode(exec.error_code);
  if (result === 'protected') return 'protected';
  if (result !== 'unprotected') return 'inconclusive';
  const csDetected = exec.crowdstrike_stage_detected ?? exec.crowdstrike_detected;
  const defDetected = exec.defender_stage_detected ?? exec.defender_detected;
  const s1Detected = exec.sentinelone_stage_detected ?? exec.sentinelone_detected;
  const isPrevented =
    exec.crowdstrike_prevented ||
    (csDetected && isConfirmedPrevention(exec.crowdstrike_prevention_action)) ||
    exec.defender_prevented ||
    (defDetected && isConfirmedPrevention(exec.defender_prevention_action)) ||
    exec.sentinelone_prevented ||
    (s1Detected && isConfirmedPrevention(exec.sentinelone_prevention_action));
  if (isPrevented) return 'prevented';
  if (defDetected || csDetected || s1Detected) return 'detected';
  return 'unprotected';
}

/**
 * Result label for a single execution. Precedence: Protected (EDR blocked) >
 * Prevented (vendor-confirmed prevention from either EDR — CrowdStrike
 * pattern_disposition or Defender remediationStatus: quarantine / process
 * killed / blocked) > Detected (an enrichment pass correlated this doc to an
 * alert — the cloud SIEM caught what the endpoint missed) > Unprotected.
 * Stage-specific flags are preferred; the bundle-level flags are the fallback
 * for docs predating stage-specific enrichment (over-detects, but strictly
 * safer than silently showing Unprotected). 'kill_failed' never counts as
 * Prevented.
 */
export function ExecResultLabel({ exec, compact }: { exec: EnrichedTestExecution; compact?: boolean }) {
  const iconClass = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const textClass = compact ? 'text-xs font-medium' : 'text-sm font-medium';

  switch (classifyExecution(exec)) {
    case 'skipped':
      return (
        <span className="inline-flex items-center gap-1.5 text-faint">
          <SkipForward className={iconClass} />
          <span className={textClass}>Skipped</span>
        </span>
      );
    case 'protected':
      return (
        <span className="inline-flex items-center gap-1.5 text-accent">
          <ShieldCheck className={iconClass} />
          <span className={textClass}>Protected</span>
        </span>
      );
    case 'prevented': {
      const action = formatPreventionAction(
        exec.crowdstrike_prevention_action ?? exec.sentinelone_prevention_action ?? exec.defender_prevention_action,
      );
      return (
        <span className="inline-flex items-center gap-1.5 text-accent">
          <ShieldCheck className={iconClass} />
          <span className={textClass}>
            {compact || !action ? 'Prevented' : `Prevented (${action})`}
          </span>
        </span>
      );
    }
    case 'detected':
      return (
        <span className="inline-flex items-center gap-1.5 text-warning">
          <ShieldAlert className={iconClass} />
          <span className={textClass}>Detected</span>
        </span>
      );
    case 'unprotected':
      return (
        <span className="inline-flex items-center gap-1.5 text-danger">
          <ShieldX className={iconClass} />
          <span className={textClass}>Unprotected</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-warning">
          <ShieldQuestion className={iconClass} />
          <span className={textClass}>Inconclusive</span>
        </span>
      );
  }
}

/**
 * Bundle rollup label. Any-stage rollup with four-tier priority:
 * Protected > Prevented > Detected > Unprotected — kill-chain semantic:
 * breaking one link breaks the chain. Cyber-hygiene bundles keep per-control
 * ratio scoring since each control is evaluated independently.
 */
export function BundleResultLabel({ group, compact }: { group: BundleGroup; compact?: boolean }) {
  const iconClass = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const textClass = compact ? 'text-xs font-medium' : 'text-sm font-medium';
  const isProtected = group.protectedCount > 0;
  const isPrevented = !isProtected && (group.crowdstrikePrevented || group.defenderPrevented || group.sentinelonePrevented);
  const isDetected =
    !isProtected && !isPrevented && (group.defenderDetected || group.crowdstrikeDetected || group.sentineloneDetected);

  if (group.category === 'cyber-hygiene') {
    if (isPrevented) {
      return (
        <span className="inline-flex items-center gap-1.5 text-accent">
          <ShieldCheck className={iconClass} />
          <span className={textClass}>
            {group.protectedCount}/{group.totalCount} Prevented
          </span>
        </span>
      );
    }
    if (isDetected) {
      return (
        <span className="inline-flex items-center gap-1.5 text-warning">
          <ShieldAlert className={iconClass} />
          <span className={textClass}>
            {group.protectedCount}/{group.totalCount} Detected
          </span>
        </span>
      );
    }
    const ratio = group.totalCount > 0 ? group.protectedCount / group.totalCount : 0;
    const color = ratio >= 0.8 ? 'text-accent' : ratio >= 0.5 ? 'text-warning' : 'text-danger';
    return (
      <span className={`inline-flex items-center gap-1.5 ${color}`}>
        <ShieldCheck className={iconClass} />
        <span className={textClass}>
          {group.protectedCount}/{group.totalCount} Protected
        </span>
      </span>
    );
  }

  const label = isProtected ? 'Protected' : isPrevented ? 'Prevented' : isDetected ? 'Detected' : 'Unprotected';
  const cls = isProtected || isPrevented ? 'text-accent' : isDetected ? 'text-warning' : 'text-danger';
  const Icon = isProtected || isPrevented ? ShieldCheck : isDetected ? ShieldAlert : ShieldX;
  return (
    <span className={`inline-flex items-center gap-1.5 ${cls}`}>
      <Icon className={iconClass} />
      <span className={textClass}>{label}</span>
    </span>
  );
}

// ── Export column definitions (CSV headers) ────────────────────────

export const EXPORT_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'test_name', label: 'Test Name' },
  { key: 'hostname', label: 'Hostname' },
  { key: 'result', label: 'Result' },
  { key: 'severity', label: 'Severity' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'threat_actor', label: 'Threat Actor' },
  { key: 'techniques', label: 'Techniques' },
  { key: 'tactics', label: 'Tactics' },
  { key: 'tags', label: 'Tags' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'target', label: 'Target' },
  { key: 'score', label: 'Score' },
  { key: 'error', label: 'Result Code' },
  { key: 'org', label: 'Organization' },
  { key: 'timestamp', label: 'Time' },
];

export function getCellValue(exec: EnrichedTestExecution, key: string): string | number | undefined {
  switch (key) {
    case 'test_name': return exec.test_name;
    case 'hostname': return exec.hostname;
    case 'result': {
      const r = getResultFromErrorCode(exec.error_code);
      return r === 'protected' ? 'Protected' : r === 'unprotected' ? 'Unprotected' : 'Inconclusive';
    }
    case 'severity': return exec.severity;
    case 'category': return exec.category;
    case 'subcategory': return exec.subcategory;
    case 'threat_actor': return exec.threat_actor;
    case 'techniques': return exec.techniques?.join(', ');
    case 'tactics': return exec.tactics?.join(', ');
    case 'tags': return exec.tags?.join(', ');
    case 'complexity': return exec.complexity;
    case 'target': return exec.target;
    case 'score': return exec.score;
    case 'error': {
      if (!exec.error_name && !exec.error_code) return '';
      if (exec.error_name && exec.error_code) return `${exec.error_name} (${exec.error_code})`;
      return exec.error_name || String(exec.error_code ?? '');
    }
    case 'org': return exec.org;
    case 'timestamp': return formatTimestamp(exec.timestamp);
    default: return '';
  }
}

/** Sortable fields for the master-detail toolbar (replaces column-header sort). */
export const SORT_FIELDS: Array<{ field: string; label: string }> = [
  { field: 'routing.event_time', label: 'Time' },
  { field: 'f0rtika.test_name', label: 'Test name' },
  { field: 'routing.hostname', label: 'Hostname' },
  { field: 'f0rtika.is_protected', label: 'Result' },
  { field: 'f0rtika.severity', label: 'Severity' },
  { field: 'f0rtika.category', label: 'Category' },
  { field: 'f0rtika.score', label: 'Score' },
];
