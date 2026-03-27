import { vi } from 'vitest';

/**
 * Mock Clerk middleware for testing.
 * Replaces requireClerkAuth with a passthrough that sets req.auth.
 */
export function mockClerkMiddleware() {
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
    validateRequestOrgId: () => {},
  }));
}
