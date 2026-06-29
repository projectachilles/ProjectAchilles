import { apiClient } from '@/hooks/useAuthenticatedApi';

export type AzureAuthMethod = 'client_secret' | 'certificate';

export interface AzureSettingsMasked {
  configured: boolean;
  tenant_id?: string;
  client_id?: string;
  auth_method?: AzureAuthMethod;
  client_secret_set?: boolean;
  cert_thumbprint_set?: boolean;
  label?: string;
  env_configured?: boolean;
}

export interface SaveAzureSettingsRequest {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  label?: string;
  auth_method?: AzureAuthMethod;
  cert_thumbprint?: string;
  private_key_pem?: string;
}

export interface TestAzureRequest {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  auth_method?: AzureAuthMethod;
  cert_thumbprint?: string;
  private_key_pem?: string;
}

export interface TestAzureResult {
  success: boolean;
  message?: string;
  error?: string;
}

// --- Defender (Graph Security API) ---

export type DefenderAuthMethod = 'client_secret' | 'certificate';

export interface DefenderSettingsMasked {
  configured: boolean;
  tenant_id?: string;
  client_id?: string;
  auth_method?: DefenderAuthMethod;
  client_secret_set?: boolean;
  cert_thumbprint_set?: boolean;
  label?: string;
  env_configured?: boolean;
}

export interface SaveDefenderSettingsRequest {
  tenant_id?: string;
  client_id?: string;
  // Secret auth
  client_secret?: string;
  label?: string;
  // Certificate auth
  auth_method?: DefenderAuthMethod;
  cert_thumbprint?: string;
  private_key_pem?: string;
}

export interface TestDefenderRequest {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  auth_method?: DefenderAuthMethod;
  cert_thumbprint?: string;
  private_key_pem?: string;
}

export interface TestDefenderResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ParsePfxResult {
  thumbprint: string;
  private_key_pem: string;
  subject_cn: string;
  not_after: string;
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

  async testAzureConnection(settings: TestAzureRequest): Promise<TestAzureResult> {
    const response = await apiClient.post('/integrations/azure/test', settings);
    return response.data;
  },

  async parsePfxForAzure(pfxFile: File, passphrase: string): Promise<ParsePfxResult> {
    const form = new FormData();
    form.append('pfx', pfxFile);
    form.append('passphrase', passphrase);
    const response = await apiClient.post('/integrations/azure/parse-pfx', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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

  async testDefenderConnection(settings: TestDefenderRequest): Promise<TestDefenderResult> {
    const response = await apiClient.post('/integrations/defender/test', settings);
    return response.data;
  },

  async parsePfx(pfxFile: File, passphrase: string): Promise<ParsePfxResult> {
    const form = new FormData();
    form.append('pfx', pfxFile);
    form.append('passphrase', passphrase);
    const response = await apiClient.post('/integrations/defender/parse-pfx', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.data;
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
