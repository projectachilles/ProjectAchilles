import axios from 'axios';

const api = axios.create({
  baseURL: '/api/browser',
  timeout: 10000,
});

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
  scoreBreakdown?: {
    realWorldAccuracy?: number;
    technicalSophistication?: number;
    safetyMechanisms?: number;
    detectionOpportunities?: number;
    loggingObservability?: number;
  };
  isMultiStage: boolean;
  stages?: Array<{
    id: string;
    name: string;
    technique: string;
  }>;
  description?: string;
  tags?: string[];
}

export interface TestFile {
  name: string;
  path: string;
  category: string;
  size: number;
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

export const browserApi = {
  // Get all tests
  async getAllTests(params?: {
    search?: string;
    technique?: string;
    category?: string;
    severity?: string;
  }): Promise<TestMetadata[]> {
    const response = await api.get('/tests', { params });
    return response.data;
  },

  // Get test details
  async getTestDetails(uuid: string): Promise<TestDetails> {
    const response = await api.get(`/tests/${uuid}`);
    return response.data;
  },

  // Get test files
  async getTestFiles(uuid: string): Promise<TestFile[]> {
    const response = await api.get(`/tests/${uuid}/files`);
    return response.data;
  },

  // Get file content
  async getFileContent(uuid: string, filename: string): Promise<string> {
    const response = await api.get(`/tests/${uuid}/file/${encodeURIComponent(filename)}`);
    return response.data;
  },

  // Get attack flow HTML
  async getAttackFlow(uuid: string): Promise<string> {
    const response = await api.get(`/tests/${uuid}/attack-flow`);
    return response.data;
  },

  // Refresh test index
  async refreshTests(): Promise<{ message: string; count: number }> {
    const response = await api.post('/tests/refresh');
    return response.data;
  },
};
