import cluster from 'node:cluster';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

import { clerkAuth } from './middleware/clerk.middleware.js';
import { createBrowserRouter } from './api/browser.routes.js';
import analyticsRoutes from './api/analytics.routes.js';
import { createTestsRouter } from './api/tests.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { GitSyncService } from './services/browser/gitSyncService.js';
import { GitHubMetadataService } from './services/browser/githubMetadataService.js';
import { createAgentRouter } from './api/agent/index.js';
import usersRoutes from './api/users.routes.js';
import integrationsRoutes, { alertsService } from './api/integrations.routes.js';
import { processSchedules } from './services/agent/schedules.service.js';
import { processAutoRotation } from './services/agent/autoRotation.service.js';
import { pruneHeartbeatHistory, detectOfflineAgents } from './services/agent/heartbeat.service.js';
import { initCatalog } from './services/agent/test-catalog.service.js';
import type { TestSource } from './types/test.js';
import { IntegrationsSettingsService } from './services/integrations/settings.js';
import { defenderSyncService } from './api/integrations.routes.js';
import defenderRoutes from './api/defender.routes.js';
import riskAcceptanceRoutes from './api/risk-acceptance.routes.js';
import cliAuthRoutes from './api/cli-auth.routes.js';
import { acceptCliAuth } from './middleware/cliAuth.middleware.js';
import authRoutes from './api/auth.routes.js';
import authProvidersRoutes from './api/auth-providers.routes.js';
import { acceptBasicAuth } from './middleware/basicAuth.middleware.js';
import { printBasicAuthCredentials } from './services/auth/basic.service.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Validate required environment variables (warn instead of exit for local/demo usage)
const hasClerkKeys = process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  && !process.env.CLERK_PUBLISHABLE_KEY.endsWith('...')
  && !process.env.CLERK_SECRET_KEY.endsWith('...');
if (!hasClerkKeys) {
  console.warn('⚠ Clerk keys not configured — running without authentication (demo mode)');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy hops: configure per deployment topology (default 1 for PaaS)
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));

// ============ MIDDLEWARE ============

// Security headers with Content Security Policy
// PA-012: unsafe-inline required for scriptSrc (Clerk SDK v5 injects inline scripts
// for session init/token refresh — no nonce support as of 2026-03). Mitigated by
// restricting all other directives and adding form-action/frame-ancestors.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://*.clerk.com", "https://*.clerk.accounts.dev"],
      frameSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  // Add for Clerk authentication flows
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization', 'Content-Disposition'],
}));

// Request logging
app.use(morgan('dev'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check — before auth so it works without credentials
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ProjectAchilles',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Auth login endpoint — public, before any auth middleware
app.use('/api/auth', authRoutes);
app.use('/api/auth', authProvidersRoutes);

// Basic auth JWT middleware — validates our own JWTs
app.use(acceptBasicAuth());

// Clerk authentication middleware (parses JWT, populates req.auth — does NOT reject)
if (hasClerkKeys) {
  app.use(clerkAuth);
}

// CLI token auth — if a valid CLI JWT is present and Clerk didn't parse anything,
// inject a Clerk-compatible req.auth so downstream requireClerkAuth() works.
app.use(acceptCliAuth());

// Global API rate limiter (dashboard/UI traffic only)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,                 // 1000 requests per 15-minute window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
  skip: (req) => {
    // Agent device endpoints have their own dedicated rate limiter
    const p = req.originalUrl;
    return p.startsWith('/api/agent/') && !p.startsWith('/api/agent/admin/');
  },
});
app.use('/api', apiLimiter);

