import { apiClient } from '@/hooks/useAuthenticatedApi';

export interface AuthProviderMasked {
  configured: boolean;
  [key: string]: unknown;
}

export interface ProvidersListResponse {
  providers: string[];
}

export const authProvidersApi = {
  /** List all configured auth providers (public endpoint) */
  async getProviders(): Promise<ProvidersListResponse> {
    const { data } = await apiClient.get('/auth/providers');
    return data;
  },

  /** Get masked settings for a provider */
  async getSettings(provider: string): Promise<AuthProviderMasked> {
    const { data } = await apiClient.get(`/auth/providers/${provider}`);
    return data;
  },

  /** Save credentials for a provider */
  async save(provider: string, body: Record<string, string>): Promise<void> {
    await apiClient.post(`/auth/providers/${provider}`, body);
  },

  /** Test credentials for a provider */
  async test(provider: string, body: Record<string, string>): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.post(`/auth/providers/${provider}/test`, body);
    return data;
  },

  /** Delete a provider's credentials */
  async remove(provider: string): Promise<void> {
    await apiClient.delete(`/auth/providers/${provider}`);
  },
};
