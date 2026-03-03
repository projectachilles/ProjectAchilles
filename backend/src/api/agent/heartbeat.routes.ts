import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, AppError } from '../../middleware/error.middleware.js';
import { requireAgentOrgAccess, requirePermission } from '../../middleware/clerk.middleware.js';
import {
  processHeartbeat,
  getPendingRotationKey,
  getAgentMetrics,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  addTag,
  removeTag,
  getHeartbeatHistory,
  getFleetHealthMetrics,
} from '../../services/agent/heartbeat.service.js';
import { listAgentEvents } from '../../services/agent/events.service.js';
import { rotateAgentKey } from '../../services/agent/enrollment.service.js';
import {
  getAutoRotationSettings,
  saveAutoRotationSettings,
} from '../../services/agent/autoRotation.service.js';
import type { HeartbeatPayload, ListAgentsRequest, AgentEventType } from '../../types/agent.js';

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

    // Defense-in-depth: validate payload timestamp is within ±5 min of server time
    const payloadTime = new Date(payload.timestamp).getTime();
    if (isNaN(payloadTime) || Math.abs(Date.now() - payloadTime) / 1000 > 300) {
      throw new AppError('Stale or invalid heartbeat timestamp', 400);
    }

    processHeartbeat(agent.id, payload);

    const pendingKey = getPendingRotationKey(agent.id);

    res.json({
      success: true,
      data: {
        acknowledged: true,
        server_time: new Date().toISOString(),
        ...(pendingKey && { new_api_key: pendingKey }),
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
      stale_only: req.query.stale_only === 'true',
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

// M6: Strict rate limit for key rotation — bcrypt hash generation is expensive
const keyRotationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many key rotation attempts, try again later' },
});

/**
 * POST /admin/agents/:id/rotate-key
 * Rotate an agent's API key. Returns the new key exactly once.
 */
adminAgentRouter.post(
  '/agents/:id/rotate-key',
  keyRotationLimiter,
  requirePermission('endpoints:agents:write'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await rotateAgentKey(req.params.id);

    res.json({
      success: true,
      data: {
        agent_id: result.agent_id,
        agent_key: result.agent_key,
        rotated_at: result.rotated_at,
        warning: 'Copy this key as a backup. The agent will receive it automatically via heartbeat within ~60 seconds.',
      },
    });
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

// ============================================================================
// HEARTBEAT HISTORY & EVENTS & FLEET HEALTH
// ============================================================================

/**
 * GET /admin/agents/:id/heartbeats?days=7
 * Get heartbeat history for sparkline chart.
 */
adminAgentRouter.get(
  '/agents/:id/heartbeats',
  requirePermission('endpoints:agents:read'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
    if (days < 1 || days > 30) {
      throw new AppError('days must be between 1 and 30', 400);
    }
    const history = getHeartbeatHistory(req.params.id, days);
    res.json({ success: true, data: history });
  })
);

/**
 * GET /admin/agents/:id/events?limit=50&offset=0&event_type=
 * Get agent event log.
 */
adminAgentRouter.get(
  '/agents/:id/events',
  requirePermission('endpoints:agents:read'),
  requireAgentOrgAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const event_type = req.query.event_type as AgentEventType | undefined;

    const result = listAgentEvents(req.params.id, { limit, offset, event_type });
    res.json({ success: true, data: result });
  })
);

/**
 * GET /admin/metrics/fleet-health
 * Get fleet-wide health KPIs.
 */
adminAgentRouter.get(
  '/metrics/fleet-health',
  requirePermission('endpoints:agents:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.query.org_id as string | undefined;
    const metrics = getFleetHealthMetrics(orgId);
    res.json({ success: true, data: metrics });
  })
);

// ============================================================================
// AUTO-ROTATION SETTINGS
// ============================================================================

/**
 * GET /admin/settings/auto-rotation
 * Returns the current auto-rotation configuration.
 */
adminAgentRouter.get(
  '/settings/auto-rotation',
  requirePermission('endpoints:agents:write'),
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = getAutoRotationSettings();
    res.json({ success: true, data: settings });
  })
);

/**
 * PUT /admin/settings/auto-rotation
 * Update auto-rotation configuration.
 */
adminAgentRouter.put(
  '/settings/auto-rotation',
  requirePermission('endpoints:agents:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const { enabled, intervalDays } = req.body as { enabled?: boolean; intervalDays?: number };

    if (typeof enabled !== 'boolean') {
      throw new AppError('enabled is required and must be a boolean', 400);
    }
    if (typeof intervalDays !== 'number' || intervalDays < 30 || intervalDays > 365) {
      throw new AppError('intervalDays must be a number between 30 and 365', 400);
    }

    saveAutoRotationSettings({ enabled, intervalDays });

    res.json({ success: true, data: { enabled, intervalDays } });
  })
);
