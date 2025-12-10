import axios from 'axios';

const api = axios.create({
  baseURL: '/api/analytics',
  timeout: 30000,
});

export interface AnalyticsSettings {
  configured: boolean;
  connectionType?: 'cloud' | 'direct';
  indexPattern?: string;
  cloudId?: string;
  node?: string;
}

export interface DefenseScore {
  score: number;
  protectedCount: number;
  unprotectedCount: number;
  totalExecutions: number;
}

export interface TrendDataPoint {
  timestamp: string;
  score: number;
  protectedCount: number;
  unprotectedCount: number;
}

export interface TestBreakdown {
  testUuid: string;
  testName: string;
  protectedCount: number;
  unprotectedCount: number;
  score: number;
}

export interface TechniqueBreakdown {
  technique: string;
  protectedCount: number;
  unprotectedCount: number;
  score: number;
}

export interface Execution {
  timestamp: string;
  testUuid: string;
  testName: string;
  hostname: string;
  outcome: string;
  error: number;
  organization?: string;
}

export interface ErrorTypeBreakdown {
  name: string;
  count: number;
}

export interface TestCoverageItem {
  name: string;
  protected: number;
  unprotected: number;
}

export interface TechniqueDistributionItem {
  technique: string;
  protected: number;
  unprotected: number;
}

export interface HostTestMatrixCell {
  hostname: string;
  testName: string;
  count: number;
}

export interface OrganizationInfo {
  uuid: string;
  shortName: string;
  fullName: string;
}

export const analyticsApi = {
  // Settings
  async getSettings(): Promise<AnalyticsSettings> {
    try {
      const response = await api.get('/settings');
      return response.data;
    } catch (error) {
      // If settings endpoint fails, return unconfigured state
      return { configured: false };
    }
  },

  async saveSettings(settings: {
    connectionType: 'cloud' | 'direct';
    cloudId?: string;
    apiKey?: string;
    node?: string;
    username?: string;
    password?: string;
    indexPattern?: string;
  }): Promise<{ success: boolean }> {
    const response = await api.post('/settings', settings);
    return response.data;
  },

  async testConnection(settings: {
    connectionType: 'cloud' | 'direct';
    cloudId?: string;
    apiKey?: string;
    node?: string;
    username?: string;
    password?: string;
  }): Promise<{ success: boolean; version?: string; error?: string }> {
    const response = await api.post('/settings/test', settings);
    return response.data;
  },

  // Analytics endpoints
  async getDefenseScore(params?: {
    org?: string;
    from?: string;
    to?: string;
  }): Promise<DefenseScore> {
    const response = await api.get('/defense-score', { params });
    return response.data;
  },

  async getDefenseScoreTrend(params?: {
    org?: string;
    from?: string;
    to?: string;
    interval?: 'hour' | 'day' | 'week';
  }): Promise<TrendDataPoint[]> {
    const response = await api.get('/defense-score/trend', { params });
    return response.data;
  },

  async getDefenseScoreByTest(params?: {
    org?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<TestBreakdown[]> {
    const response = await api.get('/defense-score/by-test', { params });
    return response.data;
  },

  async getDefenseScoreByTechnique(params?: {
    org?: string;
    from?: string;
    to?: string;
  }): Promise<TechniqueBreakdown[]> {
    const response = await api.get('/defense-score/by-technique', { params });
    return response.data;
  },

  async getRecentExecutions(params?: {
    org?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<Execution[]> {
    const response = await api.get('/executions', { params });
    return response.data;
  },

  async getOrganizations(): Promise<string[]> {
    const response = await api.get('/organizations');
    return response.data;
  },

  async getUniqueHostnames(params?: { org?: string }): Promise<number> {
    const response = await api.get('/unique-hostnames', { params });
    return response.data.count;
  },

  async getUniqueTests(params?: { org?: string }): Promise<number> {
    const response = await api.get('/unique-tests', { params });
    return response.data.count;
  },

  // New endpoints for advanced visualizations
  async getResultsByErrorType(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<ErrorTypeBreakdown[]> {
    const response = await api.get('/results-by-error-type', { params });
    return response.data;
  },

  async getTestCoverage(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<TestCoverageItem[]> {
    const response = await api.get('/test-coverage', { params });
    return response.data;
  },

  async getTechniqueDistribution(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<TechniqueDistributionItem[]> {
    const response = await api.get('/technique-distribution', { params });
    return response.data;
  },

  async getHostTestMatrix(params?: {
    org?: string;
    from?: string;
    to?: string;
    tests?: string;
    techniques?: string;
  }): Promise<HostTestMatrixCell[]> {
    const response = await api.get('/host-test-matrix', { params });
    return response.data;
  },

  async getAvailableTests(): Promise<string[]> {
    const response = await api.get('/available-tests');
    return response.data;
  },

  async getAvailableTechniques(): Promise<string[]> {
    const response = await api.get('/available-techniques');
    return response.data;
  },
};
