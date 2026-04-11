import { apiClient } from '@/hooks/useAuthenticatedApi';

export interface ApiKeyInfo {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
}

export const apikeysApi = {
  async list(): Promise<{ keys: ApiKeyInfo[] }> {
    const { data } = await apiClient.get('/apikeys');
    return data;
  },

  async generate(label: string): Promise<{ key: string } & ApiKeyInfo> {
    const { data } = await apiClient.post('/apikeys', { label });
    return data;
  },

  async revoke(id: string): Promise<void> {
    await apiClient.delete(`/apikeys/${id}`);
  },
};
