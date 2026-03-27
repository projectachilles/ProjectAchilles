import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getUserId, requirePermission, validateRequestOrgId } from '../../middleware/clerk.middleware.js';
import {
  createToken,
  enrollAgent,
  listTokens,
  revokeToken,
} from '../../services/agent/enrollment.service.js';
import { streamUpdate } from '../../services/agent/update.service.js';
import { validate } from '../../middleware/validation.js';
import { EnrollRequestSchema, CreateTokenSchema } from '../../schemas/agent.schemas.js';
import type { EnrollmentRequest, CreateTokenRequest, AgentOS, AgentArch } from '../../types/agent.js';

// ============================================================================
// Agent-facing router (no auth required)
// ============================================================================

export const agentEnrollmentRouter = Router();

const enrollmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many enrollment attempts, try again later' },
});

/**
 * POST /enroll
 * Agent enrollment using an enrollment token.
 */
agentEnrollmentRouter.post(
  '/enroll',
  enrollmentLimiter,
  validate(EnrollRequestSchema),
  asyncHandler(async (req, res) => {
    const { token, hostname, os, arch, agent_version } = req.body as EnrollmentRequest;

    const result = await enrollAgent({ token, hostname, os, arch, agent_version });

    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /config
 * Returns the server URL for agent communication.
 */
agentEnrollmentRouter.get('/config', (_req, res) => {
  const serverUrl = process.env.AGENT_SERVER_URL || `http://localhost:${process.env.PORT || '3000'}`;

  if (serverUrl.startsWith('http://') && !isLocalhostUrl(serverUrl)) {
    console.warn(
      `[enrollment] WARNING: AGENT_SERVER_URL is "${serverUrl}" (plaintext HTTP to remote host). ` +
      `Agents will reject this URL. Set AGENT_SERVER_URL to an https:// URL.`
    );
  }

  res.json({ success: true, data: { server_url: serverUrl } });
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many download requests, try again later' },
});

/**
 * GET /download?os={linux|windows}&arch={amd64|arm64}
 * Public binary download endpoint (rate-limited).
 */
agentEnrollmentRouter.get(
  '/download',
  downloadLimiter,
  asyncHandler(async (req, res) => {
    const os = req.query.os as string;
    const arch = req.query.arch as string;

    const validOs: AgentOS[] = ['linux', 'windows', 'darwin'];
    const validArch: AgentArch[] = ['amd64', 'arm64'];

    if (!os || !validOs.includes(os as AgentOS)) {
      throw new AppError('Invalid or missing "os" parameter: must be "linux", "windows", or "darwin"', 400);
    }

    if (!arch || !validArch.includes(arch as AgentArch)) {
      throw new AppError('Invalid or missing "arch" parameter: must be "amd64" or "arm64"', 400);
    }

    streamUpdate(os as AgentOS, arch as AgentArch, res);
  })
);

// ============================================================================
// Admin router (Clerk auth required)
// ============================================================================

export const adminEnrollmentRouter = Router();

// Clerk auth is applied at mount time in the parent router.

/**
 * POST /tokens
 * Create a new enrollment token.
 */
adminEnrollmentRouter.post(
  '/tokens',
  requirePermission('endpoints:tokens:create'),
  validate(CreateTokenSchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ttl_hours, max_uses, metadata } = req.body as CreateTokenRequest;
    validateRequestOrgId(org_id, req.auth);

    const result = await createToken(
      org_id,
      userId,
      ttl_hours ?? 24,
      max_uses ?? 1,
      metadata ?? {}
    );

    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /admin/tokens
 * List active enrollment tokens for an organization.
 */
adminEnrollmentRouter.get(
  '/tokens',
  requirePermission('endpoints:tokens:create'),
  asyncHandler(async (req, res) => {
    const orgId = req.query.org_id as string;

    if (!orgId) {
      throw new AppError('Missing required query parameter: org_id', 400);
    }

    const tokens = listTokens(orgId);

    res.json({ success: true, data: tokens });
  })
);

/**
 * DELETE /admin/tokens/:id
 * Revoke an enrollment token.
 */
adminEnrollmentRouter.delete(
  '/tokens/:id',
  requirePermission('endpoints:tokens:delete'),
  asyncHandler(async (req, res) => {
    revokeToken(req.params.id);

    res.json({ success: true, data: { message: 'Token revoked' } });
  })
);

/** Check if a URL points to localhost/127.0.0.1/[::1]. */
function isLocalhostUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
