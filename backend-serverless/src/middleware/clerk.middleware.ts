import { clerkMiddleware, requireAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../services/agent/database.js';
import type { AppRole, Permission } from '../types/roles.js';
import { hasPermissions } from '../types/roles.js';
import { AppError } from './error.middleware.js';

const clerkSessionAuth = clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
});

/** A Clerk session token (or a CLI token) is a JWT: three base64url segments. */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/**
 * Clerk authentication middleware: verifies the Clerk session (cookie or
 * Bearer JWT) and sets req.auth. It never rejects; route guards do.
 *
 * clerkMiddleware forces `acceptsToken: 'any'`, so it treats any Bearer token
 * shaped like a Clerk machine token as one and verifies it against Clerk's
 * Backend API. Agent keys start with `ak_`, Clerk's API-key prefix, so every
 * agent poll and heartbeat sent the agent's key to POST api.clerk.com
 * /api_keys/verify (~140 ms each). Deployment tokens must never leave the
 * deployment, and Achilles uses no Clerk machine tokens, so Clerk only sees
 * JWT-shaped bearers: for anything else the Authorization header is hidden
 * while Clerk runs (the request is signed out to Clerk, req.auth still set)
 * and restored for the agent / API-key middleware that owns it.
 */
export function clerkAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!header || (bearer !== null && JWT_SHAPE.test(bearer))) {
    clerkSessionAuth(req, res, next);
    return;
  }
  delete req.headers.authorization;
  clerkSessionAuth(req, res, (err?: unknown) => {
    req.headers.authorization = header;
    next(err);
  });
}

/**
 * Require Clerk authentication
 * Returns 401 if user is not authenticated
 */
export function requireClerkAuth() {
  return requireAuth();
}

/**
 * Get user ID from Clerk auth object
 * Handles different Clerk SDK versions and auth object structures
 */
export function getUserId(auth: any): string | undefined {
  return auth?.userId ?? auth?.sub ?? auth?.subject ?? auth?.id;
}

/**
 * Extract the user's organization ID from Clerk auth.
 * Checks: orgId (Clerk Organizations), sessionClaims.org_id (custom claim), sessionClaims.metadata.org_id.
 */
export function getUserOrgId(auth: any): string | undefined {
  return auth?.orgId
    ?? auth?.sessionClaims?.org_id
    ?? auth?.sessionClaims?.metadata?.org_id
    ?? undefined;
}

/**
 * Middleware: Verify the requesting user has access to the org_id in query or body.
 * Requires Clerk auth to have been applied first.
 */
export function requireOrgAccess(req: Request, res: Response, next: NextFunction): void {
  const requestedOrgId = (req.query.org_id as string | undefined) || req.body?.org_id;
  if (!requestedOrgId) {
    // Routes that don't supply an org_id are allowed through (e.g., resource-specific routes)
    next();
    return;
  }

  const userOrgId = getUserOrgId(req.auth);

  if (!userOrgId) {
    if (process.env.REQUIRE_ORG_ISOLATION === 'true') {
      res.status(403).json({ success: false, error: 'Organization isolation required. Configure Clerk Organizations.' });
      return;
    }
    console.warn('[requireOrgAccess] No org claim in JWT — org access check skipped. Set REQUIRE_ORG_ISOLATION=true to enforce.');
    next();
    return;
  }

  if (userOrgId !== requestedOrgId) {
    res.status(403).json({ success: false, error: 'Access denied to this organization' });
    return;
  }

  next();
}

/**
 * Middleware: Verify the requesting user has access to an agent's org.
 * Looks up the agent's org_id from the DB and compares against the user's JWT claim.
 */
export function requireAgentOrgAccess(req: Request, res: Response, next: NextFunction): void {
  const agentId = req.params.id;
  if (!agentId) {
    next();
    return;
  }

  const userOrgId = getUserOrgId(req.auth);
  if (!userOrgId) {
    if (process.env.REQUIRE_ORG_ISOLATION === 'true') {
      res.status(403).json({ success: false, error: 'Organization isolation required. Configure Clerk Organizations.' });
      return;
    }
    console.warn('[requireAgentOrgAccess] No org claim in JWT — org access check skipped. Set REQUIRE_ORG_ISOLATION=true to enforce.');
    next();
    return;
  }

  (async () => {
    const db = await getDb();
    const row = await db.get('SELECT org_id FROM agents WHERE id = ?', [agentId]) as { org_id: string } | undefined;
    if (!row) {
      // Let the downstream handler return 404
      next();
      return;
    }

    if (row.org_id !== userOrgId) {
      res.status(403).json({ success: false, error: 'Access denied to this organization' });
      return;
    }

    next();
  })().catch(() => {
    res.status(500).json({ success: false, error: 'Internal server error' });
  });
}

/**
 * Validate that org_id in request body matches the user's JWT org claim.
 * Throws AppError(403) if they don't match. Skips check if user has no org claim
 * (backward compat with deployments without Clerk Organizations).
 */
export function validateRequestOrgId(reqOrgId: string, auth: any): void {
  const userOrgId = getUserOrgId(auth);
  if (userOrgId && reqOrgId !== userOrgId) {
    throw new AppError('org_id does not match your organization', 403);
  }
}

/**
 * Extract the user's role from Clerk session claims.
 * Returns undefined when no role is assigned (= explorer read-only access).
 */
export function getUserRole(auth: any): AppRole | undefined {
  const role = auth?.sessionClaims?.metadata?.role;
  if (role === 'admin' || role === 'operator' || role === 'analyst' || role === 'explorer') {
    return role;
  }
  return undefined;
}

/**
 * True when the request's principal holds every permission (Clerk role
 * only: backend-serverless has no API keys). Use it for optional sections a
 * route includes only for callers allowed to see them.
 */
export function hasRequestPermission(req: Request, ...permissions: Permission[]): boolean {
  return hasPermissions(getUserRole(req.auth), ...permissions);
}

/**
 * Middleware factory: require one or more permissions (see hasRequestPermission).
 * Extracts the role from the JWT, expands to the permission set, and checks inclusion.
 * If the user has no role set, hasPermissions() defaults to the explorer set (read-only).
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hasRequestPermission(req, ...permissions)) {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'Insufficient permissions' });
  };
}
