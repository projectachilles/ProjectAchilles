import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { safeClerkAuth } from './clerkAuthHelpers.js';

/**
 * Shared keyGenerators for the inbound rate limiters.
 *
 * The guiding principle: throttle the *real principal*, not the IP. In a
 * corporate customer, dozens-to-hundreds of agents and every SOC analyst sit
 * behind one NAT egress IP, so a pure-IP key silently becomes a per-customer
 * bucket — legitimate fleets and dashboards collide with each other and trip
 * the limiter. Keying on the agent id / Clerk user id restores per-principal
 * budgets while keeping IP normalization as the abuse-resistant fallback.
 *
 * `ipKeyGenerator` masks IPv6 to its /56 block (express-rate-limit default) so
 * an attacker can't mint fresh buckets by rotating the low bits of an
 * allocated block. IPv4 passes through unchanged. See PR #285.
 */

function normalizedIp(req: Request): string {
  return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
}

function firstHeader(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return value as string | undefined;
}

/**
 * Device-endpoint key: `<normalized-ip>:<agent-id>`. The composite means each
 * enrolled agent gets its own budget even when many share a NAT IP, while an
 * unauthenticated probe (no X-Agent-ID) still can't escape its IP bucket.
 */
export function agentDeviceKey(req: Request): string {
  const agentId = firstHeader(req.headers['x-agent-id']) || 'none';
  return `${normalizedIp(req)}:${agentId}`;
}

/**
 * Global UI key: the Clerk user id when authenticated, else the normalized IP.
 * Analysts behind a shared corporate IP each get their own dashboard budget
 * instead of collectively draining one per-IP bucket on heavy polling.
 */
export function uiLimiterKey(req: Request): string {
  const userId = safeClerkAuth(req)?.userId;
  if (userId) return `user:${userId}`;
  return `ip:${normalizedIp(req)}`;
}
