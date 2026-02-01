import { Router } from 'express';
import { requireAgentAuth } from '../../middleware/agentAuth.middleware.js';
import { requireClerkAuth } from '../../middleware/clerk.middleware.js';
import { agentEnrollmentRouter, adminEnrollmentRouter } from './enrollment.routes.js';
import { agentHeartbeatRouter, adminAgentRouter } from './heartbeat.routes.js';
import { agentTasksRouter, adminTasksRouter } from './tasks.routes.js';
import { agentUpdateRouter, adminUpdateRouter } from './update.routes.js';
import binaryRouter from './binary.routes.js';

export function createAgentRouter(): Router {
  const router = Router();

  // Admin endpoints mounted at /admin - Clerk auth applied here so
  // individual admin routers don't need their own Clerk middleware.
  router.use('/admin', requireClerkAuth(), adminEnrollmentRouter);
  router.use('/admin', requireClerkAuth(), adminAgentRouter);
  router.use('/admin', requireClerkAuth(), adminTasksRouter);
  router.use('/admin', requireClerkAuth(), adminUpdateRouter);

  // Public agent endpoint (no auth required for enrollment)
  router.use(agentEnrollmentRouter);

  // Agent-authenticated endpoints
  router.use(requireAgentAuth, agentHeartbeatRouter);
  router.use(requireAgentAuth, agentTasksRouter);
  router.use(requireAgentAuth, agentUpdateRouter);
  router.use(requireAgentAuth, binaryRouter);

  return router;
}
