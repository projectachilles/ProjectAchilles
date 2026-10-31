// Type definitions for CrowdStrike Falcon integration — Vercel serverless version.
// Mirror of backend/src/types/crowdstrike.ts; see backend/ for full field rationale.
//
// Detection-correlation response types (DetectionRateResponse,
// RelatedAlertsResponse) live in services/crowdstrike/analytics.service.ts,
// matching the fork's defender convention.

import type { AutoResolveMode, EnrichmentPassOptions, EnrichmentPassResult, AutoResolvePassOptions, AutoResolvePassResult, SyncResult } from './defender.js';

export type { AutoResolveMode, EnrichmentPassOptions, EnrichmentPassResult, AutoResolvePassOptions, AutoResolvePassResult, SyncResult };

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
/** One process in an alert's lineage (`parent_details` / `grandparent_details`). */
export interface FalconProcessDetails {
  filename?: string;
  filepath?: string;
  cmdline?: string;
  sha256?: string;
}

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
  /**
   * The triggering process's parent and grandparent (live Alerts API). A
   * behavioural alert usually fires on a Windows binary a test drove
   * (cmd.exe, powershell.exe); the test binary itself is one of these.
   */
  parent_details?: FalconProcessDetails;
  grandparent_details?: FalconProcessDetails;
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
   * Derived prevention_action precedence: kill_action_failed →
   * quarantine_file → kill_* → *_blocked (docs/edr-prevention-action-detection.md).
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

/** Daily org-level ZTA snapshot (doc id `score-<YYYY-MM-DD>`). */
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
  evidence_hostnames: string[];
  evidence_filenames: string[];
  /** Filepaths (lowercased) for substring matching — see backend/. */
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
  /** Achilles correlation + auto-resolve state. Vendor-neutral field names,
   *  identical to the Defender alert docs. See backend/ for field semantics. */
  f0rtika?: {
    achilles_correlated?: boolean;
    achilles_test_uuid?: string;
    achilles_matched_at?: string;
    auto_resolved?: boolean;
    auto_resolved_at?: string;
    auto_resolve_mode?: AutoResolveMode;
    auto_resolve_error?: string;
  };
}

// ---------------------------------------------------------------------------
// Sync result types
// ---------------------------------------------------------------------------

export interface CrowdStrikeSyncResult {
  alerts: SyncResult;
  zta: SyncResult;
  enrichment: EnrichmentPassResult;
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
