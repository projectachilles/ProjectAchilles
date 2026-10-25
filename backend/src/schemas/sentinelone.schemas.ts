/**
 * Zod schemas for the SentinelOne integration endpoints.
 */

import { z } from 'zod';

// S1 object ids are 18-19 digit numeric strings.
const S1Id = z.string().regex(/^\d{1,24}$/, 'SentinelOne ids are numeric strings');
const IdList = z.array(S1Id).max(500);

export const SentinelOneSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'informational', 'unknown']);
export const SentinelOnePermissionModeSchema = z.enum(['read_only', 'response']);
export const SentinelOneSourceSchema = z.enum(['threats', 'cloud_detection_alerts']);

export const SentinelOneSettingsSchema = z.object({
  base_url: z.string().url().max(300).optional(),
  // Never logged/returned. S1 API tokens are long JWT-like strings.
  api_token: z.string().min(20).max(4096).optional(),
  label: z.string().max(120).optional(),
  permission_mode: SentinelOnePermissionModeSchema.optional(),
  poll_interval_minutes: z.number().int().min(1).max(1440).optional(),
  backfill_days: z.number().int().min(1).max(365).optional(),
  sources: z.array(SentinelOneSourceSchema).min(1).optional(),
  scope: z.object({
    account_ids: IdList.optional(),
    site_ids: IdList.optional(),
    group_ids: IdList.optional(),
  }).optional(),
  filters: z.object({
    severities: z.array(SentinelOneSeveritySchema).optional(),
    incident_statuses: z.array(z.enum(['unresolved', 'in_progress', 'resolved'])).optional(),
  }).optional(),
});

export const SentinelOneTestSchema = z.object({
  base_url: z.string().url().max(300).optional(),
  api_token: z.string().min(20).max(4096).optional(),
  scope: z.object({
    account_ids: IdList.optional(),
    site_ids: IdList.optional(),
  }).optional(),
});

export const SentinelOneSyncSchema = z.object({
  /** Clear checkpoints and redo the initial backfill. */
  reset: z.boolean().optional(),
});

export const SentinelOneAutoResolveModeSchema = z.object({
  mode: z.enum(['disabled', 'dry_run', 'enabled']),
});

/** Automatic mitigation: only kill / quarantine are accepted (no remediate, rollback or isolation). */
export const SentinelOneAutoMitigationSchema = z.object({
  mode: z.enum(['disabled', 'dry_run', 'enabled']).optional(),
  action: z.enum(['kill', 'quarantine']).optional(),
}).refine((v) => v.mode !== undefined || v.action !== undefined, { message: 'mode or action is required' });
