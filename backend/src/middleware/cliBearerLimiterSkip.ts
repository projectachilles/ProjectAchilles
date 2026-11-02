import type { Request } from 'express';
import { safeClerkAuth } from './clerkAuthHelpers.js';

function isAgentDevicePath(url: string | undefined): boolean {
  const p = (url ?? '').split('?')[0];
  return p.startsWith('/api/agent/') && p !== '/api/agent/admin' && !p.startsWith('/api/agent/admin/');
}

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
 *      verifier short-circuits for these requests (`cliAuth.middleware.ts`),
 *      so throttling them is pure waste.
 *   5. `Bearer ak_…` agent keys on agent device routes (`/api/agent/*` except
 *      `/api/agent/admin/*`). Agents behind one egress IP (office NAT, proxy)
 *      would otherwise share this per-IP budget and be throttled on
 *      heartbeat/poll. Those routes have `agentDeviceLimiter` (per IP + agent
 *      ID). `ak_` on any other path is still counted, so the CLI verifier
 *      can't be hammered unthrottled by adding the prefix.
 *
 * `safeClerkAuth` swallows synchronous throws from Clerk's JWT parser
 * (malformed tokens) — see its docstring for the regression context.
 *
 * Returns `true` to skip rate limiting, `false` to count the request.
 */
export function cliBearerLimiterSkip(req: Request): boolean {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return true;
  if (h.startsWith('Bearer pa_')) return true;
  if (h.startsWith('Bearer ak_') && isAgentDevicePath(req.originalUrl)) return true;
  if (safeClerkAuth(req)?.userId) return true;
  return false;
}
