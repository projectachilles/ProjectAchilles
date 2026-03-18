import { registerCommand } from './registry.js';
import * as api from '../api/browser.js';
import { colors } from '../output/colors.js';

registerCommand({
  name: 'browser',
  description: 'Browse the security test library',
  aliases: ['b'],
  subcommands: {
    sync: {
      description: 'Trigger git sync of the test library',
      handler: async (ctx) => {
        const result = await api.syncTests();
        ctx.output.success(`${result.message} — ${result.testCount} tests indexed`);
      },
    },
    status: {
      description: 'Check sync status',
      handler: async (ctx) => {
        const status = await api.getSyncStatus();
        ctx.output.detail(status as unknown as Record<string, unknown>);
      },
    },
    list: {
      description: 'List security tests',
      flags: {
        search: { type: 'string', alias: 's', description: 'Search by name or technique' },
        technique: { type: 'string', alias: 't', description: 'Filter by MITRE technique' },
        category: { type: 'string', alias: 'c', description: 'Filter by category' },
        severity: { type: 'string', choices: ['critical', 'high', 'medium', 'low', 'informational'], description: 'Filter by severity' },
      },
      handler: async (ctx) => {
        const result = await api.listTests({
          search: ctx.flags.search as string | undefined,
          technique: ctx.flags.technique as string | undefined,
          category: ctx.flags.category as string | undefined,
          severity: ctx.flags.severity as string | undefined,
        });
        ctx.output.table(
          result.tests as unknown as Record<string, unknown>[],
          [
            { key: 'uuid', label: 'UUID', width: 10, transform: (v) => String(v).slice(0, 8) + '…' },
            { key: 'name', label: 'Name', width: 30 },
            { key: 'category', label: 'Category', width: 16 },
            { key: 'severity', label: 'Severity', width: 10,
              transform: (v) => {
                const s = String(v);
                if (s === 'critical') return colors.brightRed(s);
                if (s === 'high') return colors.red(s);
                if (s === 'medium') return colors.yellow(s);
                return colors.dim(s);
              },
            },
            { key: 'techniques', label: 'Techniques', transform: (v) => Array.isArray(v) ? v.join(', ') : colors.dim('—') },
          ],
          { total: result.count },
        );
      },
    },
    show: {
      description: 'Show test details',
      args: [{ name: 'uuid', required: true }],
      handler: async (ctx) => {
        const result = await api.getTest(ctx.args.uuid);
        // Backend wraps response as { success, test: {...} }
        const test = (result as unknown as { test?: Record<string, unknown> }).test ?? result;
        ctx.output.detail(test as unknown as Record<string, unknown>, [
          'uuid', 'name', 'category', 'subcategory', 'severity',
          'techniques', 'tactics', 'threat_actor', 'target',
          'complexity', 'tags', 'binary_name', 'description', 'source',
        ]);
      },
    },
    file: {
      description: 'View a test file',
      args: [
        { name: 'uuid', required: true },
        { name: 'path', required: true, description: 'File path within the test' },
      ],
      handler: async (ctx) => {
        const result = await api.getTestFile(ctx.args.uuid, ctx.args.path);
        // Backend wraps response as { success, file: {...} }
        const file = (result as unknown as { file?: { content: string } }).file ?? result;
        ctx.output.raw(file.content);
      },
    },
    categories: {
      description: 'List available test categories',
      handler: async (ctx) => {
        const cats = await api.getCategories();
        ctx.output.result(cats);
      },
    },
  },
});
