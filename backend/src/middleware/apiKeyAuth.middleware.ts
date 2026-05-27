/**
 * API key authentication middleware.
 *
 * Validates `Authorization: Bearer pa_<…>` headers against the api_keys table
 * and synthesises a Clerk-shaped `req.auth` carrying the key's expanded
 * permission set. Mirrors the acceptCliAuth() pattern.
 *
 * Precedence: Clerk session → CLI token → API key. If any earlier middleware
 * already authenticated the request, this middleware is a no-op.
 *
 * Malformed / unknown / revoked / expired keys do NOT throw — they simply
 * decline to attach auth, so downstream requireClerkAuth() returns the
 * standard 401. (Rationale: a bad key looks like "unauthenticated" rather
 * than leaking whether a key exists.)
 */

import type { Request, Response, NextFunction } from 'express';
import {
  validateApiKey,
  touchLastUsed,
  type ApiKeyScope,
} from '../services/apiKeys/apiKeys.service.js';
import {
  READ_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
} from '../types/roles.js';
import { safeClerkAuth } from './clerkAuthHelpers.js';

function permissionsForScope(scope: ApiKeyScope): ReadonlySet<Permission> {
  if (scope === 'read-write') return new Set(ROLE_PERMISSIONS.operator);
  return new Set(READ_ONLY_PERMISSIONS);
}

export function acceptApiKey() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Precedence — leave existing Clerk/CLI auth untouched. safeClerkAuth
    // also swallows throws from malformed JWTs so this middleware can't
    // surface a 500 to the client.
    if (safeClerkAuth(req)?.userId) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer pa_')) {
      next();
      return;
    }

    const rawKey = authHeader.slice(7);
    const row = validateApiKey(rawKey);
    if (!row) {
      next();
      return;
    }

    touchLastUsed(row.id);

    const permissions = permissionsForScope(row.scope);
    const authData = {
      userId: `apikey:${row.id}`,
      orgId: row.org_id ?? undefined,
      sessionClaims: {
        org_id: row.org_id ?? undefined,
        metadata: {},
      },
      apiKeyPermissions: permissions,
    };
    // Match the @clerk/express function-or-property shape used by acceptCliAuth.
    const authFn = () => authData;
    Object.assign(authFn, authData);
    (req as unknown as Record<string, unknown>).auth = authFn;
    next();
  };
}
