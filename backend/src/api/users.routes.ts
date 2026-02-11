import { Router } from 'express';
import { clerkClient } from '@clerk/express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { getUserId, requireClerkAuth, requirePermission } from '../middleware/clerk.middleware.js';
import { VALID_ROLES } from '../types/roles.js';
import type { AppRole } from '../types/roles.js';

const router = Router();

router.use(requireClerkAuth());
router.use(requirePermission('settings:users:manage'));

/**
 * GET /api/users
 * List all Clerk users with their roles.
 */
router.get('/', asyncHandler(async (_req, res) => {
  const userList = await clerkClient.users.getUserList({ limit: 100 });

  const users = userList.data.map(u => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.emailAddresses[0]?.emailAddress ?? null,
    imageUrl: u.imageUrl,
    role: (u.publicMetadata as Record<string, unknown>).role as AppRole | undefined ?? null,
    lastActiveAt: u.lastActiveAt,
    createdAt: u.createdAt,
  }));

  res.json({ success: true, data: users });
}));

/**
 * PUT /api/users/:userId/role
 * Set a user's role. Body: { role: AppRole }
 */
router.put('/:userId/role', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body as { role: string };

  if (!role || !VALID_ROLES.includes(role as AppRole)) {
    throw new AppError(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400);
  }

  // Prevent self-role-change
  const currentUserId = getUserId(req.auth);
  if (currentUserId === userId) {
    throw new AppError('Cannot change your own role', 400);
  }

  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: { role },
  });

  res.json({ success: true, data: { userId, role } });
}));

/**
 * DELETE /api/users/:userId/role
 * Remove a user's role (returns to full-access fallback).
 */
router.delete('/:userId/role', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const currentUserId = getUserId(req.auth);
  if (currentUserId === userId) {
    throw new AppError('Cannot remove your own role', 400);
  }

  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: { role: null },
  });

  res.json({ success: true, data: { userId, role: null } });
}));

export default router;
