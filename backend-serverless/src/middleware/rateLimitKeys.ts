import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Shared keyGenerators for the inbound rate limiters (serverless fork).
 *
 * Mirrors backend/src/middleware/rateLimitKeys.ts. Kept self-contained because
 * the serverless fork has no clerkAuthHelpers/safeClerkAuth module.
 *
 * Principle: throttle the *real principal*, not the IP. A corporate customer
 * runs a whole agent fleet and every analyst behind one NAT egress IP, so a
 * pure-IP key collapses them into a single per-customer bucket. Keying on the
 * agent id / Clerk user id restores per-principal budgets; IP normalization
 * (IPv6 → /56) stays as the abuse-resistant fallback.
 */

function normalizedIp(req: Request): string {
  return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
}

function firstHeader(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return value as string | undefined;
}

/**
 * Safely read the Clerk user id from req.auth. @clerk/express may expose auth
 * as a callable that throws on a malformed JWT, or as a plain object; handle
 * both and swallow throws so a bad token degrades to the IP fallback rather
 * than a 500.
 */
function safeUserId(req: Request): string | undefined {
  try {
    const raw = (req as unknown as { auth?: unknown }).auth;
    const auth = typeof raw === 'function'
      ? (raw as () => unknown).call(req)
      : raw;
    const a = auth as { userId?: string; sub?: string; subject?: string; id?: string } | undefined;
    return a?.userId ?? a?.sub ?? a?.subject ?? a?.id;
  } catch {
    return undefined;
  }
}

/**
 * Device-endpoint key: `<normalized-ip>:<agent-id>`. Each enrolled agent gets
 * its own budget even when a fleet shares a NAT IP; an unauthenticated probe
 * (no X-Agent-ID) still can't escape its IP bucket.
 */
export function agentDeviceKey(req: Request): string {
  const agentId = firstHeader(req.headers['x-agent-id']) || 'none';
  return `${normalizedIp(req)}:${agentId}`;
}

/**
 * Global UI key: the Clerk user id when authenticated, else the normalized IP.
 */
export function uiLimiterKey(req: Request): string {
  const userId = safeUserId(req);
  if (userId) return `user:${userId}`;
  return `ip:${normalizedIp(req)}`;
}
