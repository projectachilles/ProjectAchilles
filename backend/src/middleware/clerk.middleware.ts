import { clerkMiddleware, requireAuth } from '@clerk/express';
import { Request, Response, NextFunction } from 'express';

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
  return requireAuth({
    unauthorizedUrl: '/api/auth/unauthorized',
  });
}

/**
 * Link Clerk user to session
 * Stores Clerk user ID in session for tracking
 */
export function linkClerkSession(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.userId) {
    req.session.clerkUserId = req.auth.userId;
  }
  next();
}
