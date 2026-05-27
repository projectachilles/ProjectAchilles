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
 */
export function cliBearerLimiterSkip(req: Request): boolean {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return true;
  if (h.startsWith('Bearer pa_')) return true;

  const rawAuth = (req as unknown as { auth?: unknown }).auth;
  const auth = typeof rawAuth === 'function'
    ? (rawAuth as () => { userId?: string } | undefined)()
    : (rawAuth as { userId?: string } | undefined);
  if (auth?.userId) return true;

  return false;
}
