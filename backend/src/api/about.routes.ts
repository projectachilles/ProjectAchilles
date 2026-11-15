import { Router } from 'express';
import { requireClerkAuth } from '../middleware/clerk.middleware.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import { getAbout } from '../services/about/about.service.js';

const router = Router();

/**
 * GET /api/about — the release this install runs, its notes, the official
 * agent version and the latest releases GitHub reported. Any signed-in caller:
 * it holds nothing about the fleet or the organization. Reads memory only.
 */
router.get('/', requireClerkAuth(), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: getAbout() });
}));

export default router;
