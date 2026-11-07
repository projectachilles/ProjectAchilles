// Type definitions for F0RT1KA security tests

export interface TestMetadata {
  uuid: string;
  name: string;
  category?: string;           // Category folder: cyber-hygiene, intel-driven, etc.
  subcategory?: string;        // More specific classification
  techniques: string[];        // MITRE ATT&CK techniques (T1xxx)
  tactics?: string[];          // MITRE ATT&CK tactics (TA00xx)
  target?: string[];            // Target platforms: windows-endpoint, linux-server, entra-id, etc.
  complexity?: string;         // Test complexity: low, medium, high
  threatActor?: string;        // Associated threat actor (if any)
  createdDate?: string;
  version?: string;
  author?: string;             // Test author
  unit?: string;               // Test unit identifier
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  validatorDescriptions?: Record<string, string>; // bundle tests: validator name → description
  isMultiStage: boolean;
  stages: StageInfo[];
  description?: string;
  tags?: string[];             // Additional tags for filtering
  integrations?: string[];     // Required integrations (e.g. 'azure')
  lastModifiedDate?: string;   // ISO 8601 date from Git history
  lastCommitMessage?: string;  // First line of last commit touching this test
  source?: 'upstream' | 'custom'; // 'upstream' (f0_library) or 'custom' (user-created)
  // Computed properties from API
  stageCount?: number;
  hasAttackFlow?: boolean;
  hasKillChain?: boolean;
  hasReadme?: boolean;
  hasInfoCard?: boolean;
  hasSafetyDoc?: boolean;
  hasDetectionFiles?: boolean;
  hasDefenseGuidance?: boolean;
  hasReferences?: boolean;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  commitHash: string | null;
  branch: string;
  status: 'synced' | 'syncing' | 'error' | 'never_synced';
  error?: string;
  testCount?: number;
}

export interface ScoreBreakdown {
  realWorldAccuracy?: number;
  technicalSophistication?: number;
  safetyMechanisms?: number;
  detectionOpportunities?: number;
  loggingObservability?: number;
}

export interface StageInfo {
  stageId: number;
  technique: string;
  /** Every technique the stage performs, `technique` first (backend may omit on older payloads). */
  techniques?: string[];
  name: string;
  fileName: string;
}

export interface TestFile {
  name: string;
  path: string;
  type: 'go' | 'powershell' | 'markdown' | 'html' | 'bash' | 'kql' | 'yara' | 'sigma' | 'ndjson' | 'yaml' | 'other';
  size: number;
  category: 'source' | 'documentation' | 'diagram' | 'config' | 'detection' | 'defense' | 'references' | 'other';
}

export interface TestOverview {
  expectedOutcomes?: { label: string; code?: number; text: string }[];
  safety?: string[];                    // ≤ 5 plain-text bullets
  safetySource?: string;                // file name to open for "Full safety →"
  quality?:
    | { rubric: 'v2.1'; realism: number; structure: number; validation?: string }
    | { rubric: 'legacy'; breakdown: ScoreBreakdown; validation?: string };
  detectionAudit?: { stage?: number; primitive: string; sensor: string; pattern: string }[];
  labStageOutcomes?: { stage: number; outcome: 'blocked' | 'ran' | 'error'; detail: string }[];
  primarySource?: { title: string; url?: string; publisher?: string; date?: string };
  stageBudgetsSec?: Record<number, number>;
}

export interface TestDetails extends TestMetadata {
  files: TestFile[];
  hasAttackFlow: boolean;
  attackFlowPath?: string;
  hasKillChain: boolean;
  killChainPath?: string;
  hasReadme: boolean;
  hasInfoCard: boolean;
  hasSafetyDoc: boolean;
  hasDetectionFiles: boolean;
  hasDefenseGuidance: boolean;
  hasReferences: boolean;
  overview?: TestOverview;
}

export interface FileContent {
  name: string;
  content: string;
  type: string;
  size?: number;
}

export type BuildJobStatus = 'running' | 'succeeded' | 'failed';

/** Latest build attempt for a test, tracked in memory by the backend. */
export interface BuildJob {
  status: BuildJobStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface BuildInfo {
  exists: boolean;
  platform?: { os: string; arch: string };
  detectedPlatform?: { os: string; arch: string };
  signed?: boolean;
  fileSize?: number;
  builtAt?: string;
  filename?: string;
  source?: 'built' | 'uploaded';
  job?: BuildJob;
}

export interface EmbedDependency {
  filename: string;
  sourceFile: string;
  exists: boolean;
  sourceBuilt: boolean;
}
