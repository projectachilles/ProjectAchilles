/**
 * Zod schemas for user management endpoints.
 */

import { z } from 'zod';

export const InviteUserSchema = z.object({
  email: z.string().email('A valid email address is required'),
  role: z.enum(['admin', 'operator', 'analyst', 'explorer']),
});

export const SetRoleSchema = z.object({
  role: z.enum(['admin', 'operator', 'analyst', 'explorer']),
});
