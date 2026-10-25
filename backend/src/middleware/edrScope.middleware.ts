import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware.js';

/**
 * EDR integrations (Defender, CrowdStrike, SentinelOne) are deployment-wide:
 * one shared configuration whose sync and automation act for every tenant.
 * In multi-tenant mode (REQUIRE_ORG_ISOLATION=true) every UI caller acts
 * inside one org, so none of them may change that shared configuration;
 * there it is set through the DEFENDER_* / CROWDSTRIKE_* / SENTINELONE_*
 * environment variables. Reads (masked, no secrets) stay available.
 */
export function requireDeploymentScopeForEdrWrite(_req: Request, _res: Response, next: NextFunction): void {
  if (process.env.REQUIRE_ORG_ISOLATION === 'true') {
    next(new AppError(
      'EDR integrations are shared by every organization in this deployment, so they cannot be changed from an organization account when REQUIRE_ORG_ISOLATION=true. Configure them with the DEFENDER_*, CROWDSTRIKE_* or SENTINELONE_* environment variables.',
      403,
    ));
    return;
  }
  next();
}
