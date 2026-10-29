// Type definitions for CrowdStrike Falcon integration via the Falcon API.

import type { AutoResolveMode, EnrichmentPassOptions, EnrichmentPassResult, AutoResolvePassOptions, AutoResolvePassResult } from './defender.js';
import type { AgentKillPassResult } from './agent-kill.js';
import type { LaunchBlockPassResult } from './launch-block.js';

export type { AutoResolveMode, EnrichmentPassOptions, EnrichmentPassResult, AutoResolvePassOptions, AutoResolvePassResult };

/** Falcon cloud regions. The region is the ONLY determinant of the API base
 *  URL — resolved via CROWDSTRIKE_REGION_BASE_URLS in falcon-client.ts; no
 *  user-supplied URL ever reaches a fetch target (request-forgery guard). */
export type CrowdStrikeRegion = 'us-1' | 'us-2' | 'eu-1' | 'us-gov-1';

// ---------------------------------------------------------------------------
// Falcon API response shapes (only fields we consume)
// ---------------------------------------------------------------------------

/**
 * Alert resource from POST /alerts/combined/alerts/v1.
 * The legacy Detects API (/detects/*) was decommissioned 2025-09-30 —
 * do not use it.
 */
export interface FalconAlert {
  composite_id: string;
  /** CrowdStrike Customer ID — present on alert resources (MSSP tenants). */
  cid?: string;
  display_name?: string;
  name?: string;
  description?: string;
  /** Numeric severity 0–100. */
  severity?: number;
  /** Critical | High | Medium | Low | Informational. */
  severity_name?: string;
  status?: 'new' | 'in_progress' | 'reopened' | 'closed' | string;
  device?: { hostname?: string; device_id?: string };
  filename?: string;
  filepath?: string;
  technique?: string;
  technique_id?: string;
  tactic?: string;
  mitre_attack?: Array<{ technique_id?: string; technique?: string; tactic?: string }>;
  product?: string;
  scenario?: string;
  created_timestamp?: string;
  updated_timestamp?: string;
  /**
   * Structured prevention disposition (verified against the live Alerts API).
   * `pattern_disposition_details` carries boolean action flags; the derived
   * `prevention_action` on the ES doc follows the precedence in
   * docs/edr-prevention-action-detection.md (kill_action_failed →
   * quarantine_file → kill_* → *_blocked).
   */
  pattern_disposition?: number;
  pattern_disposition_description?: string;
  pattern_disposition_details?: {
    kill_process?: boolean;
    kill_parent?: boolean;
    kill_subprocess?: boolean;
    quarantine_file?: boolean;
    process_blocked?: boolean;
    operation_blocked?: boolean;
    fs_operation_blocked?: boolean;
    kill_action_failed?: boolean;
    [key: string]: unknown;
  };
  /** Exact per-alert Falcon console deep link. */
  falcon_host_link?: string;
}

/**
 * Per-device Zero Trust Assessment from
 * GET /zero-trust-assessment/entities/assessments/v1.
 * Requires the `Zero Trust Assessment: read` scope and Falcon Insight
 * licensing — a 403 here means "not licensed", not a broken credential.
 */
export interface FalconZtaAssessment {
  aid: string;
  cid?: string;
  assessment?: {
    overall?: number;
    os?: number;
    sensor_config?: number;
    modified_timestamp?: string;
  };
}

/**
 * CrowdStrike's write endpoints return HTTP 200 with per-item failures in
 * the response envelope (`errors[]`), plus `meta.writes.resources_affected`
 * for the success count. Callers MUST inspect both — HTTP status alone
 * is not authoritative.
 */
