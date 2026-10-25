/**
 * Zod schemas for integration endpoints (Azure, Defender, Alerts).
 */

import { z } from 'zod';

// ── Azure / Entra ID ─────────────────────────────────────────────────────────

export const AzureCredentialsSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  // Secret auth
  client_secret: z.string().optional(),
  label: z.string().optional(),
  // Certificate auth
  auth_method: z.enum(['client_secret', 'certificate']).optional(),
  cert_thumbprint: z.string().optional(),
  private_key_pem: z.string().optional(),
});

export const AzureTestSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  // Secret auth
  client_secret: z.string().optional(),
  // Certificate auth
  auth_method: z.enum(['client_secret', 'certificate']).optional(),
  cert_thumbprint: z.string().optional(),
  private_key_pem: z.string().optional(),
});

// ── Defender ─────────────────────────────────────────────────────────────────

export const DefenderCredentialsSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  // Secret auth
  client_secret: z.string().optional(),
  label: z.string().optional(),
  // Certificate auth
  auth_method: z.enum(['client_secret', 'certificate']).optional(),
  cert_thumbprint: z.string().optional(),
  private_key_pem: z.string().optional(),
});

export const DefenderAutoResolveModeSchema = z.object({
  mode: z.enum(['disabled', 'dry_run', 'enabled']),
});

export const DefenderTestSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  // Secret auth
  client_secret: z.string().optional(),
  // Certificate auth
  auth_method: z.enum(['client_secret', 'certificate']).optional(),
  cert_thumbprint: z.string().optional(),
  private_key_pem: z.string().optional(),
});

// ── CrowdStrike Falcon ───────────────────────────────────────────────────────

const CrowdStrikeRegionSchema = z.enum(['us-1', 'us-2', 'eu-1', 'us-gov-1']);

export const CrowdStrikeCredentialsSchema = z.object({
  // Region only — the API base URL is derived from the constant region map
  // (falcon-client.ts); there is deliberately no custom base_url field.
  region: CrowdStrikeRegionSchema.optional(),
  // Falcon client IDs are 32-char lowercase hex
  client_id: z.string().regex(/^[0-9a-f]{32}$/, 'client_id must be a 32-character lowercase hex string').optional(),
  client_secret: z.string().min(1).optional(),
  label: z.string().optional(),
});

export const CrowdStrikeAutoResolveModeSchema = z.object({
  mode: z.enum(['disabled', 'dry_run', 'enabled']),
});

export const CrowdStrikeTestSchema = z.object({
  region: CrowdStrikeRegionSchema.optional(),
  client_id: z.string().regex(/^[0-9a-f]{32}$/, 'client_id must be a 32-character lowercase hex string').optional(),
  client_secret: z.string().optional(),
});

// ── Alert Settings ───────────────────────────────────────────────────────────

const AlertThresholdsSchema = z.object({
  enabled: z.boolean().optional(),
  score_drop_percent: z.number().min(0).max(100).optional(),
  score_floor: z.number().min(0).max(100).optional(),
  // The metric thresholds AlertsService evaluates. They were missing here, so
  // validate() stripped them and saved thresholds never persisted.
  // null clears a saved threshold (saveAlertSettings deletes null keys).
  defense_score_min: z.number().min(0).max(100).nullable().optional(),
  error_rate_max: z.number().min(0).max(100).nullable().optional(),
  secure_score_min: z.number().min(0).max(100).nullable().optional(),
  // SentinelOne agent health (latest /agents/count snapshot). Alert when the count exceeds the max.
  s1_infected_agents_max: z.number().int().min(0).nullable().optional(),
  s1_detect_only_agents_max: z.number().int().min(0).nullable().optional(),
  s1_outdated_agents_max: z.number().int().min(0).nullable().optional(),
}).optional();

const SlackChannelSchema = z.object({
  webhook_url: z.string().optional(),
  configured: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).optional();

const EmailChannelSchema = z.object({
  smtp_host: z.string().optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: z.string().optional(),
  smtp_pass: z.string().optional(),
  from_address: z.string().optional(),
  recipients: z.array(z.string()).optional(),
  configured: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).optional();

const AgentAlertsSchema = z.object({
  enabled: z.boolean().optional(),
  offline_hours_threshold: z.number().optional(),
  flapping_threshold: z.number().int().optional(),
  fleet_online_percent_min: z.number().min(0).max(100).optional(),
  cooldown_minutes: z.number().int().optional(),
  last_alert_at: z.string().nullable().optional(),
}).optional();

export const AlertSettingsSchema = z.object({
  thresholds: AlertThresholdsSchema,
  cooldown_minutes: z.number().int().min(1).optional(),
  last_alert_at: z.string().nullable().optional(),
  slack: SlackChannelSchema,
  email: EmailChannelSchema,
  agent_alerts: AgentAlertsSchema,
});

export const AlertTestSchema = z.object({
  slack_webhook_url: z.string().optional(),
  email: EmailChannelSchema,
});
