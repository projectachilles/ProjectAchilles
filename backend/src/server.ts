import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
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
import { processSchedules } from './services/agent/schedules.service.js';
import { initCatalog } from './services/agent/test-catalog.service.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
  console.error('❌ CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be set');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy chain: client → ngrok → nginx → Express (2 hops)
app.set('trust proxy', 2);

// ============ MIDDLEWARE ============

// Security headers with Content Security Policy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],       // Clerk SDK needs inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],         // Tailwind
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://*.clerk.com", "https://*.clerk.accounts.dev"],
      frameSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
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
  exposedHeaders: ['Authorization'],
}));

// Request logging
app.use(morgan('dev'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Clerk authentication middleware
app.use(clerkAuth);

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

  // Check if Git sync is configured
  const repoUrl = process.env.TESTS_REPO_URL;
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

  // ============ TEST CATALOG ============
  initCatalog(testsSourcePath);

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

  // ============ ROUTES ============

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ProjectAchilles',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // Browser module - with Git sync integration
  const browserRouter = createBrowserRouter({
    testsSourcePath,
    gitSync: gitSyncService,
    githubMetadata,
  });
  app.use('/api/browser', browserRouter);

  // Analytics module - Settings-based auth (Elasticsearch)
  app.use('/api/analytics', analyticsRoutes);

  // Tests module - Platform, certificate & build settings
  const testsRouter = createTestsRouter({ testsSourcePath });
  app.use('/api/tests', testsRouter);

  // Agent module - Achilles Agent management
  const agentSourcePath = process.env.AGENT_SOURCE_PATH || path.resolve(__dirname, '../../agent');
  app.use('/api/agent', createAgentRouter({ testsSourcePath, agentSourcePath }));

  // User management - RBAC role assignment (admin-only)
  app.use('/api/users', usersRoutes);

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
    console.log('');

    // --- Task scheduler: process due schedules every 60s ---
    processSchedules(); // Startup recovery: catch up on past-due schedules
    const schedulerInterval = setInterval(processSchedules, 60_000);

    const shutdown = () => {
      clearInterval(schedulerInterval);
      httpServer.close();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

export default app;
