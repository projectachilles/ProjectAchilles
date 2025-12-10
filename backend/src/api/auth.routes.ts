import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { AuthService } from '../services/endpoints/auth.service.js';

const router = Router();
const authService = new AuthService();

// Extend Express session type
declare module 'express-session' {
  interface SessionData {
    credentials?: {
      oid: string;
      apiKey: string;
    };
    organizations?: Array<{
      id: string;
      name: string;
      oid: string;
    }>;
    currentOrgId?: string;
  }
}

// POST /api/auth/login - Login with LimaCharlie credentials
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = req.body;

  if (!oid || !apiKey) {
    throw new AppError('Organization ID and API key are required', 400);
  }

  // Validate credentials with LimaCharlie
  const result = await authService.validateCredentials(oid, apiKey);

  if (!result.valid) {
    throw new AppError(result.error || 'Invalid credentials', 401);
  }

  // Store credentials in session
  req.session.credentials = { oid, apiKey };
  req.session.organizations = [{
    id: oid,
    name: result.orgName || oid,
    oid: oid,
  }];
  req.session.currentOrgId = oid;

  res.json({
    success: true,
    organizations: req.session.organizations,
    currentOrg: req.session.organizations[0],
  });
}));

// POST /api/auth/logout - Logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/session - Check session
router.get('/session', (req: Request, res: Response) => {
  if (!req.session.credentials) {
    return res.json({
      authenticated: false,
      organizations: [],
      currentOrg: null,
    });
  }

  const currentOrg = req.session.organizations?.find(
    org => org.oid === req.session.currentOrgId
  );

  res.json({
    authenticated: true,
    organizations: req.session.organizations || [],
    currentOrg: currentOrg || null,
  });
});

// POST /api/auth/switch-org - Switch organization
router.post('/switch-org', asyncHandler(async (req: Request, res: Response) => {
  const { oid } = req.body;

  if (!req.session.credentials) {
    throw new AppError('Not authenticated', 401);
  }

  const org = req.session.organizations?.find(o => o.oid === oid);
  if (!org) {
    throw new AppError('Organization not found in session', 404);
  }

  req.session.currentOrgId = oid;

  res.json({
    success: true,
    currentOrg: org,
  });
}));

// POST /api/auth/validate - Validate credentials without login
router.post('/validate', asyncHandler(async (req: Request, res: Response) => {
  const { oid, apiKey } = req.body;

  if (!oid || !apiKey) {
    throw new AppError('Organization ID and API key are required', 400);
  }

  const result = await authService.validateCredentials(oid, apiKey);

  res.json({
    valid: result.valid,
    orgName: result.orgName,
    error: result.error,
  });
}));

export default router;
