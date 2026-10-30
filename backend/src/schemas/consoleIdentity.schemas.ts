import { z } from 'zod';
import { IDENTITY_COLORS } from '../types/consoleIdentity.js';
import { normalizeCode } from '../services/consoleIdentity/consoleIdentity.service.js';

export const ConsoleIdentitySchema = z.object({
  code: z
    .string()
    .transform((v) => normalizeCode(v))
    .refine((v): v is string => v !== null, { message: 'Code must be 2–6 letters or digits' }),
  name: z
    .string()
    .nullable()
    .transform((v) => (v ?? '').trim())
    .pipe(z.string().max(80, 'Name must be 80 characters or fewer'))
    .transform((v) => (v === '' ? null : v)),
  color: z.enum([...IDENTITY_COLORS, 'none']),
});
