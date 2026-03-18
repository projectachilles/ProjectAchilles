import { registerCommand } from './registry.js';
import * as api from '../api/defender.js';
import { colors, scoreColor } from '../output/colors.js';

registerCommand({
  name: 'defender',
  description: 'Microsoft Defender integration analytics',
  subcommands: {
    score: {
      description: 'Current Microsoft Secure Score',
      handler: async (ctx) => {
        const score = await api.getSecureScore();
        ctx.output.score(score.score, 'Secure Score');
        ctx.output.table(
          score.categories as unknown as Record<string, unknown>[],
          [
            { key: 'name', label: 'Category', width: 30 },
            { key: 'score', label: 'Score', width: 8, align: 'right' },
            { key: 'maxScore', label: 'Max', width: 6, align: 'right' },
          ],
        );
      },
    },
    'score-trend': {
      description: 'Secure Score over time',
      flags: { days: { type: 'number' as const, default: 30 } },
      handler: async (ctx) => {
        const data = await api.getSecureScoreTrend(ctx.flags.days as number);
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'timestamp', label: 'Date', width: 12, transform: (v) => new Date(String(v)).toLocaleDateString() },
            { key: 'score', label: 'Score', width: 8, align: 'right', transform: (v) => scoreColor(Number(v)) },
          ],
        );
      },
    },
    alerts: {
      description: 'Defender alerts',
      flags: {
        severity: { type: 'string' as const, description: 'Filter by severity' },
        status: { type: 'string' as const, description: 'Filter by status' },
        search: { type: 'string' as const, description: 'Search text' },
        page: { type: 'number' as const, default: 1 },
        size: { type: 'number' as const, default: 20 },
      },
      handler: async (ctx) => {
        const data = await api.getAlerts({
          severity: ctx.flags.severity as string | undefined,
          status: ctx.flags.status as string | undefined,
          search: ctx.flags.search as string | undefined,
          page: ctx.flags.page as number,
          pageSize: ctx.flags.size as number,
        });
        ctx.output.table(
          data.alerts as unknown as Record<string, unknown>[],
          [
            { key: 'title', label: 'Title', width: 35 },
            { key: 'severity', label: 'Severity', width: 10,
              transform: (v) => {
                const s = String(v);
                if (s === 'high') return colors.red(s);
                if (s === 'medium') return colors.yellow(s);
                return s;
              },
            },
            { key: 'status', label: 'Status', width: 12 },
            { key: 'category', label: 'Category', width: 16 },
            { key: 'techniques', label: 'Techniques', transform: (v) => Array.isArray(v) ? v.join(', ') : '' },
          ],
          { total: data.pagination.total },
        );
      },
    },
    'alerts-trend': {
      description: 'Alert count over time',
      flags: { days: { type: 'number' as const, default: 30 } },
      handler: async (ctx) => {
        const data = await api.getAlertsTrend(ctx.flags.days as number);
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'timestamp', label: 'Date', width: 12, transform: (v) => new Date(String(v)).toLocaleDateString() },
            { key: 'count', label: 'Alerts', width: 8, align: 'right' },
          ],
        );
      },
    },
    controls: {
      description: 'Defender control profiles',
      flags: { category: { type: 'string' as const } },
      handler: async (ctx) => {
        const data = await api.getControls({ category: ctx.flags.category as string | undefined });
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'title', label: 'Control', width: 35 },
            { key: 'category', label: 'Category', width: 20 },
            { key: 'currentScore', label: 'Score', width: 7, align: 'right' },
            { key: 'maxScore', label: 'Max', width: 5, align: 'right' },
          ],
        );
      },
    },
    'controls-by-category': {
      description: 'Controls grouped by category',
      handler: async (ctx) => {
        const data = await api.getControlsByCategory();
        for (const [category, controls] of Object.entries(data)) {
          ctx.output.raw(`\n  ${colors.bold(category)}`);
          ctx.output.table(
            controls as unknown as Record<string, unknown>[],
            [
              { key: 'title', label: 'Control', width: 35 },
              { key: 'currentScore', label: 'Score', width: 7, align: 'right' },
              { key: 'maxScore', label: 'Max', width: 5, align: 'right' },
            ],
          );
        }
      },
    },
    correlation: {
      description: 'Cross-correlation between Defense Score and Secure Score',
      args: [{ name: 'type', required: true, description: 'Correlation type: score or techniques' }],
      flags: { days: { type: 'number' as const, default: 30 } },
      handler: async (ctx) => {
        if (ctx.args.type === 'score') {
          const data = await api.getScoreCorrelation(ctx.flags.days as number);
          ctx.output.table(
            data as unknown as Record<string, unknown>[],
            [
              { key: 'timestamp', label: 'Date', width: 12, transform: (v) => new Date(String(v)).toLocaleDateString() },
              { key: 'defenseScore', label: 'Defense', width: 9, align: 'right', transform: (v) => scoreColor(Number(v)) },
              { key: 'secureScore', label: 'Secure', width: 9, align: 'right', transform: (v) => scoreColor(Number(v)) },
            ],
          );
        } else if (ctx.args.type === 'techniques') {
          const data = await api.getTechniqueCorrelation();
          ctx.output.result(data);
        } else {
          ctx.output.error(`Unknown correlation type: ${ctx.args.type}. Use 'score' or 'techniques'.`);
        }
      },
    },
  },
});
