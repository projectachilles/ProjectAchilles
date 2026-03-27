/**
 * Zod schemas for risk acceptance endpoints.
 */

import { z } from 'zod';

export const AcceptRiskSchema = z.object({
  test_name: z.string().min(1, 'test_name is required'),
  control_id: z.string().optional(),
  hostname: z.string().optional(),
  justification: z.string().min(10, 'justification is required (minimum 10 characters)'),
});

export const RevokeRiskSchema = z.object({
  reason: z.string().min(10, 'reason is required (minimum 10 characters)'),
});

export const LookupRiskSchema = z.object({
  test_names: z.array(z.string()).min(1, 'test_names must be non-empty').max(500, 'Maximum 500 test names per lookup'),
});
