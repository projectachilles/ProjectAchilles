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

// --- Defender (Graph Security API) ---

export interface DefenderSettingsMasked {
  configured: boolean;
  tenant_id?: string;
  client_id?: string;
  client_secret_set?: boolean;
  label?: string;
  env_configured?: boolean;
}

export interface SaveDefenderSettingsRequest {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  label?: string;
}

export interface TestDefenderResult {
  success: boolean;
  message?: string;
  error?: string;
}

// --- Defender Auto-Resolve (Wave 7) ---

export type AutoResolveMode = 'disabled' | 'dry_run' | 'enabled';

export interface AutoResolveStatus {
  mode: AutoResolveMode;
  counts: { last24h: number; last7d: number; last30d: number };
  lastAutoResolve: {
    mode: AutoResolveMode;
    candidates: number;
    patched: number;
    wouldPatch: number;
    skipped: number;
    errors: string[];
    durationMs: number;
  } | null;
}

export interface AutoResolveReceipt {
  alert_id: string;
  alert_title: string;
  severity: string;
  auto_resolved_at: string | null;
  auto_resolve_mode: AutoResolveMode | null;
  auto_resolve_error: string | null;
  achilles_test_uuid: string | null;
}

export interface AutoResolveReceiptsResponse {
  items: AutoResolveReceipt[];
  total: number;
  limit: number;
  offset: number;
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

  async deleteAzureSettings(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/integrations/azure');
    return response.data;
  },

  // --- Defender ---

  async getDefenderSettings(): Promise<DefenderSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/defender');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveDefenderSettings(settings: SaveDefenderSettingsRequest): Promise<{ success: boolean }> {
    const response = await apiClient.post('/integrations/defender', settings);
    return response.data;
  },

  async testDefenderConnection(settings: SaveDefenderSettingsRequest): Promise<TestDefenderResult> {
    const response = await apiClient.post('/integrations/defender/test', settings);
    return response.data;
  },

  async deleteDefenderSettings(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/integrations/defender');
    return response.data;
  },

  // --- Defender Auto-Resolve ---

  async getAutoResolveStatus(): Promise<AutoResolveStatus> {
    const response = await apiClient.get('/integrations/defender/auto-resolve/status');
    return response.data.data;
  },

  async setAutoResolveMode(mode: AutoResolveMode): Promise<{ mode: AutoResolveMode }> {
    const response = await apiClient.put('/integrations/defender/auto-resolve/mode', { mode });
    return response.data.data;
  },

  async getAutoResolveReceipts(limit = 20, offset = 0): Promise<AutoResolveReceiptsResponse> {
    const response = await apiClient.get(`/integrations/defender/auto-resolve/receipts?limit=${limit}&offset=${offset}`);
    return response.data.data;
  },
};
