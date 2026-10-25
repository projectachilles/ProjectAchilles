// Type definitions for external integration settings (Azure / Entra ID, etc.)

import type { AutoResolveMode } from './defender.js';
import type { CrowdStrikeRegion, CrowdStrikeZtaStatus } from './crowdstrike.js';
import type { SentinelOneIntegrationSettings, SentinelOneSyncState } from './sentinelone.js';
export type { AutoResolveMode };
export type { CrowdStrikeRegion };

export type DefenderAuthMethod = 'client_secret' | 'certificate';

export interface AzureIntegrationSettings {
  tenant_id: string;
  client_id: string;
  // Secret auth (kept as required string for backward compat; empty string when cert auth)
  client_secret: string;
  configured: boolean;
  // Auth method — undefined means 'client_secret' for backward compat
  auth_method?: DefenderAuthMethod;
  // Certificate auth fields (encrypted at rest)
  cert_thumbprint?: string;
  private_key_pem?: string;
  label?: string; // user-friendly name, e.g. "Contoso Production"
}

/** Discriminated union returned by getAzureCredentials() — callers always know which auth method is active. */
export type AzureCredentials =
  | { authMethod: 'client_secret'; tenant_id: string; client_id: string; client_secret: string }
  | { authMethod: 'certificate'; tenant_id: string; client_id: string; cert_thumbprint: string; private_key_pem: string };

export interface DefenderIntegrationSettings {
  tenant_id: string;
  client_id: string;
  // Secret auth (kept as required string for backward compat; empty string when cert auth)
  client_secret: string;
  configured: boolean;
  // Auth method — undefined means 'client_secret' for backward compat
  auth_method?: DefenderAuthMethod;
  // Certificate auth fields (encrypted at rest, same as client_secret)
  cert_thumbprint?: string; // hex SHA-1 of cert DER, e.g. "A1B2C3..." (from Azure portal)
  private_key_pem?: string; // PEM-encoded RSA private key
  label?: string; // e.g. "Contoso Production"
  /** Persisted sync timestamps so incremental syncs survive process restarts. */
  last_alert_sync?: string;
  last_score_sync?: string;
  /**
   * Auto-resolve pillar mode. Missing/undefined = 'disabled' (default).
   * Operationally opt-in — requires SecurityAlert.ReadWrite.All granted to
   * the Azure AD app registration for modes other than 'disabled'.
   */
  auto_resolve_mode?: AutoResolveMode;
}

/** Discriminated union returned by getDefenderCredentials() — callers always know which auth method is active. */
export type DefenderCredentials =
  | { authMethod: 'client_secret'; tenant_id: string; client_id: string; client_secret: string }
  | { authMethod: 'certificate'; tenant_id: string; client_id: string; cert_thumbprint: string; private_key_pem: string };

// ---------------------------------------------------------------------------
// CrowdStrike Falcon
// ---------------------------------------------------------------------------

export interface CrowdStrikeIntegrationSettings {
  /**
   * Falcon cloud region (the ONLY determinant of the API base URL — resolved
   * via CROWDSTRIKE_REGION_BASE_URLS in falcon-client.ts). Missing = 'us-1'.
   */
  region?: CrowdStrikeRegion;
  client_id: string;
  // Encrypted at rest
  client_secret: string;
  configured: boolean;
  label?: string; // e.g. "Contoso Production Falcon"
  /** Persisted sync timestamps so incremental syncs survive process restarts. */
  last_alert_sync?: string;
  last_zta_sync?: string;
  /** Alert schema version of the last completed sync — mismatch forces a full re-sync. */
  sync_version?: number;
  /** Last known Zero Trust Assessment availability ('not_licensed' after a 403). */
  zta_status?: CrowdStrikeZtaStatus;
  /**
   * Auto-resolve pillar mode. Missing/undefined = 'disabled' (default).
   * Operationally opt-in — requires the `Alerts: write` scope on the
   * Falcon API client for modes other than 'disabled'.
   */
  auto_resolve_mode?: AutoResolveMode;
}

