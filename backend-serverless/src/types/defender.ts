// Type definitions for Microsoft Defender integration via Microsoft Graph API.

// ---------------------------------------------------------------------------
// Microsoft Graph API response shapes (only fields we consume)
// ---------------------------------------------------------------------------

export interface GraphSecureScore {
  id: string;
  azureTenantId: string;
  createdDateTime: string;
  currentScore: number;
  maxScore: number;
  averageComparativeScores: Array<{ basis: string; averageScore: number }>;
  controlScores: Array<{
    controlName: string;
    controlCategory: string;
    score: number;
    description?: string;
  }>;
}

export interface GraphControlProfile {
  id: string;
  controlCategory: string;
  title: string;
  implementationCost: string;
  userImpact: string;
  rank: number;
  threats: string[];
  remediation: string;
  remediationImpact: string;
  actionUrl: string;
  maxScore: number;
  tier: string;
  deprecated: boolean;
}

export interface GraphAlertEvidence {
  '@odata.type': string;
  remediationStatus: string;
  verdict: string;
  deviceDnsName?: string;
  mdeDeviceId?: string;
  imageFile?: { fileName: string; filePath: string; sha256?: string };
  parentProcess?: { imageFile?: { fileName: string; filePath: string } };
  fileDetails?: { fileName: string; filePath: string; sha256?: string };
}

export interface GraphAlert {
  id: string;
  title: string;
  description: string;
  severity: 'unknown' | 'informational' | 'low' | 'medium' | 'high';
  status: 'new' | 'inProgress' | 'resolved' | 'unknownFutureValue';
  category: string;
  serviceSource: string;
  createdDateTime: string;
  lastUpdateDateTime: string;
  resolvedDateTime?: string;
  mitreTechniques: string[];
  recommendedActions: string;
  evidence: GraphAlertEvidence[];
}

/**
 * Subset of mutable fields Microsoft Graph accepts on a PATCH to
 * /security/alerts_v2/{id}. See backend/ for full rationale.
 *
 * NOTE: `comments` is intentionally NOT here. The alerts_v2 PATCH endpoint
 * silently drops it; comments must go through `addAlertComment()`.
 */
export interface GraphAlertPatch {
  status?: 'new' | 'inProgress' | 'resolved';
  classification?:
    | 'unknown'
    | 'falsePositive'
    | 'truePositive'
    | 'informationalExpectedActivity';
  determination?:
    | 'unknown'
    | 'apt'
    | 'malware'
    | 'securityPersonnel'
    | 'securityTesting'
    | 'unwantedSoftware'
    | 'other'
    | 'multiStagedAttack'
    | 'compromisedAccount'
    | 'phishing'
    | 'maliciousUserActivity'
    | 'notMalicious'
    | 'lineOfBusinessApplication';
}

// ---------------------------------------------------------------------------
// Normalized ES document shapes
// ---------------------------------------------------------------------------

export interface DefenderScoreDoc {
  doc_type: 'secure_score';
  timestamp: string;
  tenant_id: string;
  current_score: number;
  max_score: number;
  score_percentage: number;
  control_scores: Array<{
    name: string;
    category: string;
    score: number;
  }>;
  average_comparative_score: number | null;
}

export interface DefenderControlDoc {
  doc_type: 'control_profile';
  timestamp: string;
  tenant_id: string;
  control_name: string;
  control_category: string;
  title: string;
  implementation_cost: string;
  user_impact: string;
  rank: number;
  threats: string[];
  deprecated: boolean;
  remediation_summary: string;
  action_url: string;
  max_score: number;
  tier: string;
}

export interface DefenderAlertDoc {
  doc_type: 'alert';
  timestamp: string;
  tenant_id: string;
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
  /** Filepaths from evidence (lowercased). Issue #2 / Option B — see backend/ */
  evidence_filepaths: string[];
  /** Achilles correlation + auto-resolve state. See backend/ for field semantics. */
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

export interface SyncResult {
  synced: number;
  errors: string[];
}

export interface EnrichmentPassOptions {
  /** How far back to consider eligible test docs. Defaults to 90. */
  lookbackDays?: number;
  /** Test docs per msearch batch. Defaults to 200. */
  batchSize?: number;
  /** Hard cap on pass duration to avoid blocking the next sync. Defaults to 60000. */
  maxDurationMs?: number;
}

export interface EnrichmentPassResult {
  /** Eligible test docs examined. */
  scanned: number;
  /** Docs flipped to defender_detected:true in this pass. */
  detected: number;
  /** Docs skipped because the helper returned null (malformed input). */
  skipped: number;
  /** Number of msearch round-trips. */
  batches: number;
  /** Alerts tagged with f0rtika.achilles_correlated in this pass. */
  alertsMarkedCorrelated: number;
  /** Per-batch errors collected non-fatally. */
  errors: string[];
  /** Wall-clock duration of the pass. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Auto-resolve pillar
// ---------------------------------------------------------------------------

export type AutoResolveMode = 'disabled' | 'dry_run' | 'enabled';

export interface AutoResolvePassOptions {
  modeOverride?: AutoResolveMode;
  maxPerPass?: number;
  maxDurationMs?: number;
}

export interface AutoResolvePassResult {
  mode: AutoResolveMode;
  candidates: number;
  patched: number;
  wouldPatch: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

export interface DefenderSyncResult {
  scores: SyncResult;
  controls: SyncResult;
  alerts: SyncResult;
  enrichment: EnrichmentPassResult;
  autoResolve: AutoResolvePassResult;
  timestamp: string;
}

export interface DefenderSyncStatus {
  lastScoreSync: string | null;
  lastControlSync: string | null;
  lastAlertSync: string | null;
  lastSyncResult: DefenderSyncResult | null;
}
