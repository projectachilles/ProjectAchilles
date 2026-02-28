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
  evidence: Array<{ '@odata.type': string; remediationStatus: string; verdict: string }>;
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
}

// ---------------------------------------------------------------------------
// Sync result types
// ---------------------------------------------------------------------------

export interface SyncResult {
  synced: number;
  errors: string[];
}

export interface DefenderSyncResult {
  scores: SyncResult;
  controls: SyncResult;
  alerts: SyncResult;
  timestamp: string;
}

export interface DefenderSyncStatus {
  lastScoreSync: string | null;
  lastControlSync: string | null;
  lastAlertSync: string | null;
  lastSyncResult: DefenderSyncResult | null;
}
