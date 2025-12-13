import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { TestMetadata, TestDetails, FileContent, TestFile } from '@/types/test';

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
    return response.data.tests;
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

  // Refresh test index
  async refreshTests(): Promise<{ message: string; count: number }> {
    const response = await apiClient.post('/browser/tests/refresh');
    return response.data;
  },
};

// Re-export types for convenience
export type { TestMetadata, TestDetails, FileContent, TestFile };
