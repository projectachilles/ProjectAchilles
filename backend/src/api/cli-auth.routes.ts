/**
 * CLI Device Authorization Flow
 *
 * Implements a device code grant for headless CLI authentication:
 * 1. CLI requests device code → backend generates code + verification URL
 * 2. User opens URL in browser, logs in via Clerk, enters code
 * 3. CLI polls until code is verified → receives JWT session token
 *
 * Device codes are stored in SQLite `cli_auth_codes` table with short TTL.
 */

import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { requireClerkAuth } from '../middleware/clerk.middleware.js';
import { getUserId, getUserRole } from '../middleware/clerk.middleware.js';
import { clerkClient } from '@clerk/express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { getDatabase } from '../services/agent/database.js';

const router = Router();

// ─── Rate limiters ──────────────────────────────────────────────────────────

const deviceCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many device code requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const pollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, error: 'Too many poll requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many refresh requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Constants ──────────────────────────────────────────────────────────────

const DEVICE_CODE_TTL_SECONDS = 600; // 10 minutes
const CLI_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour (refresh token extends the session)

function getCliSecret(): string {
  const secret = process.env.CLI_AUTH_SECRET;
  if (!secret) throw new AppError('CLI_AUTH_SECRET environment variable is required for CLI authentication. Generate one with: openssl rand -base64 32', 500);
  return secret;
}

function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
  const left = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  const right = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${left}-${right}`;
}

function generateDeviceCode(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

/**
 * POST /api/cli/auth/device-code
 * Generate a device code + user code for CLI login.
 * Public endpoint (rate-limited).
 */
router.post('/device-code', deviceCodeLimiter, asyncHandler(async (_req, res) => {
  const db = getDatabase();
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000).toISOString();

  // Hash the device code for storage (user code stored plain for lookup)
  const deviceCodeHash = crypto.createHash('sha256').update(deviceCode).digest('hex');

  db.prepare(`
    INSERT INTO cli_auth_codes (device_code_hash, user_code, expires_at)
    VALUES (?, ?, ?)
  `).run(deviceCodeHash, userCode, expiresAt);

  // Build verification URL from the frontend origin or fallback
  const frontendUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const verificationUrl = `${frontendUrl}/cli-auth?code=${encodeURIComponent(userCode)}`;

  res.json({
    success: true,
    data: {
      device_code: deviceCode,
      user_code: userCode,
      verification_url: verificationUrl,
      expires_at: expiresAt,
      poll_interval: 2,
    },
  });
}));

/**
 * POST /api/cli/auth/verify
 * Called from the browser after user logs in via Clerk and enters the code.
 * Requires Clerk authentication.
 */
router.post('/verify', requireClerkAuth(), asyncHandler(async (req, res) => {
  const { user_code } = req.body;
  if (!user_code || typeof user_code !== 'string') {
    throw new AppError('user_code is required', 400);
  }

  const auth = (req as any).auth;
  const userId = getUserId(auth);
  const orgId = auth?.orgId ?? auth?.sessionClaims?.org_id ?? auth?.sessionClaims?.metadata?.org_id ?? 'default';
  const role = getUserRole(auth);

  if (!userId) throw new AppError('Could not extract user ID from session', 401);

  const db = getDatabase();

  // First check if this code exists and hasn't expired
  const code = db.prepare(`
    SELECT * FROM cli_auth_codes
    WHERE user_code = ? AND expires_at > datetime('now')
  `).get(user_code) as { device_code_hash: string; user_code: string; expires_at: string; verified_at: string | null; user_id: string | null } | undefined;

  if (!code) {
    throw new AppError('Invalid or expired code', 400);
  }

  // Idempotent: if already verified by this user, return success
  if (code.verified_at && code.user_id) {
    res.json({ success: true, data: { message: 'Code already verified. CLI will be authenticated shortly.' } });
    return;
  }

  // Mark as verified with user info
  db.prepare(`
    UPDATE cli_auth_codes
    SET verified_at = datetime('now'), user_id = ?, org_id = ?, role = ?
    WHERE user_code = ?
  `).run(userId, orgId || 'default', role || null, user_code);

  res.json({ success: true, data: { message: 'Code verified. CLI will be authenticated shortly.' } });
}));

/**
 * POST /api/cli/auth/poll
 * CLI polls this endpoint with the device code until the user verifies.
 * Returns 202 (pending), 200 (verified + token), or 410 (expired).
 */
router.post('/poll', pollLimiter, asyncHandler(async (req, res) => {
  const { device_code } = req.body;
  if (!device_code || typeof device_code !== 'string') {
    throw new AppError('device_code is required', 400);
  }

  const deviceCodeHash = crypto.createHash('sha256').update(device_code).digest('hex');
  const db = getDatabase();

  const code = db.prepare(`
    SELECT * FROM cli_auth_codes WHERE device_code_hash = ?
  `).get(deviceCodeHash) as {
    device_code_hash: string;
    user_code: string;
    expires_at: string;
    verified_at: string | null;
    user_id: string | null;
    org_id: string | null;
    role: string | null;
  } | undefined;

  if (!code) {
    throw new AppError('Unknown device code', 404);
  }

  // Expired
  if (new Date(code.expires_at) < new Date()) {
    // Clean up
    db.prepare('DELETE FROM cli_auth_codes WHERE device_code_hash = ?').run(deviceCodeHash);
    return res.status(410).json({ success: false, error: 'Device code expired' });
  }

  // Not yet verified
  if (!code.verified_at || !code.user_id) {
    return res.status(202).json({ success: false, error: 'authorization_pending' });
  }

  // Verified — fetch user details from Clerk for display name
  let email: string | undefined;
  let displayName: string | undefined;
  try {
    const user = await clerkClient.users.getUser(code.user_id!);
    email = user.emailAddresses?.[0]?.emailAddress;
    displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
  } catch {
    // Non-fatal — user info is cosmetic
  }

  // Issue CLI token
  const secret = getCliSecret();
  const accessToken = jwt.sign(
    {
      sub: code.user_id,
      org_id: code.org_id,
      role: code.role,
      type: 'cli',
    },
    secret,
    {
      expiresIn: CLI_TOKEN_TTL_SECONDS,
      issuer: 'projectachilles',
      audience: process.env.AGENT_SERVER_URL || 'http://localhost:3000',
    },
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CLI_TOKEN_TTL_SECONDS * 1000).toISOString();

  // Store refresh token
  db.prepare(`
    INSERT OR REPLACE INTO cli_refresh_tokens (token_hash, user_id, org_id, role, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    crypto.createHash('sha256').update(refreshToken).digest('hex'),
    code.user_id,
    code.org_id,
    code.role,
    expiresAt,
  );

  // Clean up used device code
  db.prepare('DELETE FROM cli_auth_codes WHERE device_code_hash = ?').run(deviceCodeHash);

  res.json({
    success: true,
    data: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      user_id: code.user_id,
      org_id: code.org_id,
      role: code.role,
      email,
      display_name: displayName,
    },
  });
}));

