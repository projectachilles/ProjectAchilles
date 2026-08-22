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
 *
 * Scopes expand to permission sets: read → every `:read` permission,
 * read-write → the operator role, admin → the admin role minus
 * `settings:users:manage` (see ADMIN_API_KEY_PERMISSIONS below). Only
 * `admin` carries `endpoints:tasks:command`, which executes an arbitrary
 * shell command as root/SYSTEM on every named agent.
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

/**
 * Admin-scope API key permission set.
 *
 * An API key is a bearer credential, not a human session — whoever holds
 * it holds everything it grants, for as long as it's valid, with no
 * MFA or step-up to fall back on. Granting it `settings:users:manage`
 * (part of `ROLE_PERMISSIONS.admin`) would let the key mint further API
 * keys and create/promote human Clerk admins, so a single leaked key could
 * plant persistent access that outlives the key itself — revoking it would
 * no longer contain the incident. This set is `ROLE_PERMISSIONS.admin`
 * with that one permission carved out; user and key management stay a
 * human-only, Clerk-session action (see `api-keys.routes.ts`,
 * `users.routes.ts`).
 */
const ADMIN_API_KEY_PERMISSIONS: ReadonlySet<Permission> = new Set(
  ROLE_PERMISSIONS.admin.filter((p) => p !== 'settings:users:manage'),
);

function permissionsForScope(scope: ApiKeyScope): ReadonlySet<Permission> {
  if (scope === 'admin') return new Set(ADMIN_API_KEY_PERMISSIONS);
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
