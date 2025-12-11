/**
 * Express type extensions for session
 */

import { Credentials } from './endpoints';

declare module 'express-session' {
  interface SessionData {
    credentials?: Credentials;
    /**
     * Organizations stored in session
     * NOTE: API keys are NOT stored here for security reasons
     * They are stored in secure server-side credential store
     */
    organizations?: Array<{
      id: string;
      name: string;
      oid: string;
      /** Reference to credential store, not the actual API key */
      credentialId: string;
    }>;
    currentOrgId?: string;
  }
}
