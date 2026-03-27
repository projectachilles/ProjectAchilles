import { clerkMiddleware, requireAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../services/agent/database.js';
import type { AppRole, Permission } from '../types/roles.js';
import { hasPermissions } from '../types/roles.js';
import { AppError } from './error.middleware.js';

/**
 * Clerk authentication middleware
 * Verifies JWT from Authorization header
 * Adds req.auth with user info
 */
export const clerkAuth = clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
});

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
function getUserOrgId(auth: any): string | undefined {
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
 * Middleware factory: require one or more permissions.
 * Extracts the role from the JWT, expands to the permission set, and checks inclusion.
 * If the user has no role set, all permissions are granted (backward-compatible migration).
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = getUserRole(req.auth);
    if (hasPermissions(role, ...permissions)) {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'Insufficient permissions' });
  };
}
