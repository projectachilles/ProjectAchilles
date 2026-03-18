import { registerCommand } from './registry.js';
import * as api from '../api/tokens.js';
import { getUserInfo } from '../auth/token-store.js';
import { colors, timeAgo } from '../output/colors.js';

registerCommand({
  name: 'tokens',
  description: 'Manage enrollment tokens',
  subcommands: {
    create: {
      description: 'Create a new enrollment token',
      flags: {
        'ttl-hours': { type: 'number', default: 24, description: 'Token TTL in hours' },
        'max-uses': { type: 'number', default: 1, description: 'Max enrollment uses' },
        metadata: { type: 'string', description: 'JSON metadata (e.g., \'{"env":"prod"}\')' },
      },
      handler: async (ctx) => {
        const user = getUserInfo();
        const orgId = user?.orgId ?? 'default';
        let metadata: Record<string, string> | undefined;
        if (ctx.flags.metadata) {
          try {
            metadata = JSON.parse(ctx.flags.metadata as string);
          } catch {
            ctx.output.error('Invalid JSON in --metadata');
            process.exit(1);
          }
        }
        const token = await api.createToken({
          org_id: orgId,
          ttl_hours: ctx.flags['ttl-hours'] as number,
          max_uses: ctx.flags['max-uses'] as number,
          metadata,
        });
        ctx.output.detail(token as unknown as Record<string, unknown>, [
          'id', 'token', 'expires_at', 'max_uses',
        ]);
      },
    },
    list: {
      description: 'List active enrollment tokens',
      handler: async (ctx) => {
        const user = getUserInfo();
        const orgId = user?.orgId ?? 'default';
        const tokens = await api.listTokens(orgId);
        ctx.output.table(
          tokens as unknown as Record<string, unknown>[],
          [
            { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
            { key: 'token', label: 'Token', width: 12, transform: (v) => String(v).slice(0, 8) + '…' },
            { key: 'use_count', label: 'Uses', width: 6, align: 'right' },
            { key: 'max_uses', label: 'Max', width: 5, align: 'right' },
            { key: 'expires_at', label: 'Expires', width: 14, transform: (v) => timeAgo(String(v)) },
            { key: 'created_by', label: 'Created By', width: 20 },
          ],
        );
      },
    },
    revoke: {
      description: 'Revoke an enrollment token',
      args: [{ name: 'id', required: true, description: 'Token ID' }],
      handler: async (ctx) => {
        await api.revokeToken(ctx.args.id);
        ctx.output.success(`Token ${ctx.args.id} revoked`);
      },
    },
  },
});