/**
 * POST /api/cli/auth/refresh
 * Refresh a CLI session token using a refresh token.
 */
router.post('/refresh', refreshLimiter, asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token || typeof refresh_token !== 'string') {
    throw new AppError('refresh_token is required', 400);
  }

  const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  const db = getDatabase();

  const stored = db.prepare(`
    SELECT * FROM cli_refresh_tokens
    WHERE token_hash = ? AND expires_at > datetime('now')
  `).get(tokenHash) as {
    user_id: string;
    org_id: string;
    role: string | null;
    expires_at: string;
  } | undefined;

  if (!stored) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Issue new access token
  const secret = getCliSecret();
  const newExpiresAt = new Date(Date.now() + CLI_TOKEN_TTL_SECONDS * 1000).toISOString();
  const accessToken = jwt.sign(
    {
      sub: stored.user_id,
      org_id: stored.org_id,
      role: stored.role,
      type: 'cli',
    },
    secret,
    {
      expiresIn: CLI_TOKEN_TTL_SECONDS,
      issuer: 'projectachilles',
      audience: process.env.AGENT_SERVER_URL || 'http://localhost:3000',
    },
  );

  // Rotate refresh token
  const newRefreshToken = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM cli_refresh_tokens WHERE token_hash = ?').run(tokenHash);
  db.prepare(`
    INSERT INTO cli_refresh_tokens (token_hash, user_id, org_id, role, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    crypto.createHash('sha256').update(newRefreshToken).digest('hex'),
    stored.user_id,
    stored.org_id,
    stored.role,
    newExpiresAt,
  );

  res.json({
    success: true,
    data: {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      expires_at: newExpiresAt,
    },
  });
}));

export default router;
