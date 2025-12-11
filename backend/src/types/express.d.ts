/**
 * Express type extensions for session
 */

import { Credentials } from './endpoints';

declare module 'express-session' {
  interface SessionData {
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
