/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern for CSRF protection
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'x-csrf-token';

// Extend session type to include csrfToken
declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
  }
}

/**
 * Generate a cryptographically secure CSRF token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Middleware to set CSRF token cookie on every response
 * The cookie is readable by JavaScript (not httpOnly) so the frontend can read it
 */
export function csrfTokenSetter(req: Request, res: Response, next: NextFunction): void {
  // Generate token if not present in session
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }

  // Set the token as a readable cookie for the frontend
  if (req.session?.csrfToken) {
    res.cookie(CSRF_COOKIE_NAME, req.session.csrfToken, {
      httpOnly: false, // Must be readable by JavaScript
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }

  next();
}

/**
 * Middleware to validate CSRF token on state-changing requests
 * Only validates POST, PUT, DELETE, PATCH methods
 */
export function csrfValidator(req: Request, res: Response, next: NextFunction): void {
  // Skip CSRF validation for safe methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Skip for requests without a session (API key auth, etc.)
  if (!req.session?.csrfToken) {
    return next();
  }

  // Get token from header
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  // Validate token
  if (!headerToken || headerToken !== req.session.csrfToken) {
    res.status(403).json({
      success: false,
      error: 'Invalid or missing CSRF token',
    });
    return;
  }

  next();
}

/**
 * Combined middleware for routes that need CSRF protection
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  csrfTokenSetter(req, res, () => {
    csrfValidator(req, res, next);
  });
}
