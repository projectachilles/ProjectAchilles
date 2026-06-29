import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAgentAuth } from '../../middleware/agentAuth.middleware.js';
import { agentDeviceKey } from '../../middleware/rateLimitKeys.js';
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
import type { TestSource } from '../../types/test.js';

export function createAgentRouter(options: { testSources: TestSource[]; testsSourcePath: string; agentSourcePath: string }): Router {
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
  router.use('/admin', requireClerkAuth(), requireOrgAccess, createAdminCatalogRouter(options.testSources));

  // Public agent endpoint (no auth required for enrollment — has its own stricter limiter)
  router.use(agentEnrollmentRouter);

  // Agent device rate limiter (separate from global UI limiter).
  //
  // Window/budget: a healthy agent's *default* cadence is poll every 30s
  // (2/min) + heartbeat every 60s (1/min) = 3/min at idle, plus per-task
  // result POSTs and hourly update checks. The 60s window with a 30-request
  // budget gives ~10x headroom over idle so normal operation never trips,
  // and — critically — recovers in <=60s if it ever does. The previous
  // 100/15min budget (6.6/min) sat barely 2x over baseline and recovered
  // only after a full 15min; a tripped agent would miss 3+ heartbeats
  // (HEARTBEAT_TIMEOUT_SECONDS=180) and be marked offline, manufacturing the
  // exact disconnect cascade this limiter sits next to.
  //
  // Keyed on IP + Agent-ID (see agentDeviceKey) so each enrolled agent gets
  // its own budget even when a whole fleet shares one NAT egress IP.
  const agentDeviceLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 30,                      // 30 requests per minute per agent+IP (~10x idle)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: agentDeviceKey,
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
