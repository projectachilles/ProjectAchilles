import { apiClient } from '@/hooks/useAuthenticatedApi';

export type SophosPermissionMode = 'read_only' | 'response';
export type SophosCapabilityState = 'available' | 'not_licensed' | 'forbidden' | 'unknown';
export type SophosAutoMode = 'disabled' | 'dry_run' | 'enabled';
export type SophosSourceType = 'alert' | 'xdr_detection' | 'siem_event';

export interface SophosCapabilities {
  siem: SophosCapabilityState;
  alerts: SophosCapabilityState;
  xdr_graphql: SophosCapabilityState;
  xdr_rest: SophosCapabilityState;
  health_check: SophosCapabilityState;
}

/** Window the SIEM feed could not cover (Sophos keeps 24 hours). */
export interface SophosSyncGap { from: string; to: string }

export interface SophosSettingsMasked {
  configured: boolean;
  env_configured?: boolean;
  client_id?: string;
  label?: string;
  client_secret_set?: boolean;
  permission_mode?: SophosPermissionMode;
  poll_interval_minutes?: number;
  detection_backfill_days?: number;
  tenant_id?: string;
  data_region?: string;
  capabilities?: SophosCapabilities;
  last_auth_ok_at?: string;
  auto_resolve_mode?: SophosAutoMode;
  sync_gap?: SophosSyncGap | null;
}

export interface SaveSophosSettingsRequest {
  client_id?: string;
  client_secret?: string;
  label?: string;
  permission_mode?: SophosPermissionMode;
  poll_interval_minutes?: number;
  detection_backfill_days?: number;
}

export type SophosTestResult =
  | { success: true; region?: string; tenantId?: string; capabilities: SophosCapabilities }
  | { success: false; error: string };

export interface SophosReceiptCounts { last24h: number; last7d: number; last30d: number }

export interface SophosAutoResolveStatus {
  mode: SophosAutoMode;
  permission_mode: SophosPermissionMode;
  /** Real resolutions only. */
  counts: SophosReceiptCounts;
  /** Dry-run "would resolve" receipts, counted separately. */
  dry_run_counts?: SophosReceiptCounts;
  lastAutoResolve: { mode: SophosAutoMode; candidates: number; patched?: number; wouldPatch?: number; errors: string[] } | null;
}

export interface SophosReceipt {
  alert_id: string;
  alert_title: string;
  severity: string;
  source_type: SophosSourceType | null;
  achilles_test_uuid: string | null;
  auto_resolved_at?: string | null;
  auto_resolve_mode?: SophosAutoMode | null;
  auto_resolve_dry_run_at?: string | null;
  auto_resolve_error?: string | null;
}

export interface SophosReceiptPage { items: SophosReceipt[]; total: number; limit: number; offset: number }

export interface SophosSyncStatus {
  lastSiemSync: string | null;
  lastAlertSync: string | null;
  lastDetectionSync: string | null;
  lastAttemptAt?: string | null;
  inProgress: boolean;
  lastError?: { stage: string; message: string; at: string } | null;
  syncGap?: SophosSyncGap | null;
  lastSyncResult?: Record<string, unknown> | null;
}

export const sophosApi = {
  async getSettings(): Promise<SophosSettingsMasked> {
    try {
      const response = await apiClient.get('/integrations/sophos');
      return response.data;
    } catch {
      return { configured: false };
    }
  },

  async saveSettings(settings: SaveSophosSettingsRequest): Promise<{ success: boolean }> {
    const response = await apiClient.post('/integrations/sophos', settings);
    return response.data;
  },

  async testConnection(req: { client_id?: string; client_secret?: string }): Promise<SophosTestResult> {
    const response = await apiClient.post('/integrations/sophos/test', req);
    return response.data;
  },

  async deleteSettings(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/integrations/sophos');
    return response.data;
  },

  /** Starts a sync in the background (202); poll getSyncStatus() until inProgress is false. */
  async triggerSync(reset = false): Promise<{ started: boolean; inProgress: boolean }> {
    const response = await apiClient.post('/integrations/sophos/sync', { reset });
    return response.data.data;
  },

  async getSyncStatus(): Promise<SophosSyncStatus> {
    const response = await apiClient.get('/integrations/sophos/sync/status');
    return response.data;
  },

  /** Poll /sync/status until the background sync finishes; null when `isCancelled()` turns true. */
  async waitForSync(opts: { intervalMs?: number; maxMs?: number; isCancelled?: () => boolean; onStatus?: (s: SophosSyncStatus) => void } = {}): Promise<SophosSyncStatus | null> {
    const { intervalMs = 3000, maxMs = 30 * 60_000, isCancelled = () => false, onStatus } = opts;
    const deadline = Date.now() + maxMs;
    let status: SophosSyncStatus | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (isCancelled()) return null;
      status = await sophosApi.getSyncStatus();
      if (isCancelled()) return null;
      onStatus?.(status);
      if (!status.inProgress) break;
    }
    return status;
  },

  async getAutoResolveStatus(): Promise<SophosAutoResolveStatus> {
    const response = await apiClient.get('/integrations/sophos/auto-resolve/status');
    return response.data.data;
  },

  async setAutoResolveMode(mode: SophosAutoMode): Promise<{ mode: SophosAutoMode }> {
    const response = await apiClient.put('/integrations/sophos/auto-resolve/mode', { mode });
    return response.data.data;
  },

  async getAutoResolveReceipts(limit = 20, offset = 0): Promise<SophosReceiptPage> {
    const response = await apiClient.get('/integrations/sophos/auto-resolve/receipts', { params: { limit, offset } });
    return response.data.data;
  },
};
