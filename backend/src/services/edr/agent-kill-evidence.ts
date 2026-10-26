// Pure rule for "the EDR killed the agent mid-test". When the agent process is
// killed, the watchdog fails the task ("Agent went offline during execution" /
// "Task exceeded execution timeout") and no result ever reaches Elasticsearch.
// An EDR alert that prevented a process on that host, inside the task's
// execution window, with a technique the test exercises, is the evidence that
// turns that failure into a Protected result. No I/O here: callers fetch the
// tasks and alerts and pass them in.

/** `tasks.error_message` values the watchdog writes when an agent vanishes. */
export const AGENT_KILL_WATCHDOG_ERRORS = [
  'Agent went offline during execution',
  'Task exceeded execution timeout',
] as const;

export type EdrVendorKey = 'defender' | 'crowdstrike' | 'sentinelone';

/** A watchdog-failed task, with its timestamps already parsed to epoch ms. */
export interface KillCandidateTask {
  taskId: string;
  hostname: string;
  assignedAtMs: number;
  failedAtMs: number;
  techniques: string[];
}

/** The vendor-neutral slice of an EDR alert doc this rule needs. */
export interface KillEvidenceAlert {
  id: string;
  vendor: EdrVendorKey;
  createdAt: string | null;
  evidenceHostnames: string[];
  mitreTechniques: string[];
  preventionAction?: string;
  /** True when the prevention was Achilles' own automatic mitigation (`isAchillesMitigated()` on the alert doc). */
  achillesMitigated: boolean;
}

/** Stored in the task result JSON as `edr_terminated`. */
export interface EdrTermination {
  vendors: EdrVendorKey[];
  alert_ids: string[];
  killed_at: string;
  reconciled_at: string;
}

/** Prevention actions that mean the EDR itself stopped the process. */
export const KILL_PREVENTION_ACTIONS = ['process_killed', 'quarantined', 'blocked'] as const;
const QUALIFYING_PREVENTION_ACTIONS = new Set<string>(KILL_PREVENTION_ACTIONS);

/**
 * Epoch ms for a SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`, UTC
 * with no zone marker) or an ISO string. NaN when unparseable. Naive values
 * get an explicit `Z`, otherwise `Date.parse` would read them as local time.
 */
export function parseSqliteUtc(s: string): number {
  const naive = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s);
  return Date.parse(naive ? `${s.replace(' ', 'T')}Z` : s);
}

/** Lower-cased host name up to the first dot. */
export function shortHostname(h: string): string {
  return h.trim().toLowerCase().split('.')[0];
}

/** Exact match on the short name, so `SBL4862` never matches `SBL48621`. */
export function hostMatches(agentHost: string, evidence: string[]): boolean {
  const want = shortHostname(agentHost);
  return want !== '' && evidence.some((e) => shortHostname(e) === want);
}

/** `T1003.001` -> `t1003`. */
function parentTechnique(t: string): string {
  return t.trim().toLowerCase().split('.')[0];
}

/** True when any technique pair shares a parent (sub-techniques count). */
export function techniquesOverlap(a: string[], b: string[]): boolean {
  const parents = new Set(a.map(parentTechnique).filter(Boolean));
  return b.some((t) => parents.has(parentTechnique(t)));
}

/** Does this alert prove the EDR killed the task's agent? */
export function alertProvesKill(task: KillCandidateTask, alert: KillEvidenceAlert): boolean {
  if (!alert.createdAt) return false;
  const created = parseSqliteUtc(alert.createdAt);
  // NaN fails both comparisons, so an unparseable time is rejected here.
  if (!(created >= task.assignedAtMs && created <= task.failedAtMs)) return false;
  if (alert.achillesMitigated) return false;
  if (!alert.preventionAction || !QUALIFYING_PREVENTION_ACTIONS.has(alert.preventionAction.toLowerCase())) return false;
  if (!hostMatches(task.hostname, alert.evidenceHostnames)) return false;
  return techniquesOverlap(task.techniques, alert.mitreTechniques);
}

/**
 * Collapse the proving alerts into the stored marker. Vendors are deduped and
 * ordered by their earliest alert; `killed_at` is the earliest alert time.
 */
export function summarizeTermination(alerts: KillEvidenceAlert[], nowIso: string): EdrTermination {
  const sorted = alerts
    .filter((a): a is KillEvidenceAlert & { createdAt: string } => a.createdAt !== null)
    .sort((x, y) => parseSqliteUtc(x.createdAt) - parseSqliteUtc(y.createdAt));
  const vendors: EdrVendorKey[] = [];
  for (const a of sorted) if (!vendors.includes(a.vendor)) vendors.push(a.vendor);
  return {
    vendors,
    alert_ids: sorted.map((a) => a.id),
    killed_at: sorted[0]?.createdAt ?? nowIso,
    reconciled_at: nowIso,
  };
}
