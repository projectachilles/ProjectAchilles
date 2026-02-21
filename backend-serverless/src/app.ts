import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';

import { clerkAuth } from './middleware/clerk.middleware.js';
import { createBrowserRouter } from './api/browser.routes.js';
import analyticsRoutes from './api/analytics.routes.js';
import { createTestsRouter } from './api/tests.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { createAgentRouter } from './api/agent/index.js';
import usersRoutes from './api/users.routes.js';
import cronRoutes from './api/cron.routes.js';
import { initCatalog } from './services/agent/test-catalog.service.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
  console.error('CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be set');
  process.exit(1);
}

const app = express();

// Trust proxy (Vercel reverse proxy)
app.set('trust proxy', 1);

// ============ MIDDLEWARE ============

// Security headers
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
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization'],
}));

// Request logging (short format for serverless — less noise)
app.use(morgan('short'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Clerk authentication middleware
app.use(clerkAuth);

// Global API rate limiter (dashboard/UI traffic only)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
  skip: (req) => {
    const p = req.originalUrl;
    // Skip for agent device endpoints and cron endpoints
    return (p.startsWith('/api/agent/') && !p.startsWith('/api/agent/admin/'))
      || p.startsWith('/api/cron/');
  },
});
app.use('/api', apiLimiter);

// ============ INITIALIZATION ============

// Tests source path: baked in at build time via vercel-build script
// In Vercel runtime, process.cwd() is /var/task — __dirname is unreliable
// because @vercel/node bundles the source and changes the directory layout.
const testsSourcePath = process.env.TESTS_SOURCE_PATH
  || path.resolve(process.cwd(), 'data/f0_library/tests_source');

// Initialize test catalog (lazy — scans on first request or at module load)
initCatalog(testsSourcePath);

// ============ ROUTES ============

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ProjectAchilles',
    platform: 'vercel',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Capabilities endpoint — tells frontend what features are available
app.get('/api/capabilities', (_req, res) => {
  res.json({
    build: false,
    certGenerate: false,
    certUpload: true,
    gitSync: false,
    agentBuild: false,
    platform: 'vercel',
  });
});

// Cron routes (Vercel Crons — protected by CRON_SECRET)
app.use('/api/cron', cronRoutes);

// Browser module — no git sync, reads from build-time clone
const browserRouter = createBrowserRouter({
  testsSourcePath,
  // No gitSync or githubMetadata in serverless
});
app.use('/api/browser', browserRouter);

// Analytics module
app.use('/api/analytics', analyticsRoutes);

// Tests module — platform, certificate & build settings
const testsRouter = createTestsRouter({ testsSourcePath });
app.use('/api/tests', testsRouter);

// Agent module
app.use('/api/agent', createAgentRouter({ testsSourcePath }));

// User management
app.use('/api/users', usersRoutes);

// ============ ERROR HANDLING ============
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
