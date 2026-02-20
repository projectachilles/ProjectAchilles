import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAgentAuth } from '../../middleware/agentAuth.middleware.js';
import { requireClerkAuth, requireOrgAccess } from '../../middleware/clerk.middleware.js';
import { agentEnrollmentRouter, adminEnrollmentRouter } from './enrollment.routes.js';
import { agentHeartbeatRouter, adminAgentRouter } from './heartbeat.routes.js';
import { agentTasksRouter, adminTasksRouter } from './tasks.routes.js';
import { agentUpdateRouter, createAdminUpdateRouter } from './update.routes.js';
import { adminSchedulesRouter } from './schedules.routes.js';
import { createAdminCatalogRouter } from './catalog.routes.js';
import binaryRouter from './binary.routes.js';

export function createAgentRouter(options: { testsSourcePath: string }): Router {
  const router = Router();

  // No agent build service in serverless — pass null
  const buildService = null;

  // Admin endpoints mounted at /admin - Clerk auth + org access applied here so
  // individual admin routers don't need their own Clerk/org middleware.
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminEnrollmentRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminAgentRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminTasksRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, createAdminUpdateRouter(buildService));
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminSchedulesRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, createAdminCatalogRouter(options.testsSourcePath));

  // Public agent endpoint (no auth required for enrollment — has its own stricter limiter)
  router.use(agentEnrollmentRouter);

  // Agent device rate limiter (separate from global UI limiter).
  const agentDeviceLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 100,                     // 100 requests per 15min per agent
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.headers['x-agent-id'] as string) || req.ip || 'unknown',
    message: { success: false, error: 'Too many agent requests, try again later' },
  });
  router.use(agentDeviceLimiter);

  // Agent-authenticated endpoints
  router.use(requireAgentAuth, agentHeartbeatRouter);
  router.use(requireAgentAuth, agentTasksRouter);
  router.use(requireAgentAuth, agentUpdateRouter);
  router.use(requireAgentAuth, binaryRouter);

  return router;
}
