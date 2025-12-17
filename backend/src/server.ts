import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import http from 'http';
import crypto from 'crypto';

import { clerkAuth, linkClerkSession } from './middleware/clerk.middleware.js';
import { csrfTokenSetter, csrfProtection } from './middleware/csrf.middleware.js';
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

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://clerk.accountable.security", "https://*.clerk.accounts.dev"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://clerk.accountable.security", "https://*.clerk.accounts.dev", "https://api.limacharlie.io", "https://jwt.limacharlie.io"],
      frameSrc: ["'self'", "https://clerk.accountable.security", "https://*.clerk.accounts.dev"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Required for Clerk iframe
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  frameguard: { action: 'deny' },
}));

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  CORS_ORIGIN not set in production - defaulting to localhost (this is likely wrong!)');
}
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check against allowed origin(s)
    const allowedOrigins = corsOrigin.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Request logging
app.use(morgan('dev'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Generate random session secret for development (regenerates on restart)
const getSessionSecret = (): string => {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET environment variable must be set in production');
  }
  const devSecret = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  Generated random session secret for development - sessions will not persist across restarts');
  return devSecret;
};

// Session management (for endpoints auth)
app.use(session({
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax', // Use 'lax' for security; 'strict' may break OAuth flows
  },
}));

// Clerk authentication middleware
app.use(clerkAuth);
app.use(linkClerkSession);

// CSRF token setter (sets cookie on all responses)
app.use(csrfTokenSetter);

// Rate limiting configuration
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute for general API
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 write requests per minute
  message: { error: 'Too many write requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============ ROUTES ============

// Health check (no rate limiting)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ProjectAchilles',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Browser module - Public (test browsing)
app.use('/api/browser', apiLimiter, browserRoutes);

// Analytics module - Settings-based auth (Elasticsearch)
app.use('/api/analytics', apiLimiter, analyticsRoutes);

// Endpoints module - Session-based auth (LimaCharlie) with CSRF protection
app.use('/api/auth', authLimiter, csrfProtection, endpointAuthRoutes);
app.use('/api/endpoints', writeLimiter, csrfProtection, endpointsRoutes);

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
