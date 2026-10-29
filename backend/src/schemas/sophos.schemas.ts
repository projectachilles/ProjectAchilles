/**
 * Zod schemas for the Sophos Central integration endpoints.
 */

import { z } from 'zod';

export const SophosPermissionModeSchema = z.enum(['read_only', 'response']);

// Sophos client ids are UUIDs; secrets are long opaque strings. Never logged/returned.
const ClientId = z.string().min(8).max(200);
const ClientSecret = z.string().min(8).max(4096);

export const SophosSettingsSchema = z.object({
  client_id: ClientId.optional(),
  client_secret: ClientSecret.optional(),
  label: z.string().max(120).optional(),
  permission_mode: SophosPermissionModeSchema.optional(),
  poll_interval_minutes: z.number().int().min(1).max(1440).optional(),
  detection_backfill_days: z.number().int().min(1).max(90).optional(),
});

export const SophosTestSchema = z.object({
  client_id: ClientId.optional(),
  client_secret: ClientSecret.optional(),
});

export const SophosSyncSchema = z.object({
  /** Clear checkpoints and redo the initial backfill. */
  reset: z.boolean().optional(),
});

export const SophosAutoResolveModeSchema = z.object({
  mode: z.enum(['disabled', 'dry_run', 'enabled']),
});
