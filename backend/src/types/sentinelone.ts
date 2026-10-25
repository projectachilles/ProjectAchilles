// SentinelOne Singularity integration types.
// API reference: Management Console API v2.1 (`/web/api/v2.1/*`), auth header
// `Authorization: ApiToken <token>`.

import type { AutoResolveMode, AutoResolvePassResult, EnrichmentPassResult } from './defender.js';

export type { AutoResolveMode };

/**
 * Permission mode for a SentinelOne integration.
 *  - read_only: only GET extraction of threats/alerts. Every non-GET request
 *    is refused by the client itself (server-side), not just hidden in the UI.
 *  - response:  read_only + the writes of the opt-in auto-resolve (incident
 *    status / notes) and automatic-mitigation (kill / quarantine) passes.
 */
export type SentinelOnePermissionMode = 'read_only' | 'response';

/** Data sources the poller can pull. */
export type SentinelOneSource = 'threats' | 'cloud_detection_alerts';

/**
 * Actions automatic mitigation may take (POST /threats/mitigate/{action}).
 * Only the two that act on the detected binary / process: remediate, rollback
 * and network isolation change host state well beyond the test artefact and
 * are not exposed by this integration.
 */
export type SentinelOneAutoMitigationAction = 'kill' | 'quarantine';

/** Opt-in automatic mitigation of unmitigated threats matched to Achilles tests. */
export interface SentinelOneAutoMitigationSettings {
  /** disabled (default) | dry_run (log + receipts only) | enabled (calls /threats/mitigate). */
  mode: AutoResolveMode;
  action: SentinelOneAutoMitigationAction;
}

export type SentinelOneResponseAction = { kind: 'threat_mitigation'; action: SentinelOneAutoMitigationAction; threatIds: string[] };

/** Normalized severity — same vocabulary as the Defender/CrowdStrike alert docs. */
export type SentinelOneSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational' | 'unknown';

/** Segmentation applied to what is pulled. */
export interface SentinelOneScope {
  account_ids?: string[];
  site_ids?: string[];
  group_ids?: string[];
}

export interface SentinelOneFilters {
  /** Only keep alerts with these normalized severities (empty/undefined = all). */
  severities?: SentinelOneSeverity[];
  /** Only keep alerts whose incident status is one of these (e.g. unresolved, in_progress, resolved). */
  incident_statuses?: string[];
}

/** Persisted settings (api_token stored AES-256-GCM encrypted as `enc:...`). */
export interface SentinelOneIntegrationSettings {
  /** Console base URL, e.g. https://<tenant>.sentinelone.net (no trailing slash/path). */
  base_url: string;
  api_token: string;
  configured: boolean;
  label?: string;
  permission_mode?: SentinelOnePermissionMode;
  /** Polling interval in minutes (1..1440, default 5). */
  poll_interval_minutes?: number;
  /** Initial backfill window in days (1..365, default 365 = console retention). */
  backfill_days?: number;
  sources?: SentinelOneSource[];
  scope?: SentinelOneScope;
  filters?: SentinelOneFilters;
  /** Incremental sync checkpoints (ISO timestamps), one per source. */
  last_threat_sync?: string;
  last_alert_sync?: string;
  sync_version?: number;
  /** Auto-resolve of alerts matched to Achilles tests (default 'disabled', like Defender). */
  auto_resolve_mode?: AutoResolveMode;
  /** Automatic mitigation — default { mode: 'disabled', action: 'kill' }; non-disabled requires Response mode. */
  auto_mitigation?: SentinelOneAutoMitigationSettings;
  /** Last posture pass (exclusions, policies, agents) — ISO timestamp. */
  last_posture_sync?: string;
}

/** Sync checkpoints (never credentials). */
export interface SentinelOneSyncCheckpoints {
  last_threat_sync?: string;
  last_alert_sync?: string;
  sync_version?: number;
  last_posture_sync?: string;
}

