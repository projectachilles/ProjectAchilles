import { apiClient } from '@/hooks/useAuthenticatedApi';
import type { EdrEsReadiness } from '@/services/api/edrReadiness';

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

// --- Defender sync ---

export interface DefenderSyncStageResult {
  synced: number;
  errors: string[];
}

export interface DefenderSyncRunResult {
  scores: DefenderSyncStageResult;
  controls: DefenderSyncStageResult;
  alerts: DefenderSyncStageResult;
  timestamp: string;
}

export interface DefenderSyncStatus {
  lastScoreSync: string | null;
  lastControlSync: string | null;
  lastAlertSync: string | null;
  lastAttemptAt?: string | null;
  lastError?: { stage: 'scores' | 'controls' | 'alerts'; message: string; at: string } | null;
}

// --- CrowdStrike Falcon ---

export type CrowdStrikeRegion = 'us-1' | 'us-2' | 'eu-1' | 'us-gov-1';

export type CrowdStrikeZtaStatus = 'ok' | 'not_licensed' | 'unknown';

export interface CrowdStrikeSettingsMasked {
  configured: boolean;
  /** Server-DERIVED from `region` (display-only) — the backend no longer
      accepts or stores a custom base URL; the Falcon client resolves URLs
      from a server-side region map. */
  base_url?: string;
  region?: CrowdStrikeRegion;
  client_id?: string;
  client_secret_set?: boolean;
  label?: string;
  env_configured?: boolean;
  zta_status?: CrowdStrikeZtaStatus | null;
}

export interface SaveCrowdStrikeSettingsRequest {
  region?: CrowdStrikeRegion;
  client_id?: string;
  client_secret?: string;
  label?: string;
}

export interface TestCrowdStrikeRequest {
  region?: CrowdStrikeRegion;
  client_id?: string;
  client_secret?: string;
}

export interface TestCrowdStrikeResult {
  success: boolean;
  message?: string;
  error?: string;
}

// --- CrowdStrike sync ---

export interface CrowdStrikeSyncStageResult {
  synced: number;
  errors: string[];
}

export interface CrowdStrikeSyncRunResult {
  alerts: CrowdStrikeSyncStageResult;
  zta: CrowdStrikeSyncStageResult;
  timestamp: string;
}

export interface CrowdStrikeSyncStatus {
  lastAlertSync: string | null;
  lastZtaSync: string | null;
  lastAttemptAt?: string | null;
  ztaStatus?: CrowdStrikeZtaStatus | null;
  lastError?: { stage: 'alerts' | 'zta'; message: string; at: string } | null;
}

// --- Auto-Resolve (shared by Defender and CrowdStrike) ---

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

  async saveDefenderSettings(settings: SaveDefenderSettingsRequest): Promise<{ success: boolean; elasticsearch?: EdrEsReadiness }> {
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

  // --- Defender sync ---

  async getDefenderSyncStatus(): Promise<DefenderSyncStatus> {
    const response = await apiClient.get('/integrations/defender/sync/status');
    return response.data;
  },

  async triggerDefenderSync(): Promise<DefenderSyncRunResult> {
    const response = await apiClient.post('/integrations/defender/sync');
    return response.data.data;
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

  // --- CrowdStrike ---

  async getCrowdStrikeSettings(): Promise<CrowdStrikeSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/crowdstrike');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveCrowdStrikeSettings(settings: SaveCrowdStrikeSettingsRequest): Promise<{ success: boolean; elasticsearch?: EdrEsReadiness }> {
    const response = await apiClient.post('/integrations/crowdstrike', settings);
    return response.data;
  },

  async testCrowdStrikeConnection(settings: TestCrowdStrikeRequest): Promise<TestCrowdStrikeResult> {
    const response = await apiClient.post('/integrations/crowdstrike/test', settings);
    return response.data;
  },

  async deleteCrowdStrikeSettings(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/integrations/crowdstrike');
    return response.data;
  },

  // --- CrowdStrike sync ---

  async getCrowdStrikeSyncStatus(): Promise<CrowdStrikeSyncStatus> {
    const response = await apiClient.get('/integrations/crowdstrike/sync/status');
    return response.data;
  },

  async triggerCrowdStrikeSync(): Promise<CrowdStrikeSyncRunResult> {
    const response = await apiClient.post('/integrations/crowdstrike/sync');
    return response.data.data;
  },

  // --- CrowdStrike Auto-Resolve ---

  async getCrowdStrikeAutoResolveStatus(): Promise<AutoResolveStatus> {
    const response = await apiClient.get('/integrations/crowdstrike/auto-resolve/status');
    return response.data.data;
  },

  async setCrowdStrikeAutoResolveMode(mode: AutoResolveMode): Promise<{ mode: AutoResolveMode }> {
    const response = await apiClient.put('/integrations/crowdstrike/auto-resolve/mode', { mode });
    return response.data.data;
  },

  async getCrowdStrikeAutoResolveReceipts(limit = 20, offset = 0): Promise<AutoResolveReceiptsResponse> {
    const response = await apiClient.get(`/integrations/crowdstrike/auto-resolve/receipts?limit=${limit}&offset=${offset}`);
    return response.data.data;
  },
};
