import { clerkMiddleware, requireAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../services/agent/database.js';

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
  return auth?.userId || auth?.sub || auth?.subject || auth?.id;
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
    // If Clerk Organizations isn't configured, we can't enforce org access.
    // Log a warning but allow through — the operator should enable Clerk Orgs.
    console.warn('[requireOrgAccess] No org claim in JWT — org access check skipped. Enable Clerk Organizations for enforcement.');
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
    // If Clerk Organizations isn't configured, skip enforcement
    console.warn('[requireAgentOrgAccess] No org claim in JWT — org access check skipped.');
    next();
    return;
  }

  const db = getDatabase();
  const row = db.prepare('SELECT org_id FROM agents WHERE id = ?').get(agentId) as { org_id: string } | undefined;
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
}

/**
 * Link Clerk user to session
 * Stores Clerk user ID in session for tracking
 */
export function linkClerkSession(req: Request, _res: unknown, next: NextFunction) {
  const userId = getUserId(req.auth);
  if (userId) {
    req.session.clerkUserId = userId;
  }
  next();
}