// ============ ASYNC STARTUP ============
async function startServer() {
  // ============ GIT SYNC INITIALIZATION ============
  let gitSyncService: GitSyncService | undefined;
  let testsSourcePath: string;

  // Check if Git sync is configured (defaults to f0_library — zero-config once public)
  const DEFAULT_TESTS_REPO_URL = 'https://github.com/ubercylon8/f0_library.git';
  const repoUrl = process.env.TESTS_REPO_URL ?? DEFAULT_TESTS_REPO_URL;
  if (repoUrl) {
    console.log('');
    console.log('📦 Initializing test repository sync...');

    gitSyncService = new GitSyncService({
      repoUrl,
      branch: process.env.TESTS_REPO_BRANCH || 'main',
      localPath: process.env.TESTS_LOCAL_PATH || path.resolve(__dirname, '../../data/f0_library'),
      githubToken: process.env.GITHUB_TOKEN,
    });

    try {
      // Ensure repo is cloned (clone if missing, use existing if present)
      await gitSyncService.ensureRepo();
      testsSourcePath = gitSyncService.getTestsSourcePath();
      console.log(`✓ Test repository ready at: ${testsSourcePath}`);
    } catch (error) {
      console.warn('⚠ Failed to sync test repository:', error instanceof Error ? error.message : error);
      console.warn('  Browser module will start without tests. Use /api/browser/tests/sync to retry.');
      // Fallback to the repo's tests_source path even if sync failed
      testsSourcePath = gitSyncService.getTestsSourcePath();
    }
  } else {
    // No Git sync configured - use local TESTS_SOURCE_PATH
    testsSourcePath = process.env.TESTS_SOURCE_PATH || path.resolve(__dirname, '../../tests_source');
    console.log(`📁 Using local tests source: ${testsSourcePath}`);
  }

  // ============ MULTI-SOURCE TEST LIBRARY ============
  const customTestsPath = process.env.CUSTOM_TESTS_PATH
    || path.join(os.homedir(), '.projectachilles', 'custom-tests');

  // Create custom tests dir on first run (follows ~/.projectachilles pattern)
  if (!fs.existsSync(customTestsPath)) {
    fs.mkdirSync(customTestsPath, { recursive: true });
  }

  // Custom source listed first → custom tests win UUID collisions
  const testSources: TestSource[] = [
    { path: customTestsPath, provenance: 'custom' },
    { path: testsSourcePath, provenance: 'upstream' },
  ];

  // ============ TEST CATALOG ============
  initCatalog(testSources);

  // ============ GITHUB METADATA SERVICE ============
  let githubMetadata: GitHubMetadataService | undefined;
  if (repoUrl && process.env.GITHUB_TOKEN) {
    try {
      githubMetadata = new GitHubMetadataService({
        repoUrl,
        branch: process.env.TESTS_REPO_BRANCH || 'main',
        githubToken: process.env.GITHUB_TOKEN,
      });
      console.log('✓ GitHub metadata service initialized');
    } catch (error) {
      console.warn('⚠ GitHub metadata service unavailable:', error instanceof Error ? error.message : error);
    }
  }

  // ============ AGENT SOURCE GIT SYNC ============
  let agentSourcePath: string;

  const agentRepoUrl = process.env.AGENT_REPO_URL;
  if (agentRepoUrl) {
    console.log('');
    console.log('📦 Initializing agent source sync...');

    const agentGitSync = new GitSyncService({
      repoUrl: agentRepoUrl,
      branch: process.env.AGENT_REPO_BRANCH || 'main',
      localPath: process.env.AGENT_LOCAL_PATH || path.resolve(__dirname, '../../data/agent-source'),
      githubToken: process.env.GITHUB_TOKEN,
      sparseCheckoutPaths: ['agent'],
      sourceSubdir: 'agent',
    });

    try {
      await agentGitSync.ensureRepo();
      agentSourcePath = agentGitSync.getSourcePath();
      console.log(`✓ Agent source ready at: ${agentSourcePath}`);
    } catch (error) {
      console.warn('⚠ Failed to sync agent source:', error instanceof Error ? error.message : error);
      agentSourcePath = process.env.AGENT_SOURCE_PATH || path.resolve(__dirname, '../../agent');
      console.warn(`  Falling back to: ${agentSourcePath}`);
    }
  } else {
    agentSourcePath = process.env.AGENT_SOURCE_PATH || path.resolve(__dirname, '../../agent');
    console.log(`📁 Using local agent source: ${agentSourcePath}`);
  }

  // ============ ROUTES ============

  // Capabilities endpoint — tells frontend what features are available
  app.get('/api/capabilities', (_req, res) => {
    res.json({
      build: true,
      buildUpload: true,
      certGenerate: true,
      certUpload: true,
      gitSync: true,
      agentBuild: true,
      platform: 'docker',
    });
  });

  // Browser module - with Git sync integration
  const browserRouter = createBrowserRouter({
    testSources,
    testsSourcePath,         // git sync scope (upstream path only)
    gitSync: gitSyncService,
    githubMetadata,
  });
  app.use('/api/browser', browserRouter);

  // Analytics module - Settings-based auth (Elasticsearch)
  app.use('/api/analytics', analyticsRoutes);

  // Tests module - Platform, certificate & build settings
  const testsRouter = createTestsRouter({
    testSourcePaths: testSources.map(s => s.path),
    testsSourcePath,
  });
  app.use('/api/tests', testsRouter);

  // Agent module - Achilles Agent management
  app.use('/api/agent', createAgentRouter({ testSources, testsSourcePath, agentSourcePath }));

  // User management - RBAC role assignment (admin-only)
  app.use('/api/users', usersRoutes);

  // Integrations - external service credentials (Azure, etc.)
  app.use('/api/integrations', integrationsRoutes);

  // Defender analytics - Secure Score, alerts, controls
  app.use('/api/analytics/defender', defenderRoutes);

  // Risk acceptance - formal risk acceptance for security controls
  app.use('/api/risk-acceptances', riskAcceptanceRoutes);

  // CLI auth - device flow for headless CLI authentication
  app.use('/api/cli/auth', cliAuthRoutes);

  // ============ ERROR HANDLING ============
  app.use(notFoundHandler);
  app.use(errorHandler);

  // ============ SERVER ============
  const httpServer = http.createServer(app);

  httpServer.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   ProjectAchilles Backend Server                          ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║   Running on: http://localhost:${PORT}                         ║`);
    console.log('║                                                           ║');
    console.log('║   Routes:                                                 ║');
    console.log('║     /api/browser/*     - Security Test Browser            ║');
    console.log('║     /api/analytics/*   - Test Results Analytics           ║');
    console.log('║     /api/agent/*       - Achilles Agent Management        ║');
    console.log('║                                                           ║');
    if (gitSyncService) {
      const status = gitSyncService.getStatus();
      console.log(`║   Tests: ${status.testCount || 0} tests from ${status.branch} branch             ║`);
    }
    console.log('╚═══════════════════════════════════════════════════════════╝');

    // Print basic auth credentials (always available as a fallback auth method)
    printBasicAuthCredentials();

    // Background jobs only run in single-process mode (no clustering) or
    // cluster primary. In cluster mode, workers skip these to avoid duplicates.
    if (!cluster.isWorker) {
      startBackgroundJobs(httpServer);
    } else {
      // Worker: just handle graceful shutdown for HTTP
      const shutdown = () => { httpServer.close(); };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    }
  });
}

