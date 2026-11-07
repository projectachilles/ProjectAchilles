// Shared projection of a Defender / CrowdStrike alert document into the
// alerts-for-test item shape. Used by both vendors' getAlertsForTest and by
// the execution report's bulk correlation, so the console drill-down and the
// report read the same fields the same way. Both vendor indices share this
// doc shape (alert_title, evidence_filenames, prevention_action, portal_url,
// f0rtika.auto_resolved_at, gated on an enabled, error-free receipt).

import { fileVerdicts, isMultiTestAlert, isTestFile } from '../edr/multiTestEvidence.js';

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
  attributed_control_id?: string;
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
  if (!bundleUuid) return { attribution: 'bundle' };
  const escaped = bundleUuid.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stagePattern = new RegExp(`^${escaped}-([a-z0-9._-]+?)\\.exe$`, 'i');
  for (const fn of filenames) {
    const m = fn.match(stagePattern);
    if (m) return { attribution: 'stage', attributed_control_id: m[1].toLowerCase() };
  }
  return { attribution: 'bundle' };
}

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const optional = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));

/**
 * Attribution and prevention of an alert naming several Achilles tests: only
 * this test's files the vendor marked malicious count, each with its own
 * action (one file blocked, another only detected). None: 'multi_test'.
 */
function multiTestAttribution(
  source: Record<string, unknown>,
  bundleUuid: string,
): AlertAttribution & { prevention_action?: string } {
  const marked = (fileVerdicts(source) ?? []).filter((v) => v.verdict === 'malicious' && isTestFile(v.file, bundleUuid));
  if (marked.length === 0) return { attribution: 'multi_test' };
  for (const v of marked) {
    const a = classifyAttribution([v.file], bundleUuid);
    if (a.attribution === 'stage') return { ...a, ...(v.action ? { prevention_action: v.action } : {}) };
  }
  const action = marked.find((v) => v.action)?.action;
  return { attribution: 'bundle', ...(action ? { prevention_action: action } : {}) };
}

export function projectAlertHit(source: Record<string, unknown>, bundleUuid: string): ProjectedAlert {
  const f0 = (source.f0rtika ?? {}) as Record<string, unknown>;
  const multi = isMultiTestAlert(source) ? multiTestAttribution(source, bundleUuid) : null;
  const { attribution, attributed_control_id } = multi
    ?? classifyAttribution((source.evidence_filenames as string[] | undefined) ?? [], bundleUuid);
  // A multi-test alert shows only this test's file's own action.
  const prevention_action = multi ? multi.prevention_action : optional(source.prevention_action);
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
    ...(prevention_action ? { prevention_action } : {}),
    ...(portal_url ? { portal_url } : {}),
    ...(auto_resolved_at ? { auto_resolved_at } : {}),
  };
}
