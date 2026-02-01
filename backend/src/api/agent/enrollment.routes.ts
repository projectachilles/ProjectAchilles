import { Router } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { requireClerkAuth, getUserId } from '../../middleware/clerk.middleware.js';
import {
  createToken,
  enrollAgent,
  listTokens,
  revokeToken,
} from '../../services/agent/enrollment.service.js';
import type { EnrollmentRequest, CreateTokenRequest } from '../../types/agent.js';

// ============================================================================
// Agent-facing router (no auth required)
// ============================================================================

export const agentEnrollmentRouter = Router();

/**
 * POST /enroll
 * Agent enrollment using an enrollment token.
 */
agentEnrollmentRouter.post(
  '/enroll',
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

// ============================================================================
// Admin router (Clerk auth required)
// ============================================================================

export const adminEnrollmentRouter = Router();

// All admin routes require Clerk authentication
adminEnrollmentRouter.use(requireClerkAuth());

/**
 * POST /admin/tokens
 * Create a new enrollment token.
 */
adminEnrollmentRouter.post(
  '/admin/tokens',
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
  '/admin/tokens',
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
  '/admin/tokens/:id',
  asyncHandler(async (req, res) => {
    revokeToken(req.params.id);

    res.json({ success: true, data: { message: 'Token revoked' } });
  })
);
