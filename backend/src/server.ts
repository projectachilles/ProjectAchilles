import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import http from 'http';

import { clerkAuth, linkClerkSession } from './middleware/clerk.middleware.js';
import browserRoutes from './api/browser.routes.js';
import analyticsRoutes from './api/analytics.routes.js';
import endpointAuthRoutes from './api/endpoints/auth.routes.js';
import endpointsRoutes from './api/endpoints/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
  console.error('❌ CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be set');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy (required for secure cookies behind proxy)
app.set('trust proxy', 1);

// ============ MIDDLEWARE ============

// Security headers (relaxed for development)
app.use(helmet({
  contentSecurityPolicy: false,
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

// Session management (for endpoints auth)
app.use(session({
  secret: process.env.SESSION_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set in production');
    }
    console.warn('⚠️  Using development session secret - DO NOT use in production!');
    return 'project-achilles-dev-secret';
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Clerk authentication middleware
app.use(clerkAuth);
app.use(linkClerkSession);

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { error: 'Too many authentication attempts, please try again later' },
});

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

// Browser module - Public (test browsing)
app.use('/api/browser', browserRoutes);

// Analytics module - Settings-based auth (Elasticsearch)
app.use('/api/analytics', analyticsRoutes);

// Endpoints module - Session-based auth (LimaCharlie)
app.use('/api/auth', authLimiter, endpointAuthRoutes);
app.use('/api/endpoints', endpointsRoutes);

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
  console.log('║     /api/auth/*        - Endpoint Auth (LimaCharlie)      ║');
  console.log('║     /api/endpoints/*   - Endpoint Management              ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
});

export default app;
