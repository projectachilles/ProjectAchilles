import { registerCommand } from './registry.js';
import * as api from '../api/integrations.js';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'integrations',
  description: 'Manage integrations (Azure, Defender, Alerts)',
  aliases: ['int'],
  subcommands: {
    'azure-show': {
      description: 'Show Azure AD integration config',
      handler: async (ctx) => {
        const config = await api.getAzureConfig();
        ctx.output.detail(config as unknown as Record<string, unknown>);
      },
    },
    'azure-set': {
      description: 'Configure Azure AD credentials',
      flags: {
        'tenant-id': { type: 'string' as const, description: 'Tenant ID' },
        'client-id': { type: 'string' as const, description: 'Client ID' },
        'client-secret': { type: 'string' as const, description: 'Client secret' },
        label: { type: 'string' as const, description: 'Display label' },
      },
      handler: async (ctx) => {
        await api.setAzureConfig({
          tenant_id: ctx.flags['tenant-id'] as string | undefined,
          client_id: ctx.flags['client-id'] as string | undefined,
          client_secret: ctx.flags['client-secret'] as string | undefined,
          label: ctx.flags.label as string | undefined,
        });
        ctx.output.success('Azure integration updated');
      },
    },
    'azure-delete': {
      description: 'Remove Azure AD configuration',
      handler: async (ctx) => {
        await api.deleteAzureConfig();
        ctx.output.success('Azure integration removed');
      },
    },
    'azure-test': {
      description: 'Test Azure AD connection',
      handler: async (ctx) => {
        const result = await api.testAzureConnection();
        if (result.success) {
          ctx.output.success(result.message ?? 'Connection successful');
        } else {
          ctx.output.error(result.error ?? 'Connection failed');
        }
      },
    },
    'defender-show': {
      description: 'Show Defender integration config',
      handler: async (ctx) => {
        const config = await api.getDefenderConfig();
        ctx.output.detail(config as unknown as Record<string, unknown>);
      },
    },
    'defender-set': {
      description: 'Configure Defender credentials',
      flags: {
        'tenant-id': { type: 'string' as const, description: 'Tenant ID' },
        'client-id': { type: 'string' as const, description: 'Client ID' },
        'client-secret': { type: 'string' as const, description: 'Client secret' },
      },
      handler: async (ctx) => {
        await api.setDefenderConfig({
          tenant_id: ctx.flags['tenant-id'] as string | undefined,
          client_id: ctx.flags['client-id'] as string | undefined,
          client_secret: ctx.flags['client-secret'] as string | undefined,
        });
        ctx.output.success('Defender integration updated');
      },
    },
    'defender-delete': {
      description: 'Remove Defender configuration',
      handler: async (ctx) => {
        await api.deleteDefenderConfig();
        ctx.output.success('Defender integration removed');
      },
    },
    'defender-test': {
      description: 'Test Defender connection',
      handler: async (ctx) => {
        const result = await api.testDefenderConnection();
        if (result.success) {
          ctx.output.success(result.message ?? 'Connection successful');
        } else {
          ctx.output.error(result.error ?? 'Connection failed');
        }
      },
    },
    'defender-sync': {
      description: 'Trigger Defender data sync',
      handler: async (ctx) => {
        await api.triggerDefenderSync();
        ctx.output.success('Defender sync triggered');
      },
    },
    'defender-sync-status': {
      description: 'Show Defender sync status',
      handler: async (ctx) => {
        const status = await api.getDefenderSyncStatus();
        ctx.output.detail(status as unknown as Record<string, unknown>);
      },
    },
    'alerts-show': {
      description: 'Show alerting configuration',
      handler: async (ctx) => {
        const config = await api.getAlertConfig();
        ctx.output.detail(config as unknown as Record<string, unknown>);
      },
    },
    'alerts-set': {
      description: 'Configure alerting thresholds and channels',
      flags: {
        'score-drop': { type: 'number' as const, description: 'Score drop threshold (%)' },
        'score-floor': { type: 'number' as const, description: 'Absolute score floor' },
        cooldown: { type: 'number' as const, description: 'Cooldown minutes' },
        'slack-url': { type: 'string' as const, description: 'Slack webhook URL' },
      },
      handler: async (ctx) => {
        await api.setAlertConfig({
          thresholds: {
            score_drop_percent: ctx.flags['score-drop'] as number | undefined,
            score_floor: ctx.flags['score-floor'] as number | undefined,
          },
          cooldown_minutes: ctx.flags.cooldown as number | undefined,
          slack: ctx.flags['slack-url'] ? { webhook_url: ctx.flags['slack-url'] as string } : undefined,
        });
        ctx.output.success('Alert configuration updated');
      },
    },
    'alerts-test': {
      description: 'Send test alert',
      handler: async (ctx) => {
        const result = await api.testAlert();
        if (result.success) {
          ctx.output.success('Test alert sent');
        } else {
          ctx.output.error('Test alert failed');
        }
      },
    },
    'alerts-history': {
      description: 'Show alert history',
      handler: async (ctx) => {
        const history = await api.getAlertHistory();
        ctx.output.table(
          history as unknown as Record<string, unknown>[],
          [
            { key: 'created_at', label: 'Time', width: 20 },
            { key: 'type', label: 'Type', width: 12 },
            { key: 'severity', label: 'Severity', width: 10 },
            { key: 'message', label: 'Message', width: 40 },
          ],
        );
      },
    },
  },
});
