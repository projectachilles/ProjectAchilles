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
  return process.env.CLI_AUTH_SECRET || process.env.ENCRYPTION_SECRET;
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
    const decoded = jwt.verify(token, secret) as CliTokenPayload;
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
    const cliPayload = validateCliToken(req);
    if (cliPayload) {
      // Inject Clerk-compatible auth object so existing permission middleware works
      (req as unknown as Record<string, unknown>).auth = {
        userId: cliPayload.sub,
        sessionClaims: {
          org_id: cliPayload.org_id,
          metadata: { role: cliPayload.role },
        },
      };
    }
    next();
  };
}