/**
 * Standalone `sentinelone_sync` key in integrations.json, used when the
 * credentials come from env vars so the file never holds a section that would
 * shadow them: checkpoints plus the non-secret automation toggles.
 */
export interface SentinelOneSyncState extends SentinelOneSyncCheckpoints {
  auto_resolve_mode?: AutoResolveMode;
  auto_mitigation?: SentinelOneAutoMitigationSettings;
}

/** Raw credentials handed to the client. */
export interface SentinelOneCredentials {
  base_url: string;
  api_token: string;
  permission_mode: SentinelOnePermissionMode;
}

/** Masked view for API responses — never includes the token. */
export interface SentinelOneSettingsMasked {
  configured: boolean;
  env_configured: boolean;
  base_url?: string;
  label?: string;
  api_token_set?: boolean;
  permission_mode?: SentinelOnePermissionMode;
  poll_interval_minutes?: number;
  backfill_days?: number;
  sources?: SentinelOneSource[];
  scope?: SentinelOneScope;
  filters?: SentinelOneFilters;
  auto_resolve_mode?: AutoResolveMode;
  auto_mitigation?: SentinelOneAutoMitigationSettings;
}

// ---------------------------------------------------------------------------
// Raw API shapes (only the fields we read; the API returns many more)
// ---------------------------------------------------------------------------

export interface S1Pagination {
  nextCursor?: string | null;
  totalItems?: number;
}

export interface S1ListResponse<T> {
  data?: T[];
  pagination?: S1Pagination;
  errors?: Array<{ code?: number; detail?: string; title?: string }>;
}

export interface S1Threat {
  id: string;
  threatInfo?: {
    threatId?: string;
    threatName?: string;
    classification?: string;
    confidenceLevel?: string; // malicious | suspicious | n/a
    analystVerdict?: string;
    incidentStatus?: string; // unresolved | in_progress | resolved
    mitigationStatus?: string; // mitigated | not_mitigated | marked_as_benign ...
    mitigationStatusDescription?: string;
    storyline?: string;
    filePath?: string;
    fileDisplayName?: string;
    sha1?: string;
    sha256?: string;
    md5?: string;
    originatorProcess?: string;
    createdAt?: string;
    updatedAt?: string;
    identifiedAt?: string;
    detectionType?: string;
    engines?: string[];
  };
  agentDetectionInfo?: {
    accountId?: string;
    accountName?: string;
    siteId?: string;
    siteName?: string;
    groupId?: string;
    groupName?: string;
    agentOsName?: string;
  };
  agentRealtimeInfo?: {
    agentId?: string;
    agentComputerName?: string;
    agentOsType?: string;
    agentNetworkStatus?: string;
    accountId?: string;
    siteId?: string;
    groupId?: string;
  };
  indicators?: Array<{
    category?: string;
    description?: string;
    tactics?: Array<{ name?: string; source?: string; techniques?: Array<{ name?: string; link?: string }> }>;
  }>;
  mitigationStatus?: Array<{ action?: string; status?: string; lastUpdate?: string; mitigationStartedAt?: string; mitigationEndedAt?: string }>;
}