export interface PatchAlertsResult {
  /** Value of meta.writes.resources_affected. */
  resourcesAffected: number;
  /** Per-item errors from the response envelope (empty when fully successful). */
  errors: Array<{ code: number | string; id?: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Normalized ES document shapes
// ---------------------------------------------------------------------------

/**
 * Daily org-level ZTA snapshot (doc id `score-<YYYY-MM-DD>`), aggregated
 * from per-device assessments. CrowdStrike's Secure-Score equivalent.
 */
export interface CrowdStrikeZtaScoreDoc {
  doc_type: 'zta_score';
  timestamp: string;
  /** CrowdStrike Customer ID — the org discriminator (analog of Defender's tenant_id). */
  cid: string;
  /** Average of per-device assessment.overall across all devices. */
  overall_score: number;
  os_score: number;
  sensor_config_score: number;
  device_count: number;
  min_score: number;
  max_score: number;
}

export interface CrowdStrikeAlertDoc {
  doc_type: 'alert';
  timestamp: string;
  cid: string;
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
  /** Hostnames extracted from the alert's device.hostname. */
  evidence_hostnames: string[];
  /** Filenames extracted from the alert's root filename field. */
  evidence_filenames: string[];
  /**
   * Filepaths extracted from the alert's root filepath field.
   * Lowercased for case-insensitive substring wildcard matching. Recovers
   * correlations for alerts whose evidence carries a dropped-file path
   * under a bundle-named sandbox dir but no bundle-UUID binary in
   * evidence_filenames.
   */
  evidence_filepaths: string[];
  /**
   * Derived prevention action from pattern_disposition_details:
   * 'kill_failed' | 'quarantined' | 'process_killed' | 'blocked'.
   * Absent on detection-only alerts.
   */
  prevention_action?: string;
  /** Raw disposition bitmap value, for display/audit. */
  pattern_disposition?: number;
  /** Raw disposition description (e.g. "Prevention, process killed."). */
  pattern_disposition_description?: string;
  /** Per-alert Falcon console deep link (from falcon_host_link). */
  portal_url?: string;
  /** Achilles correlation + auto-resolve state. Populated by the enrichment
   *  pass (correlation fields) and by the auto-resolve pass (resolve fields).
   *  Vendor-neutral field names, identical to the Defender alert docs.
   *  All fields optional — legacy docs predate these pillars. */
  f0rtika?: {
    /** True when the enrichment pass matched this alert to an Achilles test doc. */
    achilles_correlated?: boolean;
    /** Bundle UUID of the matched Achilles test (the `::` suffix is stripped). */
    achilles_test_uuid?: string;
    /** ISO timestamp of when correlation was established. */
    achilles_matched_at?: string;
    /** True once the auto-resolve pass has processed this alert (in dry-run or enabled mode). */
    auto_resolved?: boolean;
    /** ISO timestamp of the auto-resolve action. */
    auto_resolved_at?: string;
    /** Mode under which the receipt was written — distinguishes dry-run from live PATCH. */
    auto_resolve_mode?: AutoResolveMode;
    /** Populated if the Falcon PATCH failed; keeps the doc visible for retry in the next pass. */
    auto_resolve_error?: string;
  };
}

// ---------------------------------------------------------------------------
// Sync result types
// ---------------------------------------------------------------------------

export interface SyncResult {
  synced: number;
  errors: string[];
}

export interface CrowdStrikeSyncResult {
  alerts: SyncResult;
  zta: SyncResult;
  enrichment: EnrichmentPassResult;
  /** EDR-killed agent runs reconciled after enrichment (all vendors' alert indices). */
  agentKill?: AgentKillPassResult;
  launchBlock?: LaunchBlockPassResult;
  autoResolve: AutoResolvePassResult;
  timestamp: string;
}

export interface CrowdStrikeSyncError {
  stage: 'alerts' | 'zta';
  message: string;
  at: string;
}

export type CrowdStrikeZtaStatus = 'ok' | 'not_licensed';

export interface CrowdStrikeSyncStatus {
  lastAlertSync: string | null;
  lastZtaSync: string | null;
  /** 'not_licensed' after a 403 from the ZTA API — the rest of the integration is unaffected. */
  ztaStatus: CrowdStrikeZtaStatus | null;
  lastSyncResult: CrowdStrikeSyncResult | null;
  /** When any stage last ran, successful or not. */
  lastAttemptAt: string | null;
  /** Most recent stage failure; cleared when that stage next succeeds. */
  lastError: CrowdStrikeSyncError | null;
}

// ---------------------------------------------------------------------------
// Detection correlation types
// ---------------------------------------------------------------------------

export interface DetectionRateTechniqueItem {
  technique: string;
  testExecutions: number;
  correlatedExecutions: number;
  detected: boolean;
}

export interface DetectionRateResponse {
  overall: {
    /** Per-execution rate: correlatedExecutions / totalExecutions, as a percentage. */
    detectionRate: number;
    totalExecutions: number;
    correlatedExecutions: number;
    /** Distinct techniques exercised — drill-down context, not the headline. */
    testedTechniques: number;
    detectedTechniques: number;
  };
  byTechnique: DetectionRateTechniqueItem[];
}

export interface RelatedAlertsResponse {
  alerts: Array<{
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
    /**
     * Whether this alert can be attributed to a specific stage of the bundle
     * (`'stage'`) or applies to the bundle as a whole because the evidence
     * shape doesn't discriminate (`'bundle'`). Driven by parsing the alert's
     * `evidence_filenames` for a `<bundle_uuid>-<technique>.exe` pattern: if
     * found, attribution is `'stage'` and `attributed_control_id` carries the
     * technique token (lowercased). Otherwise `'bundle'`.
     */
    attribution: 'stage' | 'bundle';
    /**
     * Lowercased technique token from a stage-attributable evidence binary
     * (e.g. `'t1211-cfapi'`). Frontend matches this case-insensitively
     * against `f0rtika.control_id` to render the alert under the correct
     * stage's drill-down. Undefined when `attribution === 'bundle'`.
     */
    attributed_control_id?: string;
    /** Vendor-confirmed prevention disposition (quarantined | process_killed | blocked | kill_failed). */
    prevention_action?: string;
    /** Deep link to the alert in the vendor console. */
    portal_url?: string;
    /**
     * Set only when ProjectAchilles resolved this alert in the vendor console: the
     * receipt is in enabled mode and carries no error. Dry-run receipts and failed
     * attempts leave it unset.
     */
    auto_resolved_at?: string;
  }>;
  matchedTechniques: string[];
  total: number;
}
