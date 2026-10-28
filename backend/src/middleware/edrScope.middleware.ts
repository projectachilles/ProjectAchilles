import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware.js';
import { EDR_VENDOR_KEYS } from '../services/outcomes/vendors.js';
import type { EdrVendorKey } from '../services/outcomes/vendors.js';

/** Env-var family that configures each EDR integration (`<PREFIX>_*`). */
export const EDR_ENV_PREFIX: Record<EdrVendorKey, string> = {
  defender: 'DEFENDER',
  crowdstrike: 'CROWDSTRIKE',
  sentinelone: 'SENTINELONE',
};

/** "A, B or C". */
function orList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const ENV_FAMILIES = orList(EDR_VENDOR_KEYS.map((k) => `${EDR_ENV_PREFIX[k]}_*`));

/**
 * EDR integrations (every vendor in the EDR registry) are deployment-wide:
 * one shared configuration whose sync and automation act for every tenant.
 * In multi-tenant mode (REQUIRE_ORG_ISOLATION=true) every UI caller acts
 * inside one org, so none of them may change that shared configuration;
 * there it is set through each vendor's `<PREFIX>_*` environment variables
 * (EDR_ENV_PREFIX). Reads (masked, no secrets) stay available.
 */
export function requireDeploymentScopeForEdrWrite(_req: Request, _res: Response, next: NextFunction): void {
  if (process.env.REQUIRE_ORG_ISOLATION === 'true') {
    next(new AppError(
      `EDR integrations are shared by every organization in this deployment, so they cannot be changed from an organization account when REQUIRE_ORG_ISOLATION=true. Configure them with the ${ENV_FAMILIES} environment variables.`,
      403,
    ));
    return;
  }
  next();
}
