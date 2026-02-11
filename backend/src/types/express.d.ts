/**
 * Express type extensions for Clerk auth
 */

import type { AuthObject } from '@clerk/express';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthObject;
    }
  }
}
