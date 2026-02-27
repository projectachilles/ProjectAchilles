import { apiClient } from '@/hooks/useAuthenticatedApi';

export interface AzureSettingsMasked {
  configured: boolean;
  tenant_id?: string;
  client_id?: string;
  client_secret_set?: boolean;
  label?: string;
  env_configured?: boolean;
}

export interface SaveAzureSettingsRequest {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  label?: string;
}

export interface TestAzureResult {
  success: boolean;
  message?: string;
  error?: string;
}

export const integrationsApi = {
  async getAzureSettings(): Promise<AzureSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/azure');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveAzureSettings(settings: SaveAzureSettingsRequest): Promise<{ success: boolean }> {
    const response = await apiClient.post('/integrations/azure', settings);
    return response.data;
  },

  async testAzureConnection(settings: SaveAzureSettingsRequest): Promise<TestAzureResult> {
    const response = await apiClient.post('/integrations/azure/test', settings);
    return response.data;
  },
};
