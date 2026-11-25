// Shared projection of a Defender / CrowdStrike alert document into the
// alerts-for-test item shape. Used by both vendors' getAlertsForTest and by
// the execution report's bulk correlation, so the console drill-down and the
// report read the same fields the same way. Both vendor indices share this
// doc shape (alert_title, evidence_filenames, prevention_action, portal_url,
// f0rtika.auto_resolved_at, gated on an enabled, error-free receipt).
//
// With a run window the projection reads the alert's evidence of that run
// only (edr/runEvidence.ts): a Defender alert stays open for days and gathers
// the evidence of later runs. Without a window, or for an alert without
// per-item data (other vendors, older Defender alerts), it reads the alert as
// it is.

import {
  fileVerdicts,
  isMultiTestAlert,
  isTestFile,
  ownActions,
  type EvidenceFields,
} from '../edr/multiTestEvidence.js';
import { ACTION_RANK, isOtherRunAlert, runActions, runEvidence, type RunWindow } from '../edr/runEvidence.js';

/**
 * 'stage': the evidence pins the alert to one stage; 'bundle': to the test
 * as a whole; 'multi_test': it names several Achilles tests and the vendor
 * singled out none of this test's files (a listing of C:\F0), so it is no
 * evidence for this run (edr/multiTestEvidence.ts).
 */
export type AlertAttributionKind = 'stage' | 'bundle' | 'multi_test';

export interface AlertAttribution {
  attribution: AlertAttributionKind;
  attributed_control_id?: string;
}

export interface ProjectedAlert {
  alert_id: string;
  alert_title: string;
  description: string;
  severity: string;
  status: string;
  category: string;
  service_source: string;
  mitre_techniques: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  recommended_actions: string;
  attribution: AlertAttributionKind;
  /** The first of `attributed_control_ids` (kept for older clients). */
  attributed_control_id?: string;
  /**
   * Every stage of this test the evidence names (the run's evidence when there
   * is a run window), in evidence order. Absent when it names none.
   */
  attributed_control_ids?: string[];
  /**
   * For each of `attributed_control_ids`, the strongest action on that stage's
   * own file or a process it started; a stage without one has no entry.
   * Absent when the alert doesn't record actions per evidence item, or no
   * listed stage has an action.
   */
  stage_actions?: Record<string, string>;
  /**
   * The vendor's action: for an alert pinned to one stage, the action on that
   * stage's own file (or a process it started) when the alert records actions
   * per evidence item (edr/multiTestEvidence.ts ownActions), else the alert's.
   * With a run view it never comes from the alert-wide `prevention_action`
   * (no time, mixes runs): the strongest action of the alert's in-run items.
   */
  prevention_action?: string;
  portal_url?: string;
  /** Only for an enabled, error-free auto-resolve receipt (not dry-run, not failed attempts). */
  auto_resolved_at?: string;
}

/**
 * Find a `<bundleUuid>-<token>.exe` evidence binary. The FIRST match wins:
 * vendors often list the orchestrator and stage binaries together, and the
 * stage binary is the discriminating one. Orchestrator-only evidence, no
 * UUID prefix, or another bundle's UUID → bundle-level.
 */
export function classifyAttribution(filenames: readonly string[], bundleUuid: string): AlertAttribution {
  const [first] = stageControlIds(filenames, bundleUuid);
  return first ? { attribution: 'stage', attributed_control_id: first } : { attribution: 'bundle' };
}

/** Every `<bundleUuid>-<token>.exe` evidence binary's token, lower-case, in order, each once. */
export function stageControlIds(filenames: readonly string[], bundleUuid: string): string[] {
  if (!bundleUuid) return [];
  const escaped = bundleUuid.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stagePattern = new RegExp(`^${escaped}-([a-z0-9._-]+?)\\.exe$`, 'i');
  const ids: string[] = [];
  for (const fn of filenames) {
    const m = fn.match(stagePattern);
    if (m && !ids.includes(m[1].toLowerCase())) ids.push(m[1].toLowerCase());
  }
  return ids;
}

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const optional = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));

/**
 * Attribution and prevention of an alert naming several Achilles tests: only
 * this test's files the vendor marked malicious count, each with its own
 * action (one file blocked, another only detected). None: 'multi_test'.
 */
function multiTestAttribution(
  evidence: EvidenceFields,
  bundleUuid: string,
): AlertAttribution & { prevention_action?: string; stage_ids: string[] } {
  const marked = (fileVerdicts(evidence) ?? []).filter((v) => v.verdict === 'malicious' && isTestFile(v.file, bundleUuid));
  if (marked.length === 0) return { attribution: 'multi_test', stage_ids: [] };
  const stage_ids = stageControlIds(marked.map((v) => v.file), bundleUuid);
  for (const v of marked) {
    const a = classifyAttribution([v.file], bundleUuid);
    if (a.attribution === 'stage') return { ...a, stage_ids, ...(v.action ? { prevention_action: v.action } : {}) };
  }
  const action = marked.find((v) => v.action)?.action;
  return { attribution: 'bundle', stage_ids, ...(action ? { prevention_action: action } : {}) };
}

