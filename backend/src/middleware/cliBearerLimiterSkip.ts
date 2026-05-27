import type { Request } from 'express';

/**
 * Skip predicate for the CLI bearer-auth rate limiter (`cliBearerAuthLimiter`
 * in server.ts).
 *
 * The limiter is defense-in-depth against an attacker probing CLI_AUTH_SECRET
 * by hammering the CLI JWT verifier in `acceptCliAuth()`. It must therefore
 * count only requests that could plausibly reach that verifier. Anything else
 * is dashboard traffic and throttling it locks legitimate users out of the
 * SPA — polling alone (AgentsPage 15 s, TasksPage 10 s, NotificationBell,
 * Analytics widgets) easily exceeds 60 req/min/IP.
 *
 * Skip when:
 *   1. No `Authorization` header
 *   2. Non-`Bearer` scheme (Basic, etc.)
 *   3. `Bearer pa_…` API keys — handled by `apiKeyAuthLimiter`
 *   4. Clerk has already populated `req.auth` with a userId — the CLI
 *      verifier short-circuits for these requests
 *      (`cliAuth.middleware.ts:61`), so throttling them is pure waste.
 *
 * Returns `true` to skip rate limiting, `false` to count the request.
 *
 * **Why the try/catch:** `@clerk/express` v5 exposes `req.auth` as a callable
 * that can throw synchronously when the JWT is malformed (e.g. the SPA briefly
 * sends a stale or empty token mid-refresh — observed in prod as
 * `Error: Unexpected end of data` from Clerk's base64 decode). If that throw
 * escapes this predicate it surfaces as a 500 to the client. We treat any
 * throw as "not Clerk-authenticated" and let downstream auth produce a clean
 * 401 — the legitimate retry path.
 */
export function cliBearerLimiterSkip(req: Request): boolean {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return true;
  if (h.startsWith('Bearer pa_')) return true;

  let auth: { userId?: string } | undefined;
  try {
    const reqWithAuth = req as unknown as { auth?: unknown };
    const rawAuth = reqWithAuth.auth;
    auth = typeof rawAuth === 'function'
      // Invoke as a method of req to preserve `this` binding for Clerk SDKs
      // that rely on it.
      ? (reqWithAuth as { auth: () => { userId?: string } | undefined }).auth()
      : (rawAuth as { userId?: string } | undefined);
  } catch {
    return false;
  }
  if (auth?.userId) return true;

  return false;
}
