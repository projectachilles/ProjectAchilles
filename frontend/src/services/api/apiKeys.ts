import { apiClient } from '@/hooks/useAuthenticatedApi';

export type ApiKeyScope = 'read' | 'read-write';

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  scope: ApiKeyScope;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface GeneratedApiKey extends ApiKeyInfo {
  /** Full plaintext key — present only on the create response. */
  key: string;
}

export const apiKeysApi = {
  async list(): Promise<ApiKeyInfo[]> {
    const res = await apiClient.get<{ success: boolean; data: ApiKeyInfo[] }>('/api-keys');
    return res.data.data;
  },

  async create(
    name: string,
    scope: ApiKeyScope,
    expiresAt?: string,
  ): Promise<GeneratedApiKey> {
    const body: Record<string, unknown> = { name, scope };
    if (expiresAt) body.expires_at = expiresAt;
    const res = await apiClient.post<{ success: boolean; data: GeneratedApiKey }>(
      '/api-keys',
      body,
    );
    return res.data.data;
  },

  async revoke(id: string): Promise<void> {
    await apiClient.delete(`/api-keys/${id}`);
  },
};