/**
 * Raw credentials for the Falcon OAuth2 client (secret-only auth — CrowdStrike
 * has no certificate auth). Region only: the client resolves the base URL
 * from its constant region map, so no user-supplied string ever reaches a
 * fetch URL (request-forgery guard).
 */
export interface CrowdStrikeCredentials {
  region?: CrowdStrikeRegion;
  client_id: string;
  client_secret: string;
}

// ---------------------------------------------------------------------------
// Alert & Notification Settings
// ---------------------------------------------------------------------------

export interface AlertThresholds {
  defense_score_min?: number;    // Alert if Defense Score < this (e.g., 70)
  error_rate_max?: number;       // Alert if Error Rate > this (e.g., 20)
  secure_score_min?: number;     // Alert if Secure Score < this (e.g., 60)
  // SentinelOne agent health — alert if the latest /agents/count snapshot exceeds these.
  s1_infected_agents_max?: number;
  s1_detect_only_agents_max?: number;
  s1_outdated_agents_max?: number;
  enabled: boolean;
}

export interface SlackAlertSettings {
  webhook_url: string;           // Incoming webhook URL (encrypted at rest)
  configured: boolean;
  enabled: boolean;
}

export interface EmailAlertSettings {
  smtp_host: string;
  smtp_port: number;             // 587 (STARTTLS) or 465 (SSL)
  smtp_secure: boolean;          // true for port 465
  smtp_user: string;             // encrypted at rest
  smtp_pass: string;             // encrypted at rest
  from_address: string;          // e.g. "ProjectAchilles <alerts@example.com>"
  recipients: string[];          // e.g. ["admin@example.com", "security@example.com"]
  configured: boolean;
  enabled: boolean;
}

export interface AgentAlertSettings {
  enabled: boolean;
  offline_hours_threshold?: number;      // Alert if any agent offline > X hours
  flapping_threshold?: number;           // Alert if agent reconnects > N times in 24h
  fleet_online_percent_min?: number;     // Alert if fleet online % drops below
  cooldown_minutes?: number;             // Separate cooldown (default 30)
  last_alert_at?: string;               // Separate from test-result alert cooldown
}

export interface AlertSettings {
  thresholds: AlertThresholds;
  slack?: SlackAlertSettings;
  email?: EmailAlertSettings;
  cooldown_minutes: number;      // Default 15
  last_alert_at?: string;        // ISO timestamp of last sent alert (persisted)
  agent_alerts?: AgentAlertSettings;
}

/** Per-org integration settings (keyed by Clerk org_id). */
export interface OrgIntegrationSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
  crowdstrike?: CrowdStrikeIntegrationSettings;
  sentinelone?: SentinelOneIntegrationSettings;
  alerts?: AlertSettings;
  pre_execution_notices?: PreExecutionNoticeSettings;
}

/**
 * Top-level settings file format. Supports both legacy (flat) and per-org modes.
 * Legacy keys are kept for backward compat — they act as the fallback when no
 * org-specific settings exist.
 */
/**
 * Pre-execution notice settings. Per org (`orgs[orgId].pre_execution_notices`)
 * with the legacy top level as the fallback, like alerts (Ruling R20).
 */
export interface PreExecutionNoticeSettings {
  enabled: boolean;
  recipients: string[];
  /** Minutes between notice acceptance and task release (int 0-5). */
  lead_minutes: number;
  /** Max minutes a task is held waiting for delivery (15-1440). */
  max_wait_minutes: number;
  /** Minutes after release that hosts have to pick up tasks (30-1440). */
  pickup_window_minutes: number;
  send_finished: boolean;
  last_smtp_check_at?: string;
  last_smtp_check_ok?: boolean;
  last_smtp_check_message?: string;
}

export interface IntegrationsSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
  crowdstrike?: CrowdStrikeIntegrationSettings;
  sentinelone?: SentinelOneIntegrationSettings;
  /** SentinelOne checkpoints and toggles when the credentials come from env vars. */
  sentinelone_sync?: SentinelOneSyncState;
  alerts?: AlertSettings;
  pre_execution_notices?: PreExecutionNoticeSettings;
  /** Per-org overrides. Key is the Clerk org_id. */
  orgs?: Record<string, OrgIntegrationSettings>;
}
