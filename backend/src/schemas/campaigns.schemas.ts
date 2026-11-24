/**
 * Zod schemas for campaign endpoints. Strict shapes keep non-string or
 * non-array input away from the services (a TypeError there would be a 500).
 */

import { z } from 'zod';
import { TestUuidSchema } from './admin.schemas.js';

const IdList = z.array(z.string().min(1));

const campaignFields = {
  name: z.string().trim().min(1, 'name is required').max(120, 'name must be at most 120 characters'),
  description: z.string().max(2000, 'description must be at most 2000 characters').nullable().optional(),
  framework_label: z.string().max(120, 'framework_label must be at most 120 characters').nullable().optional(),
  test_uuids: z.array(TestUuidSchema),
  agent_ids: IdList,
};

export const CreateCampaignSchema = z.object({
  org_id: z.string().min(1),
  ...campaignFields,
});

/** A campaign's org never changes, so org_id is optional (and ignored) on update. */
export const UpdateCampaignSchema = z.object({
  org_id: z.string().optional(),
  ...campaignFields,
});

export const RunCampaignSchema = z.object({
  org_id: z.string().min(1),
  confirm_partial: z.boolean().optional(),
});
