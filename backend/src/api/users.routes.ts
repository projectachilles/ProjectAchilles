import { Router } from 'express';
import { clerkClient } from '@clerk/express';
import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { requireClerkAuth, requirePermission, getUserId } from '../middleware/clerk.middleware.js';
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
 * POST /api/users/invite
 * Send an invitation email and pre-assign a role.
 */
router.post('/invite', asyncHandler(async (req, res) => {
  const { email, role } = req.body as { email: string; role: string };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new AppError('A valid email address is required', 400);
  }
  if (!role || !VALID_ROLES.includes(role as AppRole)) {
    throw new AppError(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400);
  }

  const redirectUrl = process.env.PUBLIC_APP_URL
    ? `${process.env.PUBLIC_APP_URL}/sign-in`
    : 'http://localhost:5173/sign-in';

  const invitation = await clerkClient.invitations.createInvitation({
    emailAddress: email,
    publicMetadata: { role },
    redirectUrl,
  });

  res.json({
    success: true,
    data: {
      id: invitation.id,
      emailAddress: invitation.emailAddress,
      role,
      status: invitation.status,
      createdAt: invitation.createdAt,
    },
  });
}));

/**
 * GET /api/users/invitations
 * List pending invitations.
 */
router.get('/invitations', asyncHandler(async (_req, res) => {
  const invitations = await clerkClient.invitations.getInvitationList({ status: 'pending' });

  const data = invitations.data.map(inv => ({
    id: inv.id,
    emailAddress: inv.emailAddress,
    role: (inv.publicMetadata as Record<string, unknown>).role as string | null ?? null,
    status: inv.status,
    createdAt: inv.createdAt,
  }));

  res.json({ success: true, data });
}));

/**
 * POST /api/users/invitations/:invitationId/revoke
 * Revoke a pending invitation.
 */
router.post('/invitations/:invitationId/revoke', asyncHandler(async (req, res) => {
  const { invitationId } = req.params;
  await clerkClient.invitations.revokeInvitation(invitationId);
  res.json({ success: true });
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

  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: { role: null },
  });

  res.json({ success: true, data: { userId, role: null } });
}));

/**
 * DELETE /api/users/:userId
 * Permanently remove a user from Clerk.
 */
router.delete('/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (getUserId(req.auth) === userId) {
    throw new AppError('You cannot delete your own account', 400);
  }

  await clerkClient.users.deleteUser(userId);
  res.json({ success: true });
}));

export default router;
