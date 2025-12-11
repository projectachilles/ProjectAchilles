import axios from 'axios';
import type { TestMetadata, TestDetails, FileContent, TestFile } from '@/types/test';

const api = axios.create({
  baseURL: '/api/browser',
  timeout: 10000,
});

export const browserApi = {
  // Get all tests
  async getAllTests(params?: {
    search?: string;
    technique?: string;
    category?: string;
    severity?: string;
  }): Promise<TestMetadata[]> {
    const response = await api.get('/tests', { params });
    // Backend returns: { success: true, count: number, tests: array }
    return response.data.tests || response.data;
  },

  // Get test details
  async getTestDetails(uuid: string): Promise<TestDetails> {
    const response = await api.get(`/tests/${uuid}`);
    // Backend returns: { success: true, test: object }
    return response.data.test || response.data;
  },

  // Get test files
  async getTestFiles(uuid: string) {
    const response = await api.get(`/tests/${uuid}/files`);
    // Backend returns: { success: true, files: array }
    return response.data.files || response.data;
  },

  // Get file content
  async getFileContent(uuid: string, filename: string): Promise<FileContent> {
    const response = await api.get(`/tests/${uuid}/file/${encodeURIComponent(filename)}`);
    // Backend returns: { success: true, file: { name, type, content, size } }
    return response.data.file || response.data;
  },

  // Get attack flow HTML
  async getAttackFlow(uuid: string): Promise<string> {
    const response = await api.get(`/tests/${uuid}/attack-flow`);
    // Backend returns: { success: true, html: string }
    return response.data.html || response.data;
  },

  // Refresh test index
  async refreshTests(): Promise<{ message: string; count: number }> {
    const response = await api.post('/tests/refresh');
    return response.data;
  },
};

// Re-export types for convenience
export type { TestMetadata, TestDetails, FileContent, TestFile };
