import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { getUserId } from '../../middleware/clerk.middleware.js';
import {
  createToken,
  enrollAgent,
  listTokens,
  revokeToken,
} from '../../services/agent/enrollment.service.js';
import { streamUpdate } from '../../services/agent/update.service.js';
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
  asyncHandler(async (req, res) => {
    const { token, hostname, os, arch, agent_version } = req.body as EnrollmentRequest;

    if (!token || !hostname || !os || !arch || !agent_version) {
      throw new AppError('Missing required fields: token, hostname, os, arch, agent_version', 400);
    }

    if (!['windows', 'linux'].includes(os)) {
      throw new AppError('Invalid os: must be "windows" or "linux"', 400);
    }

    if (!['amd64', 'arm64'].includes(arch)) {
      throw new AppError('Invalid arch: must be "amd64" or "arm64"', 400);
    }

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

    const validOs: AgentOS[] = ['linux', 'windows'];
    const validArch: AgentArch[] = ['amd64', 'arm64'];

    if (!os || !validOs.includes(os as AgentOS)) {
      throw new AppError('Invalid or missing "os" parameter: must be "linux" or "windows"', 400);
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
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) {
      throw new AppError('Unable to determine user identity', 401);
    }

    const { org_id, ttl_hours, max_uses, metadata } = req.body as CreateTokenRequest;

    if (!org_id) {
      throw new AppError('Missing required field: org_id', 400);
    }

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
  asyncHandler(async (req, res) => {
    revokeToken(req.params.id);

    res.json({ success: true, data: { message: 'Token revoked' } });
  })
);
