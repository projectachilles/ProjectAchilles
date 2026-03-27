/**
 * Zod schemas for test build/certificate endpoints.
 */

import { z } from 'zod';

// ── Platform settings ────────────────────────────────────────────────────────

export const PlatformSettingsSchema = z.object({
  os: z.enum(['windows', 'linux', 'darwin']),
  arch: z.enum(['amd64', '386', 'arm64']),
});

// ── Certificate generation (legacy single-cert + multi-cert) ─────────────────

export const GenerateCertificateSchema = z.object({
  commonName: z.string().min(1, 'commonName is required'),
  organization: z.string().min(1, 'organization is required'),
  country: z.string().length(2, 'Country must be a 2-letter ISO code'),
  label: z.string().optional(),
  password: z.string().optional(),
});

// ── Certificate label update ─────────────────────────────────────────────────

export const UpdateCertLabelSchema = z.object({
  label: z.string(),
});

// ── Build upload (embed dependency) ──────────────────────────────────────────

export const UploadDependencySchema = z.object({
  filename: z.string().min(1, 'filename is required'),
});
