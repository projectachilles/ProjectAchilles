// Type definitions for F0RT1KA security tests

export interface TestMetadata {
  uuid: string;
  name: string;
  category?: string;           // Category folder: cyber-hygiene, intel-driven, etc.
  subcategory?: string;        // More specific classification
  severity?: string;           // critical, high, medium, low
  techniques: string[];        // MITRE ATT&CK techniques (T1xxx)
  tactics?: string[];          // MITRE ATT&CK tactics (TA00xx)
  target?: string;             // Target platform: windows-endpoint, linux-server, etc.
  complexity?: string;         // Test complexity: low, medium, high
  threatActor?: string;        // Associated threat actor (if any)
  createdDate?: string;
  version?: string;
  author?: string;             // Test author
  unit?: string;               // Test unit identifier
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  isMultiStage: boolean;
  stages: StageInfo[];
  description?: string;
  tags?: string[];             // Additional tags for filtering
  lastModifiedDate?: string;   // ISO 8601 date from Git history
  lastCommitMessage?: string;  // First line of last commit touching this test
  // Computed properties from API
  stageCount?: number;
  hasAttackFlow?: boolean;
  hasReadme?: boolean;
  hasInfoCard?: boolean;
  hasSafetyDoc?: boolean;
  hasDetectionFiles?: boolean;
  hasDefenseGuidance?: boolean;
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
  name: string;
  fileName: string;
}

export interface TestFile {
  name: string;
  path: string;
  type: 'go' | 'powershell' | 'markdown' | 'html' | 'bash' | 'kql' | 'yara' | 'yaml' | 'other';
  size: number;
  category: 'source' | 'documentation' | 'diagram' | 'config' | 'detection' | 'defense' | 'other';
}

export interface TestDetails extends TestMetadata {
  files: TestFile[];
  hasAttackFlow: boolean;
  attackFlowPath?: string;
  hasReadme: boolean;
  hasInfoCard: boolean;
  hasSafetyDoc: boolean;
  hasDetectionFiles: boolean;
  hasDefenseGuidance: boolean;
}

export interface FileContent {
  name: string;
  content: string;
  type: string;
  size?: number;
}

export interface BuildInfo {
  exists: boolean;
  platform?: { os: string; arch: string };
  signed?: boolean;
  fileSize?: number;
  builtAt?: string;
  filename?: string;
}

export interface EmbedDependency {
  filename: string;
  sourceFile: string;
  exists: boolean;
}
