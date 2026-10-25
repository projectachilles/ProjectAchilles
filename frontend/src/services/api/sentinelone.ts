import { apiClient } from '@/hooks/useAuthenticatedApi';

export type SentinelOnePermissionMode = 'read_only' | 'response';
export type SentinelOneSource = 'threats' | 'cloud_detection_alerts';
export type SentinelOneSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational' | 'unknown';
export type SentinelOneIncidentStatus = 'unresolved' | 'in_progress' | 'resolved';

export interface SentinelOneScope {
  account_ids?: string[];
  site_ids?: string[];
  group_ids?: string[];
}

export interface SentinelOneFilters {
  severities?: SentinelOneSeverity[];
  incident_statuses?: SentinelOneIncidentStatus[];
}

export interface SentinelOneSettingsMasked {
  configured: boolean;
  env_configured?: boolean;
  base_url?: string;
  label?: string;
  api_token_set?: boolean;
  permission_mode?: SentinelOnePermissionMode;
  poll_interval_minutes?: number;
  backfill_days?: number;
  sources?: SentinelOneSource[];
  scope?: SentinelOneScope;
  filters?: SentinelOneFilters;
  auto_resolve_mode?: SentinelOneAutoMode;
  auto_mitigation?: SentinelOneAutoMitigationSettings;
}

/** Same three states as Defender auto-resolve. */
export type SentinelOneAutoMode = 'disabled' | 'dry_run' | 'enabled';
export type SentinelOneAutoMitigationAction = 'kill' | 'quarantine';

export interface SentinelOneAutoMitigationSettings {
  mode: SentinelOneAutoMode;
  action: SentinelOneAutoMitigationAction;
}

export interface SentinelOneReceiptCounts { last24h: number; last7d: number; last30d: number }

export interface SentinelOneAutoResolveStatus {
  mode: SentinelOneAutoMode;
  permission_mode: SentinelOnePermissionMode;
  counts: SentinelOneReceiptCounts;
  lastAutoResolve: { mode: SentinelOneAutoMode; candidates: number; patched: number; wouldPatch: number; errors: string[] } | null;
}

export interface SentinelOneAutoMitigationStatus extends SentinelOneAutoMitigationSettings {
  permission_mode: SentinelOnePermissionMode;
  counts: SentinelOneReceiptCounts;
  lastAutoMitigation: { mode: SentinelOneAutoMode; action: SentinelOneAutoMitigationAction; candidates: number; mitigated: number; wouldMitigate: number; errors: string[] } | null;
}

export interface SentinelOneReceipt {
  alert_id: string;
  alert_title: string;
  severity: string;
  source_type: SentinelOneSource | null;
  achilles_test_uuid: string | null;
  auto_resolved_at?: string | null;
  auto_resolve_mode?: SentinelOneAutoMode | null;
  auto_resolve_error?: string | null;
  auto_mitigated_at?: string | null;
  auto_mitigation_mode?: SentinelOneAutoMode | null;
  auto_mitigation_action?: SentinelOneAutoMitigationAction | null;
  auto_mitigation_error?: string | null;
}

export interface SentinelOneReceiptPage { items: SentinelOneReceipt[]; total: number; limit: number; offset: number }

export interface SaveSentinelOneSettingsRequest {
  base_url?: string;
  api_token?: string;
  label?: string;
  permission_mode?: SentinelOnePermissionMode;
  poll_interval_minutes?: number;
  backfill_days?: number;
  sources?: SentinelOneSource[];
  scope?: SentinelOneScope;
  filters?: SentinelOneFilters;
}

export interface SentinelOneSourceSyncResult {
  fetched: number;
  synced: number;
  filtered: number;
  errors: string[];
}

export interface SentinelOneSyncStatus {
  lastThreatSync: string | null;
  lastAlertSync: string | null;
  lastAttemptAt: string | null;
  inProgress: boolean;
  lastError: { stage: string; message: string; at: string } | null;
  lastSyncResult: {
    timestamp: string;
    threats?: SentinelOneSourceSyncResult;
    cloud_detection_alerts?: SentinelOneSourceSyncResult;
  } | null;
}

