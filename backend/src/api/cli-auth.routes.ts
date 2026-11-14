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
import { validate } from '../middleware/validation.js';
import { VerifyCodeSchema, PollDeviceCodeSchema, RefreshTokenSchema } from '../schemas/cli.schemas.js';
import { getDatabase } from '../services/agent/database.js';
import type { AppRole } from '../types/roles.js';
import { revokeCliSessions } from '../services/cliSessions.js';

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

/**
 * The Clerk user behind a CLI session, as they are now. Every token the CLI
 * flow issues (first sign-in and each refresh) goes through this, so a user
 * removed or demoted since they approved the code gets no token, or one with
 * their current role.
 *
 *   - deleted or banned: their CLI sessions are ended, 401;
 *   - locked (temporary, failed sign-in attempts): 401, sessions kept;
 *   - Clerk unreachable: 503. We don't issue a token for a user we can't
 *     vouch for, and nothing is deleted, so the CLI can try again.
 */
async function loadActiveCliUser(userId: string): Promise<{
  role: AppRole | null;
  email: string | undefined;
  displayName: string | undefined;
}> {
  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    user = await clerkClient.users.getUser(userId);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) {
      revokeCliSessions(userId);
      throw new AppError('This account can no longer sign in', 401);
    }
    throw new AppError('Could not confirm your account. Try again shortly.', 503);
  }
  if (user.banned) {
    revokeCliSessions(userId);
    throw new AppError('This account can no longer sign in', 401);
  }
  if (user.locked) {
    throw new AppError('This account is locked. Try again later.', 401);
  }
  return {
    role: getUserRole({ sessionClaims: { metadata: user.publicMetadata } }) ?? null,
    email: user.emailAddresses?.[0]?.emailAddress,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
  };
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
router.post('/verify', requireClerkAuth(), validate(VerifyCodeSchema), asyncHandler(async (req, res) => {
  const { user_code } = req.body;

  const auth = (req as any).auth;
  const userId = getUserId(auth);
  const orgId = auth?.orgId ?? auth?.sessionClaims?.org_id ?? auth?.sessionClaims?.metadata?.org_id ?? 'default';
  const role = getUserRole(auth);

  if (!userId) throw new AppError('Could not extract user ID from session', 401);

  const db = getDatabase();

  // First check if this code exists and hasn't expired
  const code = db.prepare(`
    SELECT * FROM cli_auth_codes
    WHERE user_code = ? AND expires_at > ?
  `).get(user_code, new Date().toISOString()) as { device_code_hash: string; user_code: string; expires_at: string; verified_at: string | null; user_id: string | null } | undefined;

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
router.post('/poll', pollLimiter, validate(PollDeviceCodeSchema), asyncHandler(async (req, res) => {
  const { device_code } = req.body;

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

  // Verified. The role stored on the code is the one the user had when they
  // approved it; they may have been removed or demoted since, so the token is
  // issued for the user as Clerk has them now.
  const { role, email, displayName } = await loadActiveCliUser(code.user_id);

  const secret = getCliSecret();
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CLI_TOKEN_TTL_SECONDS * 1000).toISOString();

  // A device code is good for one sign-in. The check above waits on Clerk, so
  // by now another poll of this code may have used it, or the user's CLI
  // sessions may have been ended (which deletes it). Take the code and store
  // the refresh token in one step, and issue nothing unless this request is
  // the one that took it.
  const userId = code.user_id;
  const claimed = db.transaction(() => {
    const taken = db.prepare(`
      DELETE FROM cli_auth_codes
      WHERE device_code_hash = ? AND user_id = ? AND verified_at IS NOT NULL
    `).run(deviceCodeHash, userId);
    if (taken.changes !== 1) return false;
    db.prepare(`
      INSERT OR REPLACE INTO cli_refresh_tokens (token_hash, user_id, org_id, role, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      crypto.createHash('sha256').update(refreshToken).digest('hex'),
      userId,
      code.org_id,
      role,
      expiresAt,
    );
    return true;
  })();
  if (!claimed) {
    // Same answer as any later poll of a code that is gone.
    throw new AppError('Unknown device code', 404);
  }

  const accessToken = jwt.sign(
    {
      sub: code.user_id,
      org_id: code.org_id,
      role,
      type: 'cli',
    },
    secret,
    {
      expiresIn: CLI_TOKEN_TTL_SECONDS,
      issuer: 'projectachilles',
      audience: process.env.AGENT_SERVER_URL || 'http://localhost:3000',
    },
  );

  res.json({
    success: true,
    data: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      user_id: code.user_id,
      org_id: code.org_id,
      role,
      email,
      display_name: displayName,
    },
  });
}));

/**
 * POST /api/cli/auth/refresh
 * Refresh a CLI session token using a refresh token.
 */
router.post('/refresh', refreshLimiter, validate(RefreshTokenSchema), asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  const db = getDatabase();

  // expires_at is a JS ISO string: compare it with one, not datetime('now').
  const stored = db.prepare(`
    SELECT * FROM cli_refresh_tokens
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash, new Date().toISOString()) as {
    user_id: string;
    org_id: string;
    role: string | null;
    expires_at: string;
  } | undefined;

  if (!stored) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Before extending the session, confirm the user still exists and may sign
  // in, and take their role as it is now.
  const { role } = await loadActiveCliUser(stored.user_id);

  // Issue new access token
  const secret = getCliSecret();
  const newExpiresAt = new Date(Date.now() + CLI_TOKEN_TTL_SECONDS * 1000).toISOString();
  const accessToken = jwt.sign(
    {
      sub: stored.user_id,
      org_id: stored.org_id,
      role,
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
    role,
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
