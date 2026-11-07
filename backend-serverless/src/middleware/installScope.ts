import type { NextFunction, Request, Response } from 'express';
import { AppError } from './error.middleware.js';
import { getUserOrgId } from './clerk.middleware.js';

/**
 * Install-wide configuration acts for every organization in the install:
 * agent versions (every agent updates to the newest registered version for
 * its platform), the Elasticsearch connection (where every organization's
 * results go) and agent key auto-rotation.
 *
 * Only a caller without an organization, the install's operators, may change
 * it. A user or API key in a Clerk organization can still read it, but can't
 * change what other organizations' agents install or where their results go.
 * Single-organization installs (no Clerk organizations) are unaffected, and
 * callers without an organization keep this access even with
 * REQUIRE_ORG_ISOLATION=true: that setting rejects them on
 * organization-scoped routes, and this configuration belongs to no
 * organization.
 */
export function requireInstallOperator(req: Request, _res: Response, next: NextFunction): void {
  if (getUserOrgId(req.auth)) {
    next(new AppError(
      'This setting is shared by every organization in this install, so it can only be changed by an administrator who is not signed in to an organization.',
      403,
    ));
    return;
  }
  next();
}
