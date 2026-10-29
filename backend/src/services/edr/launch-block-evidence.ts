// Pure rule for "the EDR blocked the test orchestrator at launch". Windows
// refuses process creation, so the agent reports exit 260 (BlockedPreExecution)
// and no stage ever runs. The agent cannot tell an EDR block from Defender ASR
// rule 01443614 (a prevalence gate the platform does not count as protection),
// so 260 stays inconclusive unless the EDR's own alert proves it prevented the
// orchestrator of THAT run. No I/O here: callers fetch the 260 result docs and
// the vendors' alerts and pass them in.

import { CONFIRMED_PREVENTION_ACTIONS } from '../reports/stageOutcome.js';
import { hostMatches, parseSqliteUtc } from './agent-kill-evidence.js';
import { POST_WINDOW_MS, PRE_WINDOW_MS, extractBundleUuid } from './evidence-correlation.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';

/** The agent's exit code for a launch the OS refused (agent/internal/executor). */
export const BLOCKED_PRE_EXECUTION_CODE = 260;

/**
 * How far from the result time a task-directory match may be. The directory is
 * unique to the run, so this bound only keeps the search cheap; a launch block
 * is reported within seconds of the attempt.
 */
export const TASK_PATH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A 260 standalone result doc. `docId` is its ES `_id`, which is the task id. */
export interface LaunchBlockCandidate {
  docId: string;
  testUuid: string;
  hostname: string;
  eventTimeMs: number;
}

/** The vendor-neutral slice of an EDR alert doc this rule needs. */
export interface LaunchBlockEvidenceAlert {
  id: string;
  vendor: EdrVendorKey;
  createdAt: string | null;
  evidenceHostnames: string[];
  evidenceFilenames: string[];
  evidenceFilepaths: string[];
  preventionAction?: string;
  /** True when the prevention was Achilles' own automatic mitigation (`isAchillesMitigated()`). */
  achillesMitigated: boolean;
  /** `f0rtika.achilles_test_uuid`, when an enrichment pass already correlated the alert. */
  achillesTestUuid?: string;
}

/**
 * Which evidence proved it: `task_path` = a file inside the run's own
 * `C:\F0\tasks\task-<task id>-<n>\` directory (exact run); `orchestrator` =
 * the test's `<uuid>.exe` inside the usual correlation window.
 */
export type LaunchBlockMatch = 'task_path' | 'orchestrator';

/** Stored on the result doc as `f0rtika.launch_block`. */
export interface LaunchBlock {
  original_exit_code: typeof BLOCKED_PRE_EXECUTION_CODE;
  vendors: EdrVendorKey[];
  alert_ids: string[];
  evidence: LaunchBlockMatch;
  resolved_at: string;
  /** Each vendor's prevention action, from its earliest proving alert. */
  actions: Partial<Record<EdrVendorKey, string>>;
}

const PREVENTION = new Set<string>(CONFIRMED_PREVENTION_ACTIONS);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The agent's per-run directory: `<work dir>\\tasks\\task-<task id>-<random>\\` (os.MkdirTemp). */
const TASK_DIR_RE = new RegExp(`(?:^|[\\\\/])task-(${UUID})(?=[-\\\\/]|$)`, 'gi');
/** An orchestrator binary: exactly `<test uuid>.exe` (a stage binary is `<uuid>-<id>.exe`). */
const ORCHESTRATOR_RE = new RegExp(`^(${UUID})\\.exe$`, 'i');

