import type { Request } from 'express';
import { AppError } from './error.middleware.js';
import { getUserOrgId } from './clerk.middleware.js';
import { getDatabase } from '../services/agent/database.js';

/**
 * Organization scoping for the agent, task and schedule admin routes.
 *
 * A caller with an organization (a Clerk organization session, or an API key
 * created in one) only sees and acts on its own organization's rows. A caller
 * without one is a single-organization install and keeps seeing everything,
 * unless REQUIRE_ORG_ISOLATION=true, which rejects it.
 *
 * `requireOrgAccess` (mounted on every /admin router) already refuses an
 * `org_id` in the query or body that isn't the caller's; these helpers cover
 * what it can't see: lists that omit `org_id`, rows addressed by id, and the
 * agents a task or schedule targets.
 */

/**
 * The caller's organization, or undefined for a caller without one.
 * Throws 403 for a caller without one when REQUIRE_ORG_ISOLATION=true
 * (the same rule as campaigns, notices and enrollment tokens).
 */
export function callerOrg(req: Request): string | undefined {
  const orgId = getUserOrgId(req.auth);
  if (orgId) return orgId;
  if (process.env.REQUIRE_ORG_ISOLATION === 'true') {
    throw new AppError('Organization isolation required. Configure Clerk Organizations.', 403);
  }
  return undefined;
}

/**
 * The organization a list or metric is limited to: always the caller's own
 * when it has one; otherwise the optional `?org_id=` filter.
 */
export function listOrgScope(req: Request): string | undefined {
  const own = callerOrg(req);
  if (own) return own;
  const requested = req.query.org_id;
  return typeof requested === 'string' && requested ? requested : undefined;
}

/**
 * Throws 404 "Agent not found" unless every id is an agent of `orgId`.
 * Unknown and other-organization agents get the same answer, so the check
 * can't be used to probe for another organization's agent ids.
 * Does nothing when `orgId` is undefined (a caller without an organization).
 */
export function assertAgentsInOrg(agentIds: readonly string[], orgId: string | undefined): void {
  if (!orgId) return;
  const ids = [...new Set(agentIds)];
  if (ids.length === 0) return;
  const { n } = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM agents WHERE org_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
    .get(orgId, ...ids) as { n: number };
  if (n !== ids.length) throw new AppError('Agent not found', 404);
}

/**
 * Throws 404 "<what> not found" when the caller has an organization and the
 * row belongs to another one: the same answer as an id that doesn't exist.
 */
export function assertRowInOrg(rowOrgId: string, orgId: string | undefined, what: string): void {
  if (orgId && rowOrgId !== orgId) throw new AppError(`${what} not found`, 404);
}
