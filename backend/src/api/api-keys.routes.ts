import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import {
  requireClerkAuth,
  requirePermission,
  getUserId,
  getUserOrgId,
} from '../middleware/clerk.middleware.js';
import { validate } from '../middleware/validation.js';
import { CreateApiKeySchema } from '../schemas/apiKeys.schemas.js';
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from '../services/apiKeys/apiKeys.service.js';

const router = Router();

// Only humans with settings:users:manage may create/list/revoke API keys.
// (Operator-scope API keys lack this permission, so a key cannot manage keys.)
router.use(requireClerkAuth());
router.use(requirePermission('settings:users:manage'));

/** POST /api/api-keys — create a key, return the full plaintext once. */
router.post(
  '/',
  validate(CreateApiKeySchema),
  asyncHandler(async (req, res) => {
    const userId = getUserId(req.auth);
    if (!userId) throw new AppError('Could not determine user', 401);

    const { name, scope, expires_at } = req.body as {
      name: string;
      scope: 'read' | 'read-write';
      expires_at?: string;
    };

    const created = generateApiKey({
      name,
      scope,
      expiresAt: expires_at ?? null,
      createdBy: userId,
      orgId: getUserOrgId(req.auth) ?? null,
    });

    res.status(201).json({ success: true, data: created });
  }),
);

/** GET /api/api-keys — list keys (no secrets). */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: listApiKeys() });
  }),
);

/** DELETE /api/api-keys/:id — revoke a key. Idempotent: re-revoke returns 404. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const ok = revokeApiKey(req.params.id);
    if (!ok) throw new AppError('API key not found or already revoked', 404);
    res.json({ success: true });
  }),
);

export default router;
