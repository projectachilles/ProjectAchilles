/**
 * CLI token authentication middleware.
 *
 * Validates JWT tokens issued by the CLI device flow.
 * Can be used alongside Clerk auth — checks if the token is a CLI token first,
 * then falls through to Clerk if not.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface CliTokenPayload {
  sub: string;
  org_id: string;
  role: string | null;
  type: 'cli';
  iat: number;
  exp: number;
}

function getCliSecret(): string | undefined {
  return process.env.CLI_AUTH_SECRET;
}

/**
 * Extracts and validates a CLI JWT from the Authorization header.
 * Returns the decoded payload if valid, null otherwise.
 */
export function validateCliToken(req: Request): CliTokenPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const secret = getCliSecret();
  if (!secret) return null;

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as CliTokenPayload;
    if (decoded.type !== 'cli') return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Middleware that accepts both Clerk and CLI tokens.
 * If a CLI token is present and valid, it injects auth-like properties
 * into the request so downstream middleware (requirePermission, etc.) works.
 */
export function acceptCliAuth() {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Only inject CLI auth if Clerk didn't already authenticate.
    // Clerk's new API uses req.auth() as a function — check if it returns a userId.
    const existingAuth = typeof (req as any).auth === 'function'
      ? (req as any).auth()
      : (req as any).auth;
    if (existingAuth?.userId) {
      return next();
    }

    const cliPayload = validateCliToken(req);
    if (cliPayload) {
      // Clerk's @clerk/express now uses req.auth() as a function (not a property).
      // We must match that interface so requireClerkAuth() works with CLI tokens.
      const authData = {
        userId: cliPayload.sub,
        orgId: cliPayload.org_id,
        sessionClaims: {
          org_id: cliPayload.org_id,
          metadata: { role: cliPayload.role },
        },
      };
      // Make req.auth a function that returns the auth data (matching Clerk's new API)
      // while also keeping it callable as a property for any legacy code.
      const authFn = () => authData;
      Object.assign(authFn, authData);
      (req as unknown as Record<string, unknown>).auth = authFn;
    }
    next();
  };
}