/**
 * Start all periodic background jobs. Runs in a single process only:
 * either the lone process (no clustering) or the cluster primary.
 */
function startBackgroundJobs(httpServer?: http.Server) {
  // --- Task scheduler: process due schedules every 60s ---
  processSchedules(); // Startup recovery: catch up on past-due schedules
  const schedulerInterval = setInterval(processSchedules, 60_000);

  // --- Auto key rotation: check every 60s ---
  const autoRotationInterval = setInterval(processAutoRotation, 60_000);

  // --- Heartbeat history pruning: every hour ---
  const heartbeatPruneInterval = setInterval(pruneHeartbeatHistory, 60 * 60 * 1000);

  // --- Offline agent detection + agent alerts: every 60s ---
  const offlineDetectionInterval = setInterval(() => {
    detectOfflineAgents();
    alertsService.evaluateAgentAlerts().catch((err: unknown) => {
      console.error('[Agent Alerts] Evaluation failed:', err);
    });
  }, 60_000);

  // --- Defender sync: scores every 6h, alerts every 5min ---
  let defenderScoreInterval: ReturnType<typeof setInterval> | undefined;
  let defenderAlertInterval: ReturnType<typeof setInterval> | undefined;

  const integrationsSettings = new IntegrationsSettingsService();
  if (integrationsSettings.isDefenderConfigured()) {
    console.log('🛡  Defender integration configured — starting background sync');
    defenderSyncService.syncAll().catch((err) => {
      console.warn('⚠ Initial Defender sync failed:', err instanceof Error ? err.message : err);
    });
    defenderScoreInterval = setInterval(() => {
      defenderSyncService.syncSecureScores().catch(() => {});
      defenderSyncService.syncControlProfiles().catch(() => {});
    }, 6 * 60 * 60 * 1000); // 6 hours
    defenderAlertInterval = setInterval(() => {
      defenderSyncService.syncAlerts().catch(() => {});
    }, 5 * 60 * 1000); // 5 minutes
  }

  const shutdown = () => {
    clearInterval(schedulerInterval);
    clearInterval(autoRotationInterval);
    clearInterval(heartbeatPruneInterval);
    clearInterval(offlineDetectionInterval);
    if (defenderScoreInterval) clearInterval(defenderScoreInterval);
    if (defenderAlertInterval) clearInterval(defenderAlertInterval);
    if (httpServer) httpServer.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ============ CLUSTER MODE ============
// CLUSTER_WORKERS env var controls parallelism:
//   unset / 0 / 1 → single-process (current behavior, backward-compatible)
//   2-8           → cluster mode (primary manages workers + background jobs)
const CLUSTER_WORKERS = Math.max(0, parseInt(process.env.CLUSTER_WORKERS || '0', 10) || 0);

if (cluster.isPrimary && CLUSTER_WORKERS > 1) {
  dotenv.config(); // ensure env is loaded in primary

  console.log(`[cluster] Primary ${process.pid} forking ${CLUSTER_WORKERS} workers`);
  for (let i = 0; i < CLUSTER_WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    if (!worker.exitedAfterDisconnect) {
      console.warn(`[cluster] Worker ${worker.process.pid} died (${signal || code}), restarting`);
      cluster.fork();
    }
  });

  // Background jobs run in primary only — no HTTP server here
  startBackgroundJobs();

} else {
  // Single-process mode OR cluster worker: run Express
  startServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}

export default app;
