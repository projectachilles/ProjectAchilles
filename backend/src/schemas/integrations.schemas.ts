/**
 * Zod schemas for integration endpoints (Azure, Defender, Alerts).
 */

import { z } from 'zod';

// ── Azure / Entra ID ─────────────────────────────────────────────────────────

export const AzureCredentialsSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  label: z.string().optional(),
});

export const AzureTestSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

// ── Defender ─────────────────────────────────────────────────────────────────

export const DefenderCredentialsSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  label: z.string().optional(),
});

export const DefenderAutoResolveModeSchema = z.object({
  mode: z.enum(['disabled', 'dry_run', 'enabled']),
});

export const DefenderTestSchema = z.object({
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

// ── Sophos Central ───────────────────────────────────────────────────────────
//
// Note: no tenant_id field. Sophos's tenant is discovered via whoami at
// connection-test time, not operator-supplied. Including a tenant_id input
// here would mislead users into typing one in only for it to be ignored.

export const SophosCredentialsSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  label: z.string().optional(),
});

export const SophosTestSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

// ── Alert Settings ───────────────────────────────────────────────────────────

const AlertThresholdsSchema = z.object({
  enabled: z.boolean().optional(),
  score_drop_percent: z.number().min(0).max(100).optional(),
  score_floor: z.number().min(0).max(100).optional(),
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
