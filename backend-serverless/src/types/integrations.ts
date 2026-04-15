// Type definitions for external integration settings (Azure / Entra ID, etc.)

import type { AutoResolveMode } from './defender.js';
export type { AutoResolveMode };

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
  label?: string;
  last_alert_sync?: string;
  last_score_sync?: string;
  /** Auto-resolve pillar mode. Missing/undefined = 'disabled' (default). */
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

export interface IntegrationsSettings {
  azure?: AzureIntegrationSettings;
  defender?: DefenderIntegrationSettings;
  alerts?: AlertSettings;
}
