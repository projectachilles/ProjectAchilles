import { vi } from 'vitest';

/**
 * Mock Clerk middleware for testing. Import for side effects:
 *
 *   import '../../../__tests__/helpers/clerk-mock.js';
 *
 * Importing this module registers the mocks below, replacing requireClerkAuth
 * with a passthrough that sets req.auth. vi.mock must stay at module top level:
 * Vitest hoists it regardless, and Vitest 5 rejects nested calls.
 *
 * Module paths resolve relative to THIS file, so they mock the same modules
 * for every test that imports it.
 */
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/clerk.middleware.js', () => ({
  clerkAuth: (_req: any, _res: any, next: any) => next(),
  requireClerkAuth: () => (req: any, _res: any, next: any) => {
    req.auth = { userId: 'test-user-001', sub: 'test-user-001' };
    next();
  },
  getUserId: (auth: any) => auth?.userId || auth?.sub || 'test-user-001',
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  getUserOrgId: (auth: any) => auth?.orgId,
  // Same rule as the real one: only a caller with an org can mismatch.
  validateRequestOrgId: (reqOrgId: string, auth: any) => {
    if (auth?.orgId && reqOrgId !== auth.orgId) {
      throw Object.assign(new Error('org_id does not match your organization'), { statusCode: 403, isOperational: true });
    }
  },
}));
