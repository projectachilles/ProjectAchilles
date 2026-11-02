import type { NextFunction, Request, Response } from 'express';
import { AppError } from './error.middleware.js';
import { getUserOrgId } from './clerk.middleware.js';
import { getDb } from '../services/agent/database.js';

/**
 * Organization scoping for the agent, task and schedule admin routes
 * (mirrors backend/src/middleware/orgScope.ts, with an async database).
 *
 * A caller with a Clerk organization only sees and acts on its own
 * organization's rows. A caller without one is a single-organization install
 * and keeps seeing everything, unless REQUIRE_ORG_ISOLATION=true, which
 * rejects it.
 *
 * `requireOrgAccess` (mounted on every /admin router) already refuses an
 * `org_id` in the query or body that isn't the caller's; these helpers cover
 * what it can't see: lists that omit `org_id`, rows addressed by id, and the
 * agents a task or schedule targets.
 */

/**
 * The caller's organization, or undefined for a caller without one.
 * Throws 403 for a caller without one when REQUIRE_ORG_ISOLATION=true.
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
 * Unknown and other-organization agents get the same answer.
 * Does nothing when `orgId` is undefined (a caller without an organization).
 */
export async function assertAgentsInOrg(agentIds: readonly string[], orgId: string | undefined): Promise<void> {
  if (!orgId) return;
  const ids = [...new Set(agentIds)];
  if (ids.length === 0) return;
  const db = await getDb();
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM agents WHERE org_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    [orgId, ...ids],
  );
  if (Number(row?.n ?? 0) !== ids.length) throw new AppError('Agent not found', 404);
}

/**
 * Throws 404 "<what> not found" when the caller has an organization and the
 * row belongs to another one: the same answer as an id that doesn't exist.
 */
export function assertRowInOrg(rowOrgId: string, orgId: string | undefined, what: string): void {
  if (orgId && rowOrgId !== orgId) throw new AppError(`${what} not found`, 404);
}

/**
 * Router middleware for the Elasticsearch-backed routes (Analytics, reports):
 * a caller with an organization only ever queries its own organization's
 * results. A missing `?org=` is filled in with the caller's org and any other
 * value is refused (403). Results carry the org of the task that produced
 * them (`routing.oid` = `tasks.org_id`), which for an org caller is always its
 * own Clerk org id.
 *
 * Callers without an organization are unchanged, except under
 * REQUIRE_ORG_ISOLATION=true (403, via callerOrg). `exempt` lists the
 * router-relative paths that are install configuration, not results
 * (e.g. the Elasticsearch connection settings).
 */
export function scopeResultsToCallerOrg(exempt: readonly string[] = []) {
  const exemptPaths = new Set(exempt.map((p) => p.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    if (exemptPaths.has(req.path.toLowerCase())) {
      next();
      return;
    }
    let own: string | undefined;
    try {
      own = callerOrg(req);
    } catch (err) {
      next(err);
      return;
    }
    if (!own) {
      next();
      return;
    }
    const requested = req.query.org;
    if (requested !== undefined && requested !== '' && requested !== own) {
      res.status(403).json({ success: false, error: 'Access denied to this organization' });
      return;
    }
    req.query.org = own;
    next();
  };
}
