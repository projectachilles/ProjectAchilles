/**
 * Express type extensions for session and Clerk auth
 */

import { Credentials } from './endpoints';

declare module 'express-session' {
  interface SessionData {
    clerkUserId?: string; // NEW: Link session to Clerk user
    credentials?: Credentials;
    organizations?: Array<{
      id: string;
      name: string;
      oid: string;
      apiKey: string;
    }>;
    currentOrgId?: string;
  }
}

// NEW: Clerk auth types
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        orgId?: string;
      };
    }
  }
}
