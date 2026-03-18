import { client } from './client.js';
import type { RiskAcceptance } from './types.js';

export async function acceptRisk(params: {
  test_name: string;
  control_id?: string;
  hostname?: string;
  justification: string;
}): Promise<RiskAcceptance> {
  return client.post('/api/analytics/risk-acceptances', { body: params });
}

export async function listRiskAcceptances(params: {
  status?: 'active' | 'revoked';
  test_name?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: RiskAcceptance[]; total: number }> {
  return client.get('/api/analytics/risk-acceptances', { params: params as Record<string, string | number | boolean | undefined> });
}

export async function getRiskAcceptance(id: string): Promise<RiskAcceptance> {
  return client.get(`/api/analytics/risk-acceptances/${id}`);
}

export async function revokeRiskAcceptance(id: string, reason: string): Promise<RiskAcceptance> {
  return client.post(`/api/analytics/risk-acceptances/${id}/revoke`, { body: { reason } });
}
