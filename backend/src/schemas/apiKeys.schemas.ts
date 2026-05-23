import { z } from 'zod';

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['read', 'read-write']),
  /** Optional ISO-8601 expiry. */
  expires_at: z.string().datetime().optional(),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
