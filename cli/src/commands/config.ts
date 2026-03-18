import { registerCommand } from './registry.js';
import {
  loadConfig, setConfigValue, getConfigValue,
  listProfiles, addProfile, removeProfile, useProfile, getActiveProfile,
} from '../config/store.js';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'config',
  description: 'View and modify CLI configuration and profiles',
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
    profiles: {
      description: 'List all profiles',
      handler: async (ctx) => {
        const profiles = listProfiles();
        ctx.output.table(
          profiles as unknown as Record<string, unknown>[],
          [
            {
              key: 'active', label: '', width: 3,
              transform: (v) => v ? colors.brightGreen('▸') : ' ',
            },
            { key: 'name', label: 'Profile', width: 14 },
            { key: 'server_url', label: 'Server URL', width: 40 },
            { key: 'label', label: 'Label', width: 14, transform: (v) => v ? String(v) : colors.dim('—') },
          ],
        );
      },
    },
    'add-profile': {
      description: 'Add a named deployment profile',
      args: [{ name: 'name', required: true, description: 'Profile name (e.g., railway, fly, render)' }],
      flags: {
        url: { type: 'string', required: true, description: 'Server URL (e.g., https://app.projectachilles.io)' },
        label: { type: 'string', description: 'Display label' },
      },
      handler: async (ctx) => {
        addProfile(ctx.args.name, ctx.flags.url as string, ctx.flags.label as string | undefined);
        ctx.output.success(`Profile "${ctx.args.name}" added → ${ctx.flags.url}`);
      },
    },
    'remove-profile': {
      description: 'Remove a profile',
      args: [{ name: 'name', required: true }],
      handler: async (ctx) => {
        if (ctx.args.name === 'default') {
          ctx.output.error('Cannot remove the default profile');
          process.exit(1);
        }
        const removed = removeProfile(ctx.args.name);
        if (removed) {
          ctx.output.success(`Profile "${ctx.args.name}" removed`);
        } else {
          ctx.output.error(`Profile "${ctx.args.name}" not found`);
        }
      },
    },
    use: {
      description: 'Switch active profile',
      args: [{ name: 'name', required: true, description: 'Profile name to activate' }],
      handler: async (ctx) => {
        const switched = useProfile(ctx.args.name);
        if (switched) {
          const profile = getActiveProfile();
          ctx.output.success(`Switched to "${ctx.args.name}" → ${profile.server_url}`);
          ctx.output.warn('Run `achilles login` to authenticate with this deployment');
        } else {
          ctx.output.error(`Profile "${ctx.args.name}" not found. Use \`achilles config add-profile\` first.`);
        }
      },
    },
  },
});
