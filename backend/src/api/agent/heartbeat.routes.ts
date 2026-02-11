import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { requireAgentOrgAccess, requirePermission } from '../../middleware/clerk.middleware.js';
import {
  processHeartbeat,
  getAgentMetrics,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  addTag,
  removeTag,
} from '../../services/agent/heartbeat.service.js';
import type { HeartbeatPayload, ListAgentsRequest } from '../../types/agent.js';

// ============================================================================
// AGENT HEARTBEAT ROUTES (agent auth applied at mount time)
// ============================================================================

export const agentHeartbeatRouter = Router();

/**
 * POST /heartbeat
 * Process a heartbeat from an authenticated agent.
 * req.agent is set by requireAgentAuth middleware applied at mount time.
 */
agentHeartbeatRouter.post(
  '/heartbeat',
  asyncHandler(async (req: Request, res: Response) => {
    const agent = req.agent;
    if (!agent) {
      throw new AppError('Agent not authenticated', 401);
    }

    const payload = req.body as HeartbeatPayload;

    if (!payload || !payload.timestamp || !payload.system) {
      throw new AppError('Invalid heartbeat payload', 400);
    }

    processHeartbeat(agent.id, payload);

    res.json({
      success: true,
      data: {
        acknowledged: true,
        server_time: new Date().toISOString(),
      },
    });
  })
);

// ============================================================================
// ADMIN ROUTES (Clerk auth applied at mount time)
// ============================================================================

export const adminAgentRouter = Router();

/**
 * GET /admin/metrics
 * Get aggregate agent metrics.
 */
adminAgentRouter.get(
  '/metrics',
  requirePermission('endpoints:agents:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.query.org_id as string | undefined;
    const metrics = getAgentMetrics(orgId);

    res.json({ success: true, data: metrics });
  })
);

/**
 * GET /admin/agents
 * List agents with filters and online status.
 */
adminAgentRouter.get(
  '/agents',
  requirePermission('endpoints:agents:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const filters: ListAgentsRequest = {
      org_id: req.query.org_id as string | undefined,
      status: req.query.status as ListAgentsRequest['status'],
      os: req.query.os as ListAgentsRequest['os'],
      hostname: req.query.hostname as string | undefined,
      tag: req.query.tag as string | undefined,
      online_only: req.query.online_only === 'true',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const result = listAgents(filters);

    res.json({
      success: true,
      data: {
        agents: result.agents,
        total: result.total,
      },
    });
  })
);

/**
 * GET /admin/agents/:id
 * Get single agent detail.
 */
adminAgentRouter.get(
  '/agents/:id',
  requirePermission('endpoints:agents:read'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const agent = getAgent(req.params.id);
    if (!agent) {
      throw new AppError('Agent not found', 404);
    }

    res.json({ success: true, data: agent });
  })
);

/**
 * PATCH /admin/agents/:id
 * Update agent status or tags.
 */
adminAgentRouter.patch(
  '/agents/:id',
  requirePermission('endpoints:agents:write'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const existing = getAgent(req.params.id);
    if (!existing) {
      throw new AppError('Agent not found', 404);
    }

    const { status, tags } = req.body as { status?: string; tags?: string[] };

    updateAgent(req.params.id, {
      status: status as ListAgentsRequest['status'],
      tags,
    });

    const updated = getAgent(req.params.id);
    res.json({ success: true, data: updated });
  })
);

/**
 * DELETE /admin/agents/:id
 * Soft-delete (decommission) an agent.
 */
adminAgentRouter.delete(
  '/agents/:id',
  requirePermission('endpoints:agents:delete'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const existing = getAgent(req.params.id);
    if (!existing) {
      throw new AppError('Agent not found', 404);
    }

    deleteAgent(req.params.id);

    res.json({ success: true, data: { id: req.params.id, status: 'decommissioned' } });
  })
);

/**
 * POST /admin/agents/:id/tags
 * Add a tag to an agent.
 */
adminAgentRouter.post(
  '/agents/:id/tags',
  requirePermission('endpoints:agents:write'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const { tag } = req.body as { tag: string };
    if (!tag || typeof tag !== 'string') {
      throw new AppError('Tag is required and must be a string', 400);
    }

    const tags = addTag(req.params.id, tag);

    res.json({ success: true, data: { id: req.params.id, tags } });
  })
);

/**
 * DELETE /admin/agents/:id/tags/:tag
 * Remove a tag from an agent.
 */
adminAgentRouter.delete(
  '/agents/:id/tags/:tag',
  requirePermission('endpoints:agents:delete'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const { tag } = req.params;
    if (!tag || typeof tag !== 'string') {
      throw new AppError('Tag is required and must be a string', 400);
    }

    const tags = removeTag(req.params.id, tag);

    res.json({ success: true, data: { id: req.params.id, tags } });
  })
);
