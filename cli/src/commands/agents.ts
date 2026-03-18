import { registerCommand } from './registry.js';
import * as api from '../api/agents.js';
import { status as statusIcons, colors, timeAgo } from '../output/colors.js';
import type { ColumnDef } from '../output/table.js';

const agentColumns: ColumnDef[] = [
  { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
  { key: 'hostname', label: 'Hostname', width: 20 },
  { key: 'os', label: 'OS', width: 8 },
  { key: 'arch', label: 'Arch', width: 6 },
  { key: 'agent_version', label: 'Version', width: 8 },
  {
    key: 'status', label: 'Status', width: 12,
    transform: (v, row) => {
      const isOnline = row.is_online as boolean;
      const icon = isOnline ? statusIcons.online : statusIcons.offline;
      return `${icon} ${v}`;
    },
  },
  {
    key: 'last_heartbeat', label: 'Last Seen', width: 12,
    transform: (v) => v ? timeAgo(String(v)) : colors.dim('never'),
  },
  { key: 'tags', label: 'Tags', transform: (v) => Array.isArray(v) && v.length ? v.join(', ') : colors.dim('—') },
];

registerCommand({
  name: 'agents',
  description: 'Manage enrolled agents',
  aliases: ['a'],
  subcommands: {
    list: {
      description: 'List agents with optional filters',
      flags: {
        status: { type: 'string', choices: ['active', 'disabled', 'decommissioned', 'online', 'offline', 'stale'], description: 'Filter by status' },
        os: { type: 'string', choices: ['windows', 'linux', 'darwin'], description: 'Filter by OS' },
        tag: { type: 'string', description: 'Filter by tag' },
        'online-only': { type: 'boolean', description: 'Show only online agents' },
        'stale-only': { type: 'boolean', description: 'Show only stale agents' },
        hostname: { type: 'string', description: 'Filter by hostname' },
        limit: { type: 'number', default: 50, description: 'Max results' },
        offset: { type: 'number', default: 0, description: 'Offset for pagination' },
      },
      handler: async (ctx) => {
        const result = await api.listAgents({
          status: ctx.flags.status as string | undefined,
          os: ctx.flags.os as string | undefined,
          tag: ctx.flags.tag as string | undefined,
          online_only: ctx.flags['online-only'] as boolean | undefined,
          stale_only: ctx.flags['stale-only'] as boolean | undefined,
          hostname: ctx.flags.hostname as string | undefined,
          limit: ctx.flags.limit as number | undefined,
          offset: ctx.flags.offset as number | undefined,
        });
        ctx.output.table(
          result.agents as unknown as Record<string, unknown>[],
          agentColumns,
          { total: result.total, limit: ctx.flags.limit as number, offset: ctx.flags.offset as number },
        );
      },
    },
    show: {
      description: 'Show agent details',
      args: [{ name: 'id', required: true, description: 'Agent ID' }],
      handler: async (ctx) => {
        const agent = await api.getAgent(ctx.args.id);
        ctx.output.detail(agent as unknown as Record<string, unknown>, [
          'id', 'hostname', 'os', 'arch', 'agent_version', 'status',
          'last_heartbeat', 'enrolled_at', 'enrolled_by', 'tags',
          'rotation_pending', 'created_at', 'updated_at',
        ]);
      },
    },
    update: {
      description: 'Update agent status',
      args: [{ name: 'id', required: true }],
      flags: {
        status: { type: 'string', choices: ['active', 'disabled'], description: 'New status' },
      },
      handler: async (ctx) => {
        const result = await api.updateAgent(ctx.args.id, {
          status: ctx.flags.status as 'active' | 'disabled' | undefined,
        });
        ctx.output.success(`Agent ${result.id} updated — status: ${result.status}`);
      },
    },
    delete: {
      description: 'Decommission an agent',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        const result = await api.deleteAgent(ctx.args.id);
        ctx.output.success(`Agent ${result.id} decommissioned`);
      },
    },
    'rotate-key': {
      description: 'Rotate an agent\'s API key',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        const result = await api.rotateKey(ctx.args.id);
        ctx.output.success(`Key rotated for agent ${result.agent_id}`);
        ctx.output.warn('The agent will pick up the new key on next heartbeat');
      },
    },
    heartbeats: {
      description: 'Show heartbeat history for an agent',
      args: [{ name: 'id', required: true }],
      flags: {
        days: { type: 'number', default: 7, description: 'Number of days (1-30)' },
      },
      handler: async (ctx) => {
        const result = await api.getHeartbeats(ctx.args.id, ctx.flags.days as number);
        // API may return { heartbeats: [...] } or [...] directly depending on backend version
        const heartbeats = Array.isArray(result) ? result : (result.heartbeats ?? []);
        ctx.output.table(
          heartbeats as unknown as Record<string, unknown>[],
          [
            { key: 'timestamp', label: 'Time', width: 20 },
            { key: 'cpu_percent', label: 'CPU %', width: 7, align: 'right' },
            { key: 'memory_mb', label: 'Mem MB', width: 8, align: 'right' },
            { key: 'disk_free_mb', label: 'Disk MB', width: 8, align: 'right' },
          ],
        );
      },
    },
    events: {
      description: 'Show agent event log',
      args: [{ name: 'id', required: true }],
      flags: {
        type: { type: 'string', description: 'Filter by event type' },
        limit: { type: 'number', default: 20, description: 'Max results' },
      },
      handler: async (ctx) => {
        const result = await api.getEvents(ctx.args.id, {
          event_type: ctx.flags.type as string | undefined,
          limit: ctx.flags.limit as number,
        });
        const events = Array.isArray(result) ? result : (result.events ?? []);
        const total = Array.isArray(result) ? result.length : (result.total ?? events.length);
        ctx.output.table(
          events as unknown as Record<string, unknown>[],
          [
            { key: 'event_type', label: 'Event', width: 20 },
            { key: 'created_at', label: 'Time', width: 20, transform: (v) => timeAgo(String(v)) },
            { key: 'details', label: 'Details', transform: (v) => typeof v === 'object' ? JSON.stringify(v) : String(v ?? '') },
          ],
          { total },
        );
      },
    },
    metrics: {
      description: 'Fleet metrics and health summary',
      handler: async (ctx) => {
        const [metrics, health] = await Promise.all([
          api.getMetrics(),
          api.getFleetHealth(),
        ]);
        ctx.output.detail({
          ...metrics,
          fleet_uptime_30d: `${health.fleet_uptime_percent_30d.toFixed(1)}%`,
          task_success_rate_7d: `${health.task_success_rate_7d.toFixed(1)}%`,
          mtbf_hours: health.mtbf_hours,
          stale_agents: health.stale_agent_count,
        } as unknown as Record<string, unknown>);
      },
    },
  },
});