export interface SentinelOneAuditRecord {
  timestamp: string;
  action_kind: 'threat_mitigation';
  action: string;
  target_ids: string[];
  requested_by: string;
  permission_mode: SentinelOnePermissionMode;
  outcome: 'success' | 'rejected' | 'failed';
  affected?: number;
  error?: string;
}

export const sentinelOneApi = {
  async getSettings(): Promise<SentinelOneSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/sentinelone');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveSettings(settings: SaveSentinelOneSettingsRequest): Promise<{ success: boolean }> {
    const response = await apiClient.post('/integrations/sentinelone', settings);
    return response.data;
  },

  async testConnection(req: { base_url?: string; api_token?: string; scope?: SentinelOneScope }): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await apiClient.post('/integrations/sentinelone/test', req);
    return response.data;
  },

  async deleteSettings(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/integrations/sentinelone');
    return response.data;
  },

  /** Starts a sync in the background (202); poll getSyncStatus() until inProgress is false. */
  async triggerSync(reset = false): Promise<{ started: boolean; inProgress: boolean }> {
    const response = await apiClient.post('/integrations/sentinelone/sync', { reset });
    return response.data.data;
  },

  async getSyncStatus(): Promise<SentinelOneSyncStatus> {
    const response = await apiClient.get('/integrations/sentinelone/sync/status');
    return response.data;
  },

  /**
   * Poll /sync/status until the background sync started by triggerSync()
   * finishes (a backfill can take minutes). Resolves with the last status,
   * or null when `isCancelled()` turns true (e.g. the component unmounted).
   */
  async waitForSync(opts: { intervalMs?: number; maxMs?: number; isCancelled?: () => boolean; onStatus?: (s: SentinelOneSyncStatus) => void } = {}): Promise<SentinelOneSyncStatus | null> {
    const { intervalMs = 3000, maxMs = 30 * 60_000, isCancelled = () => false, onStatus } = opts;
    const deadline = Date.now() + maxMs;
    let status: SentinelOneSyncStatus | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (isCancelled()) return null;
      status = await sentinelOneApi.getSyncStatus();
      if (isCancelled()) return null;
      onStatus?.(status);
      if (!status.inProgress) break;
    }
    return status;
  },

  async getAutoResolveStatus(): Promise<SentinelOneAutoResolveStatus> {
    const response = await apiClient.get('/integrations/sentinelone/auto-resolve/status');
    return response.data.data;
  },

  async setAutoResolveMode(mode: SentinelOneAutoMode): Promise<{ mode: SentinelOneAutoMode }> {
    const response = await apiClient.put('/integrations/sentinelone/auto-resolve/mode', { mode });
    return response.data.data;
  },

  async getAutoResolveReceipts(limit = 20, offset = 0): Promise<SentinelOneReceiptPage> {
    const response = await apiClient.get('/integrations/sentinelone/auto-resolve/receipts', { params: { limit, offset } });
    return response.data.data;
  },

  async getAutoMitigationStatus(): Promise<SentinelOneAutoMitigationStatus> {
    const response = await apiClient.get('/integrations/sentinelone/auto-mitigation/status');
    return response.data.data;
  },

  async setAutoMitigation(update: Partial<SentinelOneAutoMitigationSettings>): Promise<SentinelOneAutoMitigationSettings> {
    const response = await apiClient.put('/integrations/sentinelone/auto-mitigation', update);
    return response.data.data;
  },

  async getAutoMitigationReceipts(limit = 20, offset = 0): Promise<SentinelOneReceiptPage> {
    const response = await apiClient.get('/integrations/sentinelone/auto-mitigation/receipts', { params: { limit, offset } });
    return response.data.data;
  },

  async getActionHistory(limit = 20): Promise<SentinelOneAuditRecord[]> {
    const response = await apiClient.get('/integrations/sentinelone/actions/history', { params: { limit } });
    return response.data.data;
  },
};
