import { client } from './client.js';
import type { SecureScore, DefenderAlert, DefenderControl } from './types.js';

export async function getSecureScore(): Promise<SecureScore> {
  return client.get('/api/analytics/defender/secure-score');
}

export async function getSecureScoreTrend(days?: number): Promise<Array<{ timestamp: string; score: number }>> {
  return client.get('/api/analytics/defender/secure-score/trend', { params: { days } });
}

export async function getAlertsSummary(): Promise<{ total: number; byStatus: Record<string, number>; bySeverity: Record<string, number> }> {
  return client.get('/api/analytics/defender/alerts/summary');
}

export async function getAlerts(params: {
  page?: number;
  pageSize?: number;
  severity?: string;
  status?: string;
  search?: string;
  sortField?: string;
  sortOrder?: string;
} = {}): Promise<{ alerts: DefenderAlert[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
  return client.get('/api/analytics/defender/alerts', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getAlertsTrend(days?: number): Promise<Array<{ timestamp: string; count: number }>> {
  return client.get('/api/analytics/defender/alerts/trend', { params: { days } });
}

export async function getControls(params: { category?: string; deprecated?: boolean } = {}): Promise<DefenderControl[]> {
  return client.get('/api/analytics/defender/controls', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getControlsByCategory(): Promise<Record<string, DefenderControl[]>> {
  return client.get('/api/analytics/defender/controls/by-category');
}

export async function getScoreCorrelation(days?: number): Promise<Array<{ timestamp: string; defenseScore: number; secureScore: number }>> {
  return client.get('/api/analytics/defender/correlation/scores', { params: { days } });
}

export async function getTechniqueCorrelation(): Promise<{ techniques: Record<string, unknown>; coverage: unknown }> {
  return client.get('/api/analytics/defender/correlation/techniques');
}
