/**
 * Basic auth JWT middleware.
 *
 * Validates JWTs issued by the basic auth login endpoint and injects
 * a Clerk-compatible req.auth so downstream middleware works unchanged.
 * Same pattern as acceptCliAuth().
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyBasicToken } from '../services/auth/basic.service.js';

export function acceptBasicAuth() {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Skip if another auth method already populated req.auth
    const existingAuth = typeof (req as any).auth === 'function'
      ? (req as any).auth()
      : (req as any).auth;
    if (existingAuth?.userId) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.slice(7);
    const payload = verifyBasicToken(token);
    if (!payload) return next();

    // Inject Clerk-compatible auth data
    const authData = {
      userId: payload.sub,
      orgId: 'basic-org',
      sessionClaims: {
        org_id: 'basic-org',
        metadata: { role: payload.role },
      },
    };

    const authFn = () => authData;
    Object.assign(authFn, authData);
    (req as unknown as Record<string, unknown>).auth = authFn;

    next();
  };
}
