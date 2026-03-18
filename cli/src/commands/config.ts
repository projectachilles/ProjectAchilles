import { registerCommand } from './registry.js';
import { loadConfig, setConfigValue, getConfigValue } from '../config/store.js';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'config',
  description: 'View and modify CLI configuration',
  subcommands: {
    list: {
      description: 'Show all configuration values',
      handler: async (ctx) => {
        const config = loadConfig();
        ctx.output.detail(config as unknown as Record<string, unknown>);
      },
    },
    get: {
      description: 'Get a config value (dot notation)',
      args: [{ name: 'key', required: true, description: 'Config key (e.g., server_url, ai.provider)' }],
      handler: async (ctx) => {
        const value = getConfigValue(ctx.args.key);
        if (value === undefined) {
          ctx.output.error(`Key not found: ${ctx.args.key}`);
          process.exit(1);
        }
        ctx.output.result(value);
      },
    },
    set: {
      description: 'Set a config value',
      args: [
        { name: 'key', required: true, description: 'Config key' },
        { name: 'value', required: true, description: 'New value' },
      ],
      handler: async (ctx) => {
        setConfigValue(ctx.args.key, ctx.args.value);
        ctx.output.success(`${ctx.args.key} = ${ctx.args.value}`);
      },
    },
  },
});
