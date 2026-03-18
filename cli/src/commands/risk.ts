import { registerCommand } from './registry.js';
import * as api from '../api/risk.js';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'risk',
  description: 'Manage risk acceptances',
  subcommands: {
    accept: {
      description: 'Create a risk acceptance',
      flags: {
        test: { type: 'string' as const, required: true, description: 'Test name' },
        'control-id': { type: 'string' as const, description: 'Control ID (for bundle tests)' },
        hostname: { type: 'string' as const, description: 'Hostname (scope to specific host)' },
        justification: { type: 'string' as const, required: true, alias: 'j', description: 'Justification text' },
      },
      handler: async (ctx) => {
        const result = await api.acceptRisk({
          test_name: ctx.flags.test as string,
          control_id: ctx.flags['control-id'] as string | undefined,
          hostname: ctx.flags.hostname as string | undefined,
          justification: ctx.flags.justification as string,
        });
        ctx.output.success(`Risk accepted: ${result.id}`);
      },
    },
    revoke: {
      description: 'Revoke a risk acceptance',
      args: [{ name: 'id', required: true }],
      flags: {
        reason: { type: 'string' as const, required: true, alias: 'r', description: 'Revocation reason' },
      },
      handler: async (ctx) => {
        await api.revokeRiskAcceptance(ctx.args.id, ctx.flags.reason as string);
        ctx.output.success(`Risk acceptance ${ctx.args.id} revoked`);
      },
    },
    list: {
      description: 'List risk acceptances',
      flags: {
        status: { type: 'string' as const, choices: ['active', 'revoked'] },
        'test-name': { type: 'string' as const, description: 'Filter by test name' },
        page: { type: 'number' as const, default: 1 },
        size: { type: 'number' as const, default: 20 },
      },
      handler: async (ctx) => {
        const result = await api.listRiskAcceptances({
          status: ctx.flags.status as 'active' | 'revoked' | undefined,
          test_name: ctx.flags['test-name'] as string | undefined,
          page: ctx.flags.page as number,
          pageSize: ctx.flags.size as number,
        });
        ctx.output.table(
          result.data as unknown as Record<string, unknown>[],
          [
            { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
            { key: 'test_name', label: 'Test', width: 25 },
            { key: 'control_id', label: 'Control', width: 14, transform: (v) => v ? String(v) : colors.dim('—') },
            { key: 'hostname', label: 'Host', width: 16, transform: (v) => v ? String(v) : colors.dim('all') },
            { key: 'status', label: 'Status', width: 8,
              transform: (v) => String(v) === 'active' ? colors.green('active') : colors.red('revoked'),
            },
            { key: 'justification', label: 'Justification', width: 30 },
          ],
          { total: result.total },
        );
      },
    },
    show: {
      description: 'Show risk acceptance details',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        const data = await api.getRiskAcceptance(ctx.args.id);
        ctx.output.detail(data as unknown as Record<string, unknown>);
      },
    },
  },
});