export interface S1CloudDetectionAlert {
  alertInfo?: {
    alertId?: string;
    analystVerdict?: string;
    incidentStatus?: string;
    createdAt?: string;
    updatedAt?: string;
    reportedAt?: string;
    eventType?: string;
    source?: string;
    hitType?: string;
    dvEventId?: string;
  };
  ruleInfo?: {
    id?: string;
    name?: string;
    description?: string;
    severity?: string; // Critical | High | Medium | Low | Info
    treatAsThreat?: string;
    scopeLevel?: string;
  };
  agentDetectionInfo?: {
    accountId?: string;
    siteId?: string;
    groupId?: string;
    name?: string;
    uuid?: string;
    machineType?: string;
    osName?: string;
  };
  agentRealtimeInfo?: { id?: string; os?: string };
  sourceProcessInfo?: {
    name?: string;
    filePath?: string;
    storyline?: string;
    fileHashSha1?: string;
    fileHashSha256?: string;
    commandline?: string;
  };
  targetProcessInfo?: {
    tgtFilePath?: string;
    tgtProcName?: string;
    tgtProcImagePath?: string;
  };
  // Field names follow the SentinelOne alert field reference (Google SecOps
  // SENTINELONE_ALERT parser). Detection alerts carry no structured MITRE
  // field: techniques come from the rule name / description.
  containerInfo?: Record<string, unknown>;
  kubernetesInfo?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Normalized ES doc (index achilles-sentinelone)
// Mirrors the alert doc shape used by achilles-defender / achilles-crowdstrike
// (alert_id, alert_title, severity, status, mitre_techniques, evidence_*), so
// other modules can consume it the same way.
// ---------------------------------------------------------------------------

export interface SentinelOneAlertDoc {
  doc_type: 'alert';
  source_type: SentinelOneSource;
  /** Date fields are null when S1 omits them ('' is rejected by the ES date mapping). */
  timestamp: string | null;
  alert_id: string;
  alert_title: string;
  description: string;
  severity: SentinelOneSeverity;
  status: string;
  category: string;
  service_source: 'SentinelOne';
  mitre_techniques: string[];
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  recommended_actions: string;
  evidence_hostnames: string[];
  evidence_filenames: string[];
  evidence_filepaths: string[];
  account_id?: string;
  site_id?: string;
  group_id?: string;
  agent_id?: string;
  storyline_id?: string;
  threat_id?: string;
  confidence_level?: string;
  classification?: string;
  analyst_verdict?: string;
  mitigation_status?: string;
  prevention_action?: string;
  sha1?: string;
  sha256?: string;
  portal_url?: string;
}

/** Audit record for a response action (doc_type 'response_action'). */
export interface SentinelOneResponseAuditDoc {
  doc_type: 'response_action';
  timestamp: string;
  action_kind: SentinelOneResponseAction['kind'];
  action: string;
  target_ids: string[];
  requested_by: string;
  org_id?: string;
  permission_mode: SentinelOnePermissionMode;
  outcome: 'success' | 'rejected' | 'failed';
  affected?: number;
  error?: string;
}

/** Result of an automatic-mitigation pass (mirrors AutoResolvePassResult). */
export interface AutoMitigationPassResult {
  mode: AutoResolveMode;
  action: SentinelOneAutoMitigationAction;
  candidates: number;
  mitigated: number;
  wouldMitigate: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

/** Result of the posture pass (exclusions, policies, agent inventory + health). */
export interface SentinelOnePosturePassResult {
  exclusions: number;
  policies: number;
  agents: number;
  agentHealth: SentinelOneAgentHealthCounts | null;
  errors: string[];
  durationMs: number;
}

/** Agent counts from GET /agents/count (null = that count failed). */
export interface SentinelOneAgentHealthCounts {
  total: number | null;
  active: number | null;
  infected: number | null;
  outdated: number | null;
  detect_only: number | null;
  disconnected: number | null;
}

export interface SentinelOneSourceSyncResult {
  fetched: number;
  synced: number;
  filtered: number;
  errors: string[];
}

export interface SentinelOneSyncResult {
  /** The console or scope changed mid-run: nothing was checkpointed, a fresh sync follows. */
  scopeChanged?: boolean;
  threats?: SentinelOneSourceSyncResult;
  cloud_detection_alerts?: SentinelOneSourceSyncResult;
  /** Correlation pass run after the poll (f0rtika.sentinelone_* flags on results). */
  enrichment?: EnrichmentPassResult;
  autoMitigation?: AutoMitigationPassResult;
  autoResolve?: AutoResolvePassResult;
  posture?: SentinelOnePosturePassResult;
  timestamp: string;
}

export interface SentinelOneSyncStatus {
  lastThreatSync: string | null;
  lastAlertSync: string | null;
  lastSyncResult: SentinelOneSyncResult | null;
  lastAttemptAt: string | null;
  lastError: { stage: SentinelOneSource; message: string; at: string } | null;
  inProgress: boolean;
}