/** Strongest first: a quarantine outranks a kill, a kill a block (same ranking as the Defender sync). */
const strongest = (actions: string[]): string | undefined =>
  [...actions].sort((a, b) => (ACTION_RANK[b] ?? 0) - (ACTION_RANK[a] ?? 0))[0];

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The alert names test `bundleUuid` (a file name, or a path naming the test)
 * only in another run's evidence, none in this run's: it is not this run's
 * alert. False without a run view (edr/runEvidence.ts isOtherRunAlert).
 * `pathNamesTest` is the vendor's rule for a path naming the test, the one its
 * enrichment pass uses (Defender: the uuid or the bundle-name token); without
 * it, a path names the test when it contains the uuid.
 */
export function leftOutOfRun(
  source: Record<string, unknown>,
  bundleUuid: string,
  window: RunWindow | null,
  pathNamesTest?: (path: string) => boolean,
): boolean {
  const uuid = bundleUuid.toLowerCase();
  return isOtherRunAlert(source, window, uuid, pathNamesTest ?? ((path) => path.toLowerCase().includes(uuid)));
}

export function projectAlertHit(
  source: Record<string, unknown>,
  bundleUuid: string,
  window: RunWindow | null = null,
): ProjectedAlert {
  const f0 = (source.f0rtika ?? {}) as Record<string, unknown>;
  // The run view of the evidence when there is one, else the alert as it is.
  const view = runEvidence(source, window);
  const evidence: EvidenceFields = view ?? source;
  const multi = isMultiTestAlert(evidence) ? multiTestAttribution(evidence, bundleUuid) : null;
  const { attribution, attributed_control_id } = multi
    ?? classifyAttribution(strings(evidence.evidence_filenames), bundleUuid);
  const stageIds = multi ? multi.stage_ids : stageControlIds(strings(evidence.evidence_filenames), bundleUuid);
  // A multi-test alert shows only this test's file's own action. With a run
  // view, never the alert-wide action: the in-run items' strongest, or none.
  const inRunActions = view ? runActions(source, window) ?? [] : null;
  let prevention_action = multi
    ? multi.prevention_action
    : inRunActions ? strongest(inRunActions) : optional(source.prevention_action);
  // Each stage's own action (its file, or a process it started), as the stage
  // verdict uses: another stage's block in the same alert is not this stage's.
  // Vendors without per-item actions have none (ownActions null).
  const stageOwn = (id: string) => ownActions(evidence, (f) => classifyAttribution([f], bundleUuid).attributed_control_id === id);
  const stage_actions: Record<string, string> = {};
  for (const id of stageIds) {
    const own = stageOwn(id);
    const action = own ? strongest(own) : undefined;
    if (action) stage_actions[id] = action;
  }
  // An alert pinned to one stage shows that stage's own action. Vendors
  // without per-item actions keep the alert's.
  if (attribution === 'stage' && attributed_control_id) {
    const own = stageOwn(attributed_control_id);
    if (own) prevention_action = strongest(own);
  }
  const portal_url = optional(source.portal_url);
  // The auto-resolve receipt writer stamps auto_resolved_at on EVERY receipt,
  // including dry-run receipts (no PATCH made) and failed attempts (carry
  // auto_resolve_error). Only an enabled, error-free receipt means the alert
  // was really resolved in the vendor console. Each field is read from the
  // nested f0rtika object, falling back to the dotted top-level key.
  const receiptMode = optional(f0.auto_resolve_mode ?? source['f0rtika.auto_resolve_mode']);
  const receiptError = optional(f0.auto_resolve_error ?? source['f0rtika.auto_resolve_error']);
  const auto_resolved_at = receiptMode === 'enabled' && !receiptError
    ? optional(f0.auto_resolved_at ?? source['f0rtika.auto_resolved_at'])
    : undefined;
  return {
    alert_id: text(source.alert_id),
    alert_title: text(source.alert_title),
    description: text(source.description),
    severity: text(source.severity),
    status: text(source.status),
    category: text(source.category),
    service_source: text(source.service_source),
    mitre_techniques: (source.mitre_techniques as string[] | undefined) ?? [],
    created_at: text(source.created_at),
    updated_at: text(source.updated_at),
    resolved_at: source.resolved_at ? String(source.resolved_at) : null,
    recommended_actions: text(source.recommended_actions),
    attribution,
    ...(attributed_control_id ? { attributed_control_id } : {}),
    ...(stageIds.length > 0 ? { attributed_control_ids: stageIds } : {}),
    ...(Object.keys(stage_actions).length > 0 ? { stage_actions } : {}),
    ...(prevention_action ? { prevention_action } : {}),
    ...(portal_url ? { portal_url } : {}),
    ...(auto_resolved_at ? { auto_resolved_at } : {}),
  };
}
