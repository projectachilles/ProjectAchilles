/**
 * Zod schemas for analytics endpoints (ES settings, index management, archives).
 */

import { z } from 'zod';

// ── ES Settings ──────────────────────────────────────────────────────────────

export const AnalyticsSettingsSchema = z.object({
  connectionType: z.string().min(1, 'Connection type is required'),
  cloudId: z.string().optional(),
  apiKey: z.string().optional(),
  node: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  indexPattern: z.string().optional(),
  caCert: z.string().optional(),
  tlsInsecureSkipVerify: z.boolean().optional(),
});

export const AnalyticsTestSchema = z.object({
  connectionType: z.string().optional(),
  cloudId: z.string().optional(),
  apiKey: z.string().optional(),
  node: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  caCert: z.string().optional(),
  tlsInsecureSkipVerify: z.boolean().optional(),
});

// ── Index management ─────────────────────────────────────────────────────────

export const CreateIndexSchema = z.object({
  index_name: z.string()
    .min(1, 'index_name is required')
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Must be lowercase, start with a letter or digit, and contain only letters, digits, and hyphens'),
});

// ── Archive ──────────────────────────────────────────────────────────────────

const groupKeyPattern = /^(bundle|standalone)::/;

export const ArchiveByGroupKeysSchema = z.object({
  groupKeys: z.array(
    z.string().regex(groupKeyPattern, 'Must start with "bundle::" or "standalone::"')
  ).min(1, 'groupKeys must be non-empty').max(500, 'Maximum 500 group keys per request'),
});

export const ArchiveByDateSchema = z.object({
  before: z.string().refine((val) => !isNaN(new Date(val).getTime()), 'Must be a valid ISO date string'),
});
