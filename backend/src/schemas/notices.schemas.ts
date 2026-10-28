/**
 * Zod schemas for pre-execution notice endpoints.
 */

import { z } from 'zod';

/** Bare address only: a display-name form never matches nodemailer's accepted address and would hold the gate forever. */
const RecipientSchema = z.string().trim().min(1, 'Recipient cannot be empty').email('Recipients must be bare email addresses');

export const UpdateNoticeSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  recipients: z.array(RecipientSchema).max(50, 'Maximum 50 recipients').optional(),
  lead_minutes: z.number().int().optional(),
  max_wait_minutes: z.number().int().optional(),
  pickup_window_minutes: z.number().int().optional(),
  send_finished: z.boolean().optional(),
  advance_digest_enabled: z.boolean().optional(),
  digest_timezone: z.string().trim().min(1).max(64).optional(),
});

export const ReleaseNoticeSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required'),
});
