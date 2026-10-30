import { Router } from 'express';
import { requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { requireUserSession } from '../middleware/userSession.middleware.js';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { validate } from '../middleware/validation.js';
import { ConsoleIdentitySchema } from '../schemas/consoleIdentity.schemas.js';
import { ConsoleIdentityService } from '../services/consoleIdentity/consoleIdentity.service.js';
import type { ConsoleIdentityInput } from '../types/consoleIdentity.js';

const router = Router();
const service = new ConsoleIdentityService();

// Any authenticated caller may read; never served unauthenticated.
router.get('/', requireClerkAuth(), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: service.get() });
}));

// Writes: real Clerk browser sessions only (no API keys / CLI tokens).
router.put(
  '/',
  requireClerkAuth(),
  requireUserSession(),
  requirePermission('settings:platform:write'),
  validate(ConsoleIdentitySchema),
  asyncHandler(async (req, res) => {
    try {
      res.json({ success: true, data: service.save(req.body as ConsoleIdentityInput) });
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Invalid identity', 400);
    }
  }),
);

router.delete(
  '/',
  requireClerkAuth(),
  requireUserSession(),
  requirePermission('settings:platform:write'),
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: service.reset() });
  }),
);

export default router;
