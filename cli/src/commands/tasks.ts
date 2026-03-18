import { registerCommand } from './registry.js';
import * as api from '../api/tasks.js';
import { getUserInfo } from '../auth/token-store.js';
import { status as statusIcons, colors, timeAgo } from '../output/colors.js';
import type { ColumnDef } from '../output/table.js';

const taskColumns: ColumnDef[] = [
  { key: 'id', label: 'ID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
  { key: 'type', label: 'Type', width: 15 },
  { key: 'agent_hostname', label: 'Host', width: 16, transform: (v) => v ? String(v) : colors.dim('—') },
  {
    key: 'status', label: 'Status', width: 12,
    transform: (v) => {
      const icon = statusIcons[v as keyof typeof statusIcons] ?? '';
      return `${icon} ${v}`;
    },
  },
  {
    key: 'payload', label: 'Test/Cmd', width: 20,
    transform: (v) => {
      if (!v || typeof v !== 'object') return colors.dim('—');
      const p = v as Record<string, unknown>;
      return String(p.test_name ?? p.command ?? '—');
    },
  },
  { key: 'created_at', label: 'Created', width: 12, transform: (v) => timeAgo(String(v)) },
];

registerCommand({
  name: 'tasks',
  description: 'Manage security test tasks',
  aliases: ['t'],
  subcommands: {
    create: {
      description: 'Create test execution tasks',
      flags: {
        test: { type: 'string', required: true, description: 'Test UUID' },
        agents: { type: 'string', required: true, description: 'Agent IDs (comma-separated)' },
        timeout: { type: 'number', description: 'Execution timeout (seconds)' },
        priority: { type: 'number', description: 'Priority (0-10)' },
      },
      handler: async (ctx) => {
        const user = getUserInfo();
        const agentIds = (ctx.flags.agents as string).split(',').map(s => s.trim());
        const result = await api.createTasks({
          org_id: user?.orgId ?? 'default',
          agent_ids: agentIds,
          payload: {
            test_uuid: ctx.flags.test as string,
            test_name: '', // Backend resolves from UUID
            binary_name: '',
          },
          priority: ctx.flags.priority as number | undefined,
        });
        ctx.output.success(`Created ${result.task_ids.length} task(s)`);
        ctx.output.result(result.task_ids, 'Task IDs');
      },
    },
    command: {
      description: 'Execute an arbitrary command on agents',
      flags: {
        cmd: { type: 'string', required: true, description: 'Command to execute' },
        agents: { type: 'string', required: true, description: 'Agent IDs (comma-separated)' },
        timeout: { type: 'number', description: 'Execution timeout (seconds)' },
      },
      handler: async (ctx) => {
        const user = getUserInfo();
        const agentIds = (ctx.flags.agents as string).split(',').map(s => s.trim());
        const result = await api.createCommandTask({
          org_id: user?.orgId ?? 'default',
          agent_ids: agentIds,
          command: ctx.flags.cmd as string,
          execution_timeout: ctx.flags.timeout as number | undefined,
        });
        ctx.output.success(`Created ${result.task_ids.length} command task(s)`);
      },
    },
    update: {
      description: 'Create agent update tasks',
      flags: {
        agents: { type: 'string', required: true, description: 'Agent IDs (comma-separated)' },
      },
      handler: async (ctx) => {
        const user = getUserInfo();
        const agentIds = (ctx.flags.agents as string).split(',').map(s => s.trim());
        const result = await api.createUpdateTasks({
          org_id: user?.orgId ?? 'default',
          agent_ids: agentIds,
        });
        ctx.output.success(`Created ${result.task_ids.length} update task(s)`);
      },
    },
    uninstall: {
      description: 'Create uninstall tasks',
      flags: {
        agents: { type: 'string', required: true, description: 'Agent IDs (comma-separated)' },
        cleanup: { type: 'boolean', description: 'Perform cleanup after uninstall' },
      },
      handler: async (ctx) => {
        const user = getUserInfo();
        const agentIds = (ctx.flags.agents as string).split(',').map(s => s.trim());
        const result = await api.createUninstallTasks({
          org_id: user?.orgId ?? 'default',
          agent_ids: agentIds,
          cleanup: ctx.flags.cleanup as boolean | undefined,
        });
        ctx.output.success(`Created ${result.task_ids.length} uninstall task(s)`);
      },
    },
    list: {
      description: 'List tasks with filters',
      flags: {
        status: { type: 'string', choices: ['pending', 'assigned', 'downloading', 'executing', 'completed', 'failed', 'expired'], description: 'Filter by status' },
        type: { type: 'string', choices: ['execute_test', 'update_agent', 'uninstall', 'execute_command'], description: 'Filter by type' },
        'agent-id': { type: 'string', description: 'Filter by agent ID' },
        search: { type: 'string', description: 'Search test name or command' },
        limit: { type: 'number', default: 50 },
        offset: { type: 'number', default: 0 },
      },
      handler: async (ctx) => {
        const result = await api.listTasks({
          status: ctx.flags.status as string | undefined,
          type: ctx.flags.type as string | undefined,
          agent_id: ctx.flags['agent-id'] as string | undefined,
          search: ctx.flags.search as string | undefined,
          limit: ctx.flags.limit as number,
          offset: ctx.flags.offset as number,
        });
        ctx.output.table(
          result.tasks as unknown as Record<string, unknown>[],
          taskColumns,
          { total: result.total, limit: ctx.flags.limit as number, offset: ctx.flags.offset as number },
        );
      },
    },
    grouped: {
      description: 'List tasks grouped by batch',
      flags: {
        status: { type: 'string', description: 'Filter by status' },
        type: { type: 'string', description: 'Filter by type' },
        limit: { type: 'number', default: 20 },
      },
      handler: async (ctx) => {
        const result = await api.listTasksGrouped({
          status: ctx.flags.status as string | undefined,
          type: ctx.flags.type as string | undefined,
          limit: ctx.flags.limit as number,
        });
        ctx.output.table(
          result.groups.map(g => ({
            batch_id: g.batch_id,
            type: g.type,
            test_name: g.payload?.test_name ?? g.payload?.command ?? '—',
            agents: g.agent_count,
            statuses: Object.entries(g.status_counts).map(([k, v]) => `${k}:${v}`).join(' '),
            created_at: g.created_at,
          })) as Record<string, unknown>[],
          [
            { key: 'batch_id', label: 'Batch', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
            { key: 'type', label: 'Type', width: 15 },
            { key: 'test_name', label: 'Test/Cmd', width: 20 },
            { key: 'agents', label: 'Agents', width: 7, align: 'right' },
            { key: 'statuses', label: 'Status', width: 25 },
            { key: 'created_at', label: 'Created', width: 12, transform: (v) => timeAgo(String(v)) },
          ],
          { total: result.total },
        );
      },
    },
    show: {
      description: 'Show task details',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        const task = await api.getTask(ctx.args.id);
        ctx.output.detail(task as unknown as Record<string, unknown>, [
          'id', 'type', 'status', 'agent_id', 'agent_hostname',
          'priority', 'created_at', 'assigned_at', 'completed_at',
          'batch_id', 'notes',
        ]);
        if (task.result) {
          ctx.output.raw(colors.bold('\n  Result:'));
          ctx.output.detail(task.result as unknown as Record<string, unknown>, [
            'exit_code', 'hostname', 'execution_duration_ms', 'started_at', 'completed_at',
          ]);
        }
      },
    },
    cancel: {
      description: 'Cancel a pending/assigned task',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        await api.cancelTask(ctx.args.id);
        ctx.output.success(`Task ${ctx.args.id} cancelled`);
      },
    },
    delete: {
      description: 'Delete a completed/failed/expired task',
      args: [{ name: 'id', required: true }],
      handler: async (ctx) => {
        await api.deleteTask(ctx.args.id);
        ctx.output.success(`Task ${ctx.args.id} deleted`);
      },
    },
    notes: {
      description: 'Update task notes',
      args: [
        { name: 'id', required: true },
        { name: 'content', required: true, description: 'Note content' },
      ],
      handler: async (ctx) => {
        await api.updateNotes(ctx.args.id, ctx.args.content);
        ctx.output.success(`Notes updated for task ${ctx.args.id}`);
      },
    },
  },
});
