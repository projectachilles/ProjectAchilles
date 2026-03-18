import { registerCommand } from './registry.js';
import * as api from '../api/schedules.js';
import { colors, timeAgo } from '../output/colors.js';
import { status as statusIcons } from '../output/colors.js';

registerCommand({
  name: 'schedules',
  description: 'Manage recurring test schedules',
  subcommands: {
    create: {
      description: 'Create a new schedule',
      flags: {
        name: { type: 'string', description: 'Schedule name' },
        test: { type: 'string', required: true, description: 'Test UUID' },
        agents: { type: 'string', required: true, description: 'Agent IDs (comma-separated)' },
        type: { type: 'string', required: true, choices: ['once', 'daily', 'weekly', 'monthly'], description: 'Schedule type' },
        config: { type: 'string', required: true, description: 'Schedule config JSON (e.g., \'{"time":"14:00"}\')' },
        timezone: { type: 'string', default: 'UTC', description: 'Timezone' },
      },
      handler: async (ctx) => {
        let scheduleConfig: Record<string, unknown>;
        try {
          scheduleConfig = JSON.parse(ctx.flags.config as string);
        } catch {
          ctx.output.error('Invalid JSON in --config');
          process.exit(1);
          return;
        }
        const result = await api.createSchedule({
          name: ctx.flags.name as string | undefined,
          agent_ids: (ctx.flags.agents as string).split(',').map(s => s.trim()),
          org_id: 'default', // Will be set by backend from JWT
          test_uuid: ctx.flags.test as string,
          test_name: '',
          binary_name: '',
          schedule_type: ctx.flags.type as 'once' | 'daily' | 'weekly' | 'monthly',
          schedule_config: scheduleConfig,
          timezone: ctx.flags.timezone as string,
        });
        ctx.output.success(`Schedule ${result.id} created — next run: ${result.next_run_at ?? 'N/A'}`);
      },
    },
    list: {
      description: 'List schedules',
      flags: {
        status: { type: 'string', choices: ['active', 'paused', 'completed', 'deleted'], description: 'Filter by status' },
      },
      handler: async (ctx) => {
        const schedules = await api.listSchedules({
          status: ctx.flags.status as string | undefined,
        });
        ctx.output.table(
          schedules as unknown as Record<string, unknown>[],
          [
            { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
            { key: 'name', label: 'Name', width: 16, transform: (v) => v ? String(v) : colors.dim('—') },
            { key: 'test_name', label: 'Test', width: 20 },
            { key: 'schedule_type', label: 'Type', width: 8 },
            {
              key: 'status', label: 'Status', width: 10,
              transform: (v) => {
                const iconKey = v === 'active' ? 'schedule_active' : v === 'completed' ? 'schedule_completed' : v as string;
                const icon = statusIcons[iconKey as keyof typeof statusIcons] ?? '';
                return `${icon} ${v}`;
              },
            },
            { key: 'next_run_at', label: 'Next Run', width: 14, transform: (v) => v ? timeAgo(String(v)) : colors.dim('—') },
            { key: 'agent_ids', label: 'Agents', width: 7, align: 'right', transform: (v) => String(Array.isArray(v) ? v.length : 0) },
          ],
        );
      },
    },
    show: {
      description: 'Show schedule details',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        const schedule = await api.getSchedule(ctx.args.id);
        ctx.output.detail(schedule as unknown as Record<string, unknown>, [
          'id', 'name', 'test_name', 'schedule_type', 'schedule_config',
          'timezone', 'status', 'next_run_at', 'last_run_at',
          'agent_ids', 'priority', 'created_by', 'created_at',
        ]);
      },
    },
    update: {
      description: 'Update a schedule (pause/resume/modify)',
      args: [{ name: 'id', required: true }],
      flags: {
        pause: { type: 'boolean', description: 'Pause the schedule' },
        resume: { type: 'boolean', description: 'Resume the schedule' },
        config: { type: 'string', description: 'New schedule config JSON' },
        name: { type: 'string', description: 'New name' },
      },
      handler: async (ctx) => {
        const update: Record<string, unknown> = {};
        if (ctx.flags.pause) update.status = 'paused';
        if (ctx.flags.resume) update.status = 'active';
        if (ctx.flags.config) {
          try {
            update.schedule_config = JSON.parse(ctx.flags.config as string);
          } catch {
            ctx.output.error('Invalid JSON in --config');
            process.exit(1);
          }
        }
        if (ctx.flags.name) update.name = ctx.flags.name;

        const result = await api.updateSchedule(ctx.args.id, update);
        ctx.output.success(`Schedule ${result.id} updated — status: ${result.status}`);
      },
    },
    delete: {
      description: 'Delete a schedule',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        await api.deleteSchedule(ctx.args.id);
        ctx.output.success(`Schedule ${ctx.args.id} deleted`);
      },
    },
  },
});
