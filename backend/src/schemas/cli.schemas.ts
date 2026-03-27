/**
 * Zod schemas for CLI device authorization flow endpoints.
 */

import { z } from 'zod';

export const VerifyCodeSchema = z.object({
  user_code: z.string().min(1, 'user_code is required'),
});

export const PollDeviceCodeSchema = z.object({
  device_code: z.string().min(1, 'device_code is required'),
});

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required'),
});
