// Type definitions for external integration settings (Azure / Entra ID, etc.)

import type { AutoResolveMode } from './defender.js';
import type { SophosTier } from './sophos.js';
export type { AutoResolveMode };
export type { SophosTier };

export interface AzureIntegrationSettings {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  configured: boolean;
  label?: string; // user-friendly name, e.g. "Contoso Production"
}

export interface DefenderIntegrationSettings {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  configured: boolean;
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

/**
 * Sophos Central integration credentials and discovered metadata.
 *
 * `client_id` and `client_secret` are operator-supplied. `tenant_id`,
 * `data_region`, and `tier` are *discovered* via the Sophos `whoami`
 * endpoint at credential-save time and cached here to avoid an extra
 * round-trip on every sync. They're optional on the type because they
 * don't exist before the first successful `whoami` call.
 *
 * Phase 1 only persists `client_id`, `client_secret`, `configured`, and
 * `label`. The other fields (`last_alert_sync`, `auto_resolve_mode`,
 * etc.) are declared now so the type is stable across Phase 1→4 — they
 * become live in their respective phases.
 */
export interface SophosIntegrationSettings {
  client_id: string;
  client_secret: string;
  /** Discovered via whoami. Not present before first successful connection. */
  tenant_id?: string;
  /** Discovered via whoami (e.g., "https://api-eu01.central.sophos.com"). */
  data_region?: string;
  /** Discovered via whoami's product list. Defaults to 'basic' when unknown. */
  tier?: SophosTier;
  configured: boolean;
  label?: string; // e.g. "Contoso Production"
  /** Phase 2: incremental alert sync checkpoint. */
  last_alert_sync?: string;
  /** Phase 2: health-score snapshot checkpoint. */
  last_score_sync?: string;
  /** Phase 4: auto-resolve mode for Sophos alerts. */
  auto_resolve_mode?: AutoResolveMode;
}

// ---------------------------------------------------------------------------
// Alert & Notification Settings
// ---------------------------------------------------------------------------

export interface AlertThresholds {
  defense_score_min?: number;    // Alert if Defense Score < this (e.g., 70)
  error_rate_max?: number;       // Alert if Error Rate > this (e.g., 20)
  secure_score_min?: number;     // Alert if Secure Score < this (e.g., 60)
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
  sophos?: SophosIntegrationSettings;
  alerts?: AlertSettings;
}

/**
 * Top-level settings file format. Supports both legacy (flat) and per-org modes.
 * Legacy keys are kept for backward compat — they act as the fallback when no
 * org-specific settings exist.
 */
export interface IntegrationsSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
  sophos?: SophosIntegrationSettings;
  alerts?: AlertSettings;
  /** Per-org overrides. Key is the Clerk org_id. */
  orgs?: Record<string, OrgIntegrationSettings>;
}
