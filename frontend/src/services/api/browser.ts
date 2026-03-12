import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { TestMetadata, TestDetails, FileContent, TestFile, SyncStatus, BuildInfo } from '@/types/test';

export interface SyncResult {
  success: boolean;
  message: string;
  syncStatus: SyncStatus;
  testCount: number;
}

export const browserApi = {
  // Get all tests
  async getAllTests(params?: {
    search?: string;
    technique?: string;
    category?: string;
    severity?: string;
  }): Promise<TestMetadata[]> {
    const response = await apiClient.get('/browser/tests', { params });
    // Backend returns: { success: true, count: number, tests: array }
    const tests = response.data?.tests;
    if (!Array.isArray(tests)) {
      throw new Error(response.data?.error || 'Invalid response: expected tests array');
    }
    return tests;
  },

  // Get all unique categories
  async getCategories(): Promise<string[]> {
    const response = await apiClient.get('/browser/tests/categories');
    return response.data.categories;
  },

  // Trigger sync from GitHub repository
  async syncTests(): Promise<SyncResult> {
    const response = await apiClient.post('/browser/tests/sync');
    return response.data;
  },

  // Get current sync status
  async getSyncStatus(): Promise<SyncStatus> {
    const response = await apiClient.get('/browser/tests/sync/status');
    return response.data.syncStatus;
  },

  // Get test details
  async getTestDetails(uuid: string): Promise<TestDetails> {
    const response = await apiClient.get(`/browser/tests/${uuid}`);
    // Backend returns: { success: true, test: object }
    return response.data.test;
  },

  // Get test files
  async getTestFiles(uuid: string) {
    const response = await apiClient.get(`/browser/tests/${uuid}/files`);
    // Backend returns: { success: true, files: array }
    return response.data.files;
  },

  // Get file content
  async getFileContent(uuid: string, filename: string): Promise<FileContent> {
    const response = await apiClient.get(`/browser/tests/${uuid}/file/${encodeURIComponent(filename)}`);
    // Backend returns: { success: true, file: { name, type, content, size } }
    return response.data.file;
  },

  // Get attack flow HTML
  async getAttackFlow(uuid: string): Promise<string> {
    const response = await apiClient.get(`/browser/tests/${uuid}/attack-flow`);
    // Backend returns: { success: true, html: string }
    return response.data.html;
  },

  // Get kill chain diagram HTML
  async getKillChain(uuid: string): Promise<string> {
    const response = await apiClient.get(`/browser/tests/${uuid}/kill-chain`);
    return response.data.html;
  },

  // Get test description (standalone or bundle validator)
  async getTestDescription(uuid: string, validator?: string): Promise<{
    description: string | null;
    hasInfoCard: boolean;
    hasReadme: boolean;
  } | null> {
    const params = validator ? { validator } : undefined;
    const response = await apiClient.get(`/browser/tests/${uuid}/description`, { params });
    const data = response.data?.data;
    if (!data) return null;
    return {
      description: data.description ?? null,
      hasInfoCard: !!data.hasInfoCard,
      hasReadme: !!data.hasReadme,
    };
  },

  // Get build info for a test
  async getBuildInfo(uuid: string): Promise<BuildInfo> {
    const response = await apiClient.get(`/tests/builds/${uuid}`);
    return response.data.data;
  },

  // Refresh test index
  async refreshTests(): Promise<{ message: string; count: number }> {
    const response = await apiClient.post('/browser/tests/refresh');
    return response.data;
  },
};

// Re-export types for convenience
export type { TestMetadata, TestDetails, FileContent, TestFile, SyncStatus, BuildInfo };
