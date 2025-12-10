// Test metadata types

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

export interface TestMetadata {
  uuid: string;
  name: string;
  category?: string;
  severity?: string;
  techniques: string[];
  tactics?: string[];
  createdDate?: string;
  version?: string;
  score?: number;
  scoreBreakdown?: ScoreBreakdown;
  isMultiStage: boolean;
  stages: StageInfo[];
  description?: string;
  tags?: string[];
}

export interface TestFile {
  name: string;
  path: string;
  type: 'go' | 'powershell' | 'markdown' | 'html' | 'bash' | 'kql' | 'yara' | 'yaml' | 'other';
  size: number;
  category: 'source' | 'documentation' | 'diagram' | 'detection' | 'defense' | 'config' | 'other';
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
