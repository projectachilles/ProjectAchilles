import { registerCommand } from './registry.js';
import * as api from '../api/users.js';
import { colors, timeAgo } from '../output/colors.js';
import type { AppRole } from '../api/types.js';

registerCommand({
  name: 'users',
  description: 'Manage team users and invitations',
  subcommands: {
    list: {
      description: 'List team members',
      handler: async (ctx) => {
        const users = await api.listUsers();
        ctx.output.table(
          users as unknown as Record<string, unknown>[],
          [
            { key: 'email', label: 'Email', width: 30 },
            { key: 'firstName', label: 'First', width: 12 },
            { key: 'lastName', label: 'Last', width: 12 },
            { key: 'role', label: 'Role', width: 10,
              transform: (v) => v ? String(v) : colors.dim('admin*'),
            },
            { key: 'lastActiveAt', label: 'Last Active', width: 14,
              transform: (v) => v ? timeAgo(String(v)) : colors.dim('never'),
            },
          ],
        );
      },
    },
    invite: {
      description: 'Invite a new user',
      flags: {
        email: { type: 'string' as const, required: true, description: 'Email address' },
        role: { type: 'string' as const, required: true, choices: ['admin', 'operator', 'analyst', 'explorer'], description: 'Role to assign' },
      },
      handler: async (ctx) => {
        const inv = await api.inviteUser(
          ctx.flags.email as string,
          ctx.flags.role as AppRole,
        );
        ctx.output.success(`Invitation sent to ${inv.emailAddress} (role: ${inv.role})`);
      },
    },
    invitations: {
      description: 'List pending invitations',
      handler: async (ctx) => {
        const invs = await api.listInvitations();
        ctx.output.table(
          invs as unknown as Record<string, unknown>[],
          [
            { key: 'id', label: 'ID', width: 14 },
            { key: 'emailAddress', label: 'Email', width: 30 },
            { key: 'role', label: 'Role', width: 10 },
            { key: 'status', label: 'Status', width: 10 },
          ],
        );
      },
    },
    'revoke-invitation': {
      description: 'Revoke a pending invitation',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        await api.revokeInvitation(ctx.args.id);
        ctx.output.success(`Invitation ${ctx.args.id} revoked`);
      },
    },
    role: {
      description: 'Set or remove a user role',
      args: [
        { name: 'action', required: true, description: '"set" or "remove"' },
        { name: 'userId', required: true, description: 'User ID' },
      ],
      flags: {
        role: { type: 'string' as const, choices: ['admin', 'operator', 'analyst', 'explorer'], description: 'Role (required for set)' },
      },
      handler: async (ctx) => {
        if (ctx.args.action === 'set') {
          if (!ctx.flags.role) {
            ctx.output.error('--role is required for "set" action');
            process.exit(1);
          }
          const result = await api.setUserRole(ctx.args.userId, ctx.flags.role as AppRole);
          ctx.output.success(`Role set to ${result.role} for user ${result.userId}`);
        } else if (ctx.args.action === 'remove') {
          const result = await api.removeUserRole(ctx.args.userId);
          ctx.output.success(`Role removed for user ${result.userId} (now full admin)`);
        } else {
          ctx.output.error(`Unknown action: ${ctx.args.action}. Use "set" or "remove".`);
        }
      },
    },
    delete: {
      description: 'Delete a user',
      args: [{ name: 'userId', required: true }],
      handler: async (ctx) => {
        await api.deleteUser(ctx.args.userId);
        ctx.output.success(`User ${ctx.args.userId} deleted`);
      },
    },
  },
});
