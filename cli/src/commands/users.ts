import { registerCommand } from './registry.js';
import * as api from '../api/users.js';
import { colors, timeAgo } from '../output/colors.js';

registerCommand({
  name: 'users',
  // Read-only on purpose: inviting, changing roles and deleting users need a
  // signed-in browser session (Settings → Users). The server refuses them for
  // CLI tokens, so there are no commands for them here.
  description: 'List team users and pending invitations',
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
              transform: (v) => {
                if (!v) return colors.dim('never');
                // Clerk returns epoch ms (number), not ISO string
                const ts = typeof v === 'number' ? new Date(v).toISOString() : String(v);
                return timeAgo(ts);
              },
            },
          ],
        );
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
  },
});
