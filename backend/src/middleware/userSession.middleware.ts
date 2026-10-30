import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { isUserSession, safeClerkAuth } from './clerkAuthHelpers.js';

/**
 * Allows only a real Clerk browser session. API-key and CLI auth attach
 * synthetic `req.auth` objects without a `tokenType`, so they are refused.
 * Use after requireClerkAuth() on writes that must never be reachable with a
 * bearer credential.
 */
export function requireUserSession(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isUserSession(safeClerkAuth(req) ?? {})) {
      res.status(403).json({ success: false, error: 'This action requires a signed-in user session' });
      return;
    }
    next();
  };
}
