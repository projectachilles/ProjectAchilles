import { client } from './client.js';
import type { TestEntry, TestDetails, SyncStatus } from './types.js';

export interface ListTestsParams {
  search?: string;
  technique?: string;
  category?: string;
  severity?: string;
}

export async function listTests(params: ListTestsParams = {}): Promise<{ count: number; tests: TestEntry[] }> {
  return client.get('/api/browser/tests', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getTest(uuid: string): Promise<TestDetails> {
  return client.get(`/api/browser/tests/${uuid}`);
}

export async function getTestDescription(uuid: string, validator?: string): Promise<{ description: string; hasInfoCard: boolean; hasReadme: boolean }> {
  return client.get(`/api/browser/tests/${uuid}/description`, { params: { validator } });
}

export async function getTestFile(uuid: string, filename: string): Promise<{ name: string; type: string; content: string; size: number }> {
  return client.get(`/api/browser/tests/${uuid}/file/${encodeURIComponent(filename)}`);
}

export async function syncTests(): Promise<{ message: string; syncStatus: SyncStatus; testCount: number }> {
  return client.post('/api/browser/tests/sync');
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return client.get('/api/browser/tests/sync/status');
}

export async function getCategories(): Promise<string[]> {
  return client.get('/api/browser/tests/categories');
}

export async function refreshTests(): Promise<{ message: string; count: number }> {
  return client.post('/api/browser/tests/refresh');
}
