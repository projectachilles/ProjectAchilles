import type { S1Threat } from '../../types/sentinelone.js';

/**
 * S1 returns incident status / analyst verdict in two vocabularies:
 * `/threats` uses snake_case (`in_progress`, `false_positive`) while
 * `/cloud-detection/alerts` uses display case (`In progress`, `False positive`).
 * Normalize both to the lowercase snake_case the shared facets and the
 * correlation time window expect (`resolved`, `closed`, ...).
 */
export function normalizeToken(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Mitigation-report actions that are an attempt to stop the threat (not rollback / un-quarantine / network). */
const STOP_ACTIONS = new Set(['kill', 'quarantine', 'remediate']);

/**
 * How soon after detection a mitigation must start to count as SentinelOne's
 * own (Protect-mode) response. A kill or quarantine an analyst, a STAR rule or
 * Achilles runs later in the console is not the EDR preventing the test.
 */
export const AUTONOMOUS_MITIGATION_WINDOW_MS = 15 * 60 * 1000;

type MitigationEntry = NonNullable<S1Threat['mitigationStatus']>[number];

/** True unless the entry demonstrably started outside the window (missing timestamps: kept). */
function startedWithDetection(t: S1Threat, m: MitigationEntry): boolean {
  const detected = Date.parse(t.threatInfo?.identifiedAt || t.threatInfo?.createdAt || '');
  const started = Date.parse(m.mitigationStartedAt || m.lastUpdate || '');
  if (Number.isNaN(detected) || Number.isNaN(started)) return true;
  return started - detected <= AUTONOMOUS_MITIGATION_WINDOW_MS;
}

/** Any kill / quarantine / remediate in the report, whoever ran it and whatever the outcome. */
export function hasStopAttempt(t: S1Threat): boolean {
  return (t.mitigationStatus ?? []).some((m) => STOP_ACTIONS.has(m.action ?? ''));
}

/**
 * `threatInfo.initiatedBy` values for a Threat a person raised. A Deep
 * Visibility command ("dv_command", engine "Manual") is an analyst mitigating
 * a process from a threat hunt: the Threat is created by that action, so its
 * kill starts with the detection and would pass the 15-minute window. It is
 * a human response, not SentinelOne preventing the test. Agent policy and the
 * organization's STAR active rules ("star_active") are automatic and count.
 */
export const ANALYST_INITIATED_THREAT_SOURCES: ReadonlySet<string> = new Set(['dv_command']);

/** True when a person raised this Threat (see ANALYST_INITIATED_THREAT_SOURCES). */
export function isAnalystInitiated(t: S1Threat): boolean {
  return ANALYST_INITIATED_THREAT_SOURCES.has(normalizeToken(t.threatInfo?.initiatedBy));
}

/**
 * The prevention action SentinelOne itself took, in the shared vocabulary
 * (quarantined / process_killed / blocked / kill_failed). Only mitigations
 * that started with the detection count (AUTONOMOUS_MITIGATION_WINDOW_MS), and
 * none on a Threat an analyst raised (isAnalystInitiated).
 */
export function threatPreventionAction(t: S1Threat): string | undefined {
  if (isAnalystInitiated(t)) return undefined;
  const report = (t.mitigationStatus ?? []).filter((m) => startedWithDetection(t, m));
  const done = (action: string) => report.some((m) => m.action === action && m.status === 'success');
  if (done('quarantine')) return 'quarantined';
  if (done('kill')) return 'process_killed';
  // Remediation (file removed / changes reverted) maps onto the shared
  // vocabulary like Defender's 'remediated' → 'quarantined'.
  if (done('remediate')) return 'quarantined';
  // 'kill_failed' only when the mitigation report shows a stop attempt
  // (kill / quarantine / remediate) that failed — not for any failed entry.
  if (report.some((m) => STOP_ACTIONS.has(m.action ?? '') && m.status === 'failed')) return 'kill_failed';
  // No report at all: the console's own summary. (Entries that exist but
  // started late are not this case: they were a later, manual response.)
  if ((t.mitigationStatus ?? []).length === 0 && t.threatInfo?.mitigationStatus === 'mitigated') return 'blocked';
  return undefined;
}