/** Task ids of the run directories an alert's file paths name, lower-cased. */
function taskIdsIn(paths: string[]): string[] {
  const ids = new Set<string>();
  for (const p of paths) for (const m of p.matchAll(TASK_DIR_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

/** Test uuids of the orchestrator binaries an alert names, lower-cased. */
function orchestratorUuidsIn(filenames: string[]): string[] {
  const uuids = new Set<string>();
  for (const f of filenames) {
    const m = ORCHESTRATOR_RE.exec(baseName(f.trim()));
    if (m) uuids.add(m[1].toLowerCase());
  }
  return [...uuids];
}

function sameTest(a: string, b: string): boolean {
  const norm = (u: string) => extractBundleUuid(u.trim().toLowerCase());
  return norm(a) === norm(b);
}

/** Does this alert prove the EDR blocked the candidate run's launch? Which evidence, or null. */
export function alertProvesLaunchBlock(c: LaunchBlockCandidate, a: LaunchBlockEvidenceAlert): LaunchBlockMatch | null {
  if (a.achillesMitigated) return null;
  if (!a.preventionAction || !PREVENTION.has(a.preventionAction.toLowerCase())) return null;
  if (!hostMatches(c.hostname, a.evidenceHostnames)) return null;
  if (a.achillesTestUuid && !sameTest(a.achillesTestUuid, c.testUuid)) return null;
  const created = a.createdAt ? parseSqliteUtc(a.createdAt) : NaN;
  if (!Number.isFinite(created)) return null;
  const delta = created - c.eventTimeMs;
  const taskIds = taskIdsIn(a.evidenceFilepaths);
  if (taskIds.length > 0) {
    // The alert names a run directory: it proves that run and no other.
    return taskIds.includes(c.docId.toLowerCase()) && Math.abs(delta) <= TASK_PATH_WINDOW_MS ? 'task_path' : null;
  }
  const want = extractBundleUuid(c.testUuid).trim().toLowerCase();
  if (delta >= -PRE_WINDOW_MS && delta <= POST_WINDOW_MS && orchestratorUuidsIn(a.evidenceFilenames).includes(want)) return 'orchestrator';
  return null;
}

/** What to look up for a set of alerts: the run (task) ids and orchestrator test uuids they name. */
export function evidenceKeys(alerts: LaunchBlockEvidenceAlert[]): { taskIds: string[]; testUuids: string[] } {
  const taskIds = new Set<string>();
  const testUuids = new Set<string>();
  for (const a of alerts) {
    for (const id of taskIdsIn(a.evidenceFilepaths)) taskIds.add(id);
    for (const u of orchestratorUuidsIn(a.evidenceFilenames)) testUuids.add(u);
  }
  return { taskIds: [...taskIds], testUuids: [...testUuids] };
}

/**
 * Proving alerts per candidate doc id. A task-path alert can only prove its
 * own run (the rule enforces it). A file-name-only alert proves at most one
 * run: the qualifying candidate nearest to it in time, so two blocked runs of
 * the same test on one host never share an alert.
 */
export function matchLaunchBlocks(
  candidates: LaunchBlockCandidate[],
  alerts: LaunchBlockEvidenceAlert[],
): Map<string, Array<{ alert: LaunchBlockEvidenceAlert; match: LaunchBlockMatch }>> {
  const out = new Map<string, Array<{ alert: LaunchBlockEvidenceAlert; match: LaunchBlockMatch }>>();
  const add = (docId: string, alert: LaunchBlockEvidenceAlert, match: LaunchBlockMatch) => {
    const list = out.get(docId) ?? [];
    list.push({ alert, match });
    out.set(docId, list);
  };
  for (const alert of alerts) {
    let nearest: { c: LaunchBlockCandidate; distance: number } | null = null;
    for (const c of candidates) {
      const match = alertProvesLaunchBlock(c, alert);
      if (match === 'task_path') {
        add(c.docId, alert, match);
        nearest = null;
        break;
      }
      if (match === 'orchestrator') {
        const distance = Math.abs(parseSqliteUtc(alert.createdAt ?? '') - c.eventTimeMs);
        if (!nearest || distance < nearest.distance) nearest = { c, distance };
      }
    }
    if (nearest) add(nearest.c.docId, alert, 'orchestrator');
  }
  return out;
}

/**
 * Collapse the proving alerts into the stored audit object. Vendors and alert
 * ids are ordered by alert time; `task_path` wins when any alert named the run's
 * directory.
 */
export function summarizeLaunchBlock(
  proofs: Array<{ alert: LaunchBlockEvidenceAlert; match: LaunchBlockMatch }>,
  nowIso: string,
): LaunchBlock {
  const sorted = [...proofs].sort((x, y) => parseSqliteUtc(x.alert.createdAt ?? '') - parseSqliteUtc(y.alert.createdAt ?? ''));
  const vendors: EdrVendorKey[] = [];
  const actions: Partial<Record<EdrVendorKey, string>> = {};
  for (const { alert } of sorted) {
    if (vendors.includes(alert.vendor)) continue;
    vendors.push(alert.vendor);
    if (alert.preventionAction) actions[alert.vendor] = alert.preventionAction.toLowerCase();
  }
  return {
    original_exit_code: BLOCKED_PRE_EXECUTION_CODE,
    vendors,
    alert_ids: sorted.map((p) => p.alert.id),
    evidence: sorted.some((p) => p.match === 'task_path') ? 'task_path' : 'orchestrator',
    resolved_at: nowIso,
    actions,
  };
}
