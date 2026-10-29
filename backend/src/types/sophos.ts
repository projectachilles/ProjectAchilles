// Sophos Central integration types.
// Auth: OAuth2 client credentials against id.sophos.com; the regional API host
// is discovered via /whoami/v1 (never configured by hand).

import type { AutoResolveMode } from './edr.js';

export type { AutoResolveMode };

/**
 * Permission mode for a Sophos integration.
 *  - read_only: only GET/query extraction; the client refuses every write.
 *  - response:  read_only + the opt-in auto-resolve writes (alert acknowledge,
 *    XDR detection resolution).
 */
export type SophosPermissionMode = 'read_only' | 'response';

/** Data sources the poller can pull. */
export type SophosSource = 'alerts' | 'siem_events' | 'xdr_detections';

/** Whether a Sophos API surface is usable with this tenant's licence and scopes. */
export type SophosCapabilityState = 'available' | 'not_licensed' | 'forbidden' | 'unknown';

export interface SophosCapabilities {
  siem: SophosCapabilityState;
  alerts: SophosCapabilityState;
  xdr_graphql: SophosCapabilityState;
  xdr_rest: SophosCapabilityState;
  health_check: SophosCapabilityState;
}

/** Sync checkpoints (never credentials). */
export interface SophosSyncCheckpoints {
  siem_cursor?: string | null;
  last_siem_sync?: string | null;
  last_alert_sync?: string | null;
  last_detection_sync?: string | null;
  last_posture_sync?: string | null;
  sync_version?: number;
  /** Window the SIEM feed could not cover (cursor expired); surfaced in the UI. */
  sync_gap?: { from: string; to: string } | null;
}

/**
 * Standalone `sophos_sync` key in integrations.json, used when the credentials
 * come from env vars so the file never holds a section that would shadow them.
 */
export interface SophosSyncState extends SophosSyncCheckpoints {
  auto_resolve_mode?: AutoResolveMode;
}

/** Persisted settings (client_secret stored AES-256-GCM encrypted as `enc:...`). */
export interface SophosIntegrationSettings extends SophosSyncState {
  client_id: string;
  client_secret: string;
  configured: boolean;
  label?: string;
  permission_mode?: SophosPermissionMode;
  /** Polling interval in minutes (1..1440, default 5). */
  poll_interval_minutes?: number;
  /** Initial XDR detection backfill in days (1..90, default 30). */
  detection_backfill_days?: number;
  // Discovered via whoami after the first successful auth.
  tenant_id?: string;
  data_region?: string;
  api_host?: string;
  capabilities?: SophosCapabilities;
  last_auth_ok_at?: string;
}

/** Fields written by tenant discovery (whoami + capability probe). */
export type SophosDiscovery = Pick<
  SophosIntegrationSettings,
  'tenant_id' | 'data_region' | 'api_host' | 'capabilities' | 'last_auth_ok_at'
>;

/** Raw credentials handed to the client. */
export interface SophosCredentials {
  client_id: string;
  client_secret: string;
  permission_mode: SophosPermissionMode;
}

/** Masked view for API responses — never includes the secret. */
export interface SophosSettingsMasked {
  configured: boolean;
  env_configured: boolean;
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
  auto_resolve_mode?: AutoResolveMode;
  sync_gap?: { from: string; to: string } | null;
}
