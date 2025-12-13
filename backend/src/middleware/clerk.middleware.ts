import { clerkMiddleware, requireAuth } from '@clerk/express';
import { Request, NextFunction } from 'express';

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
