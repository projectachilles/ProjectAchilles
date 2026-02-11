import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { requireAgentAuth } from '../../middleware/agentAuth.middleware.js';
import { requireClerkAuth, requireOrgAccess } from '../../middleware/clerk.middleware.js';
import { agentEnrollmentRouter, adminEnrollmentRouter } from './enrollment.routes.js';
import { agentHeartbeatRouter, adminAgentRouter } from './heartbeat.routes.js';
import { agentTasksRouter, adminTasksRouter } from './tasks.routes.js';
import { agentUpdateRouter, createAdminUpdateRouter } from './update.routes.js';
import { adminSchedulesRouter } from './schedules.routes.js';
import { createAdminCatalogRouter } from './catalog.routes.js';
import binaryRouter from './binary.routes.js';
import { TestsSettingsService } from '../../services/tests/settings.js';
import { AgentBuildService } from '../../services/agent/agentBuild.service.js';

export function createAgentRouter(options: { testsSourcePath: string; agentSourcePath: string }): Router {
  const router = Router();

  // Instantiate build service if agent source is available
  let buildService: AgentBuildService | null = null;
  if (options.agentSourcePath && fs.existsSync(path.join(options.agentSourcePath, 'go.mod'))) {
    const settingsService = new TestsSettingsService();
    buildService = new AgentBuildService(settingsService, options.agentSourcePath);
    console.log(`  Agent build-from-source enabled (source: ${options.agentSourcePath})`);
  }

  // Admin endpoints mounted at /admin - Clerk auth + org access applied here so
  // individual admin routers don't need their own Clerk/org middleware.
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminEnrollmentRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminAgentRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminTasksRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, createAdminUpdateRouter(buildService));
  router.use('/admin', requireClerkAuth(), requireOrgAccess, adminSchedulesRouter);
  router.use('/admin', requireClerkAuth(), requireOrgAccess, createAdminCatalogRouter(options.testsSourcePath));

  // Public agent endpoint (no auth required for enrollment)
  router.use(agentEnrollmentRouter);

  // Agent-authenticated endpoints
  router.use(requireAgentAuth, agentHeartbeatRouter);
  router.use(requireAgentAuth, agentTasksRouter);
  router.use(requireAgentAuth, agentUpdateRouter);
  router.use(requireAgentAuth, binaryRouter);

  return router;
}
