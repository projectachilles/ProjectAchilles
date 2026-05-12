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
  // deviceEvidence fields
  deviceDnsName?: string;
  mdeDeviceId?: string;
  // processEvidence fields
  imageFile?: { fileName: string; filePath: string; sha256?: string };
  parentProcess?: { imageFile?: { fileName: string; filePath: string } };
  // fileEvidence fields
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
 * /security/alerts_v2/{id}. Only fields we actually write are modelled;
 * Graph accepts more (e.g. assignedTo, feedback) that we don't use.
 *
 * - classification: SOC-analyst-facing label for the alert's truth value
 *   ('informationalExpectedActivity' is the correct choice for authorized
 *   test activity — it preserves the detection as real while flagging
 *   the activity itself as benign)
 * - determination: the category of threat (or lack thereof);
 *   'securityTesting' maps exactly to Achilles' use case
 *
 * NOTE: `comments` is intentionally NOT included here. The Graph
 * `alerts_v2` PATCH endpoint silently drops `comments` from the body
 * (the legacy `/security/alerts/{id}` endpoint accepted it; `alerts_v2`
 * does not). Comments must be sent via a separate POST to
 * `/security/alerts_v2/{id}/comments` — see `addAlertComment()` on
 * `MicrosoftGraphClient`.
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
  /** Hostnames extracted from evidence (deviceEvidence.deviceDnsName). */
  evidence_hostnames: string[];
  /** Filenames extracted from evidence (process imageFile + fileDetails). */
  evidence_filenames: string[];
  /**
   * Filepaths extracted from evidence (fileDetails.filePath + imageFile.filePath +
   * parentProcess.imageFile.filePath). Lowercased for case-insensitive substring
   * wildcard matching. Recovers correlations for AV-only alerts whose evidence
   * carries a dropped-file path under a bundle-named sandbox dir but no
   * bundle-UUID binary in evidence_filenames.
   */
  evidence_filepaths: string[];
  /** Achilles correlation + auto-resolve state. Populated by the enrichment
   *  pass (correlation fields) and by the auto-resolve pass (resolve fields).
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
    /** Populated if the Graph PATCH failed; keeps the doc visible for retry in the next pass. */
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
  /** Docs flipped to defender_detected:true in this pass (bundle-level match). */
  detected: number;
  /**
   * Docs flipped to defender_stage_detected:true in this pass — the stricter
   * stage-binary match. Subset of `detected` for new docs; can include
   * docs previously flagged at the bundle level that are now confirmed
   * stage-specific.
   */
  stageDetected: number;
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

/**
 * Operational mode for the Defender auto-resolve pass.
 * - `disabled`: feature off, no ES or Graph calls
 * - `dry_run`: compute candidates and write receipts, but do NOT PATCH Defender
 * - `enabled`: PATCH Defender alerts to status=resolved
 */
export type AutoResolveMode = 'disabled' | 'dry_run' | 'enabled';

export interface AutoResolvePassOptions {
  /** Override the mode from settings (primarily for tests). */
  modeOverride?: AutoResolveMode;
  /** Max alerts to PATCH per pass (rate-limit guard). Defaults to 30. */
  maxPerPass?: number;
  /** Hard cap on pass duration. Defaults to 30000. */
  maxDurationMs?: number;
}

export interface AutoResolvePassResult {
  /** Mode the pass ran under. */
  mode: AutoResolveMode;
  /** Correlated + unresolved + not-yet-auto-resolved alert docs considered. */
  candidates: number;
  /** Alerts actually PATCHed to Defender (0 in dry-run). */
  patched: number;
  /** Alerts that would have been PATCHed in dry-run. */
  wouldPatch: number;
  /** Candidates skipped (e.g., malformed correlation fields). */
  skipped: number;
  /** Error messages collected non-fatally. */
  errors: string[];
  /** Wall-clock duration of the pass. */
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

// ---------------------------------------------------------------------------
// Detection correlation types
// ---------------------------------------------------------------------------

export interface DetectionRateTechniqueItem {
  technique: string;
  testExecutions: number;
  correlatedAlerts: number;
  detected: boolean;
}

export interface DetectionRateResponse {
  overall: {
    testedTechniques: number;
    detectedTechniques: number;
    detectionRate: number;
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
  }>;
  matchedTechniques: string[];
  total: number;
}
