import type { Request } from 'express';

/**
 * Subset of the Clerk auth object that ProjectAchilles middleware reads.
 * `@clerk/express` v5 returns this from `req.auth()`; legacy SDKs expose it
 * directly as a property. Synthetic auth attached by `acceptCliAuth` and
 * `acceptApiKey` follows the same shape.
 */
export interface ClerkAuthLike {
  userId?: string;
  orgId?: string;
  sessionClaims?: unknown;
  apiKeyPermissions?: ReadonlySet<string>;
}

/**
 * Safely read `req.auth` from a Clerk-augmented Express request.
 *
 * `@clerk/express` v5 exposes `req.auth` as a callable that throws
 * synchronously on malformed JWTs — e.g. `Error: Unexpected end of data`
 * from base64 decode when the SPA briefly sends a stale or empty Bearer
 * mid-token-refresh. If that throw escapes any middleware, Express's
 * error handler returns a 500 to the client instead of the proper 401,
 * locking users out for the duration of the bad token.
 *
 * Use this helper anywhere middleware needs to peek at `req.auth` before
 * the per-route `requireAuth()` enforcement runs. Returns `undefined` when
 * no auth is present OR when Clerk's parse threw — callers treat both as
 * "unauthenticated" and let the downstream auth chain produce a clean 401.
 *
 * Invokes `req.auth()` as a *method* of `req` so `this` is preserved for
 * SDK implementations that rely on it.
 */
export function safeClerkAuth(req: Request): ClerkAuthLike | undefined {
  try {
    const r = req as unknown as { auth?: unknown };
    const raw = r.auth;
    if (typeof raw === 'function') {
      return (r as { auth: () => ClerkAuthLike | undefined }).auth();
    }
    return raw as ClerkAuthLike | undefined;
  } catch {
    return undefined;
  }
}
