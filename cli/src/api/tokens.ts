import { client } from './client.js';
import type { EnrollmentToken, CreateTokenRequest } from './types.js';

export async function createToken(params: CreateTokenRequest): Promise<EnrollmentToken> {
  return client.post('/api/agent/admin/tokens', { body: params });
}

export async function listTokens(orgId: string): Promise<EnrollmentToken[]> {
  return client.get('/api/agent/admin/tokens', { params: { org_id: orgId } });
}

export async function revokeToken(id: string): Promise<{ message: string }> {
  return client.delete(`/api/agent/admin/tokens/${id}`);
}
