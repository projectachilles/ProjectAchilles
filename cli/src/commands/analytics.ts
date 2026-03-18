import { registerCommand } from './registry.js';
import * as api from '../api/analytics.js';
import { colors, scoreColor, progressBar } from '../output/colors.js';

/** Shared analytics filter flags */
const filterFlags = {
  org: { type: 'string' as const, description: 'Organization filter' },
  from: { type: 'string' as const, description: 'Start date (ISO)' },
  to: { type: 'string' as const, description: 'End date (ISO)' },
};

function extractFilters(flags: Record<string, unknown>): api.AnalyticsFilterParams {
  return {
    org: flags.org as string | undefined,
    from: flags.from as string | undefined,
    to: flags.to as string | undefined,
  };
}

registerCommand({
  name: 'analytics',
  description: 'Query security analytics from Elasticsearch',
  aliases: ['an'],
  subcommands: {
    score: {
      description: 'Current defense score',
      flags: filterFlags,
      handler: async (ctx) => {
        const score = await api.getDefenseScore(extractFilters(ctx.flags));
        if (ctx.output.isJson) {
          ctx.output.detail({
            score: score.score,
            protected: score.protectedCount,
            unprotected: score.unprotectedCount,
            total_executions: score.totalExecutions,
          });
        } else {
          ctx.output.score(score.score);
          ctx.output.detail({
            protected: score.protectedCount,
            unprotected: score.unprotectedCount,
            total_executions: score.totalExecutions,
          });
        }
      },
    },
    trend: {
      description: 'Defense score over time',
      flags: {
        ...filterFlags,
        interval: { type: 'string' as const, default: '1d', description: 'Time interval (1h, 1d, 1w)' },
        days: { type: 'number' as const, default: 30, description: 'Window in days' },
      },
      handler: async (ctx) => {
        const trend = await api.getScoreTrend({
          ...extractFilters(ctx.flags),
          interval: ctx.flags.interval as string,
          windowDays: ctx.flags.days as number,
        });
        ctx.output.table(
          trend as unknown as Record<string, unknown>[],
          [
            { key: 'timestamp', label: 'Date', width: 12, transform: (v) => new Date(String(v)).toLocaleDateString() },
            { key: 'score', label: 'Score', width: 8, align: 'right', transform: (v) => scoreColor(Number(v)) },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'total', label: 'Total', width: 8, align: 'right' },
          ],
        );
      },
    },
    'by-test': {
      description: 'Score breakdown by individual test',
      flags: { ...filterFlags, limit: { type: 'number' as const, default: 20 } },
      handler: async (ctx) => {
        const data = await api.getScoreByTest({ ...extractFilters(ctx.flags), limit: ctx.flags.limit as number });
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'name', label: 'Test', width: 30 },
            { key: 'score', label: 'Score', width: 8, align: 'right', transform: (v) => scoreColor(Number(v)) },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'count', label: 'Total', width: 8, align: 'right' },
          ],
        );
      },
    },
    'by-technique': {
      description: 'Score breakdown by MITRE technique',
      flags: filterFlags,
      handler: async (ctx) => {
        const data = await api.getScoreByTechnique(extractFilters(ctx.flags));
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'name', label: 'Technique', width: 14 },
            { key: 'score', label: 'Score', width: 8, align: 'right', transform: (v) => scoreColor(Number(v)) },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'count', label: 'Total', width: 8, align: 'right' },
          ],
        );
      },
    },
    'by-hostname': {
      description: 'Score breakdown by hostname',
      flags: { ...filterFlags, limit: { type: 'number' as const, default: 20 } },
      handler: async (ctx) => {
        const data = await api.getScoreByHostname({ ...extractFilters(ctx.flags), limit: ctx.flags.limit as number });
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'hostname', label: 'Hostname', width: 20 },
            { key: 'score', label: 'Score', width: 8, align: 'right', transform: (v) => scoreColor(Number(v)) },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'unprotected', label: 'Unprotected', width: 12, align: 'right' },
            { key: 'total', label: 'Total', width: 8, align: 'right' },
          ],
        );
      },
    },
    'by-org': {
      description: 'Score breakdown by organization',
      flags: { from: filterFlags.from, to: filterFlags.to },
      handler: async (ctx) => {
        const data = await api.getScoreByOrg({
          from: ctx.flags.from as string | undefined,
          to: ctx.flags.to as string | undefined,
        });
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'org', label: 'Org', width: 20 },
            { key: 'score', label: 'Score', width: 8, align: 'right', transform: (v) => scoreColor(Number(v)) },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'count', label: 'Total', width: 8, align: 'right' },
          ],
        );
      },
    },
    executions: {
      description: 'Recent test executions',
      flags: {
        ...filterFlags,
        page: { type: 'number' as const, default: 1 },
        size: { type: 'number' as const, default: 20, description: 'Page size' },
        grouped: { type: 'boolean' as const, description: 'Group by batch' },
      },
      handler: async (ctx) => {
        const isGrouped = ctx.flags.grouped as boolean | undefined;

        if (isGrouped) {
          // Grouped mode returns { groups: ExecutionGroup[], pagination: {...} }
          // Each group has: representative (EnrichedTestExecution), protectedCount, unprotectedCount, totalCount
          const raw = await api.getExecutionsPaginated({
            ...extractFilters(ctx.flags),
            page: ctx.flags.page as number,
            pageSize: ctx.flags.size as number,
            grouped: true,
          }) as unknown as {
            groups: Array<{
              representative: Record<string, unknown>;
              protectedCount: number;
              unprotectedCount: number;
              totalCount: number;
              type: string;
            }>;
            pagination: { totalGroups: number; page: number; pageSize: number };
          };
          const groups = raw.groups ?? [];
          ctx.output.table(
            groups.map(g => ({
              test_name: g.representative?.bundle_name ?? g.representative?.test_name ?? '—',
              hostname: g.representative?.hostname,
              protected: g.protectedCount,
              unprotected: g.unprotectedCount,
              total: g.totalCount,
              timestamp: g.representative?.timestamp,
            })) as Record<string, unknown>[],
            [
              { key: 'test_name', label: 'Test', width: 25 },
              { key: 'hostname', label: 'Host', width: 16 },
              { key: 'protected', label: 'Protected', width: 10, align: 'right' },
              { key: 'unprotected', label: 'Unprotected', width: 12, align: 'right' },
              { key: 'total', label: 'Total', width: 8, align: 'right' },
              { key: 'timestamp', label: 'Last Run', width: 20 },
            ],
            { total: raw.pagination?.totalGroups },
          );
        } else {
          // Flat mode returns { data: [...], pagination: {...} }
          const data = await api.getExecutionsPaginated({
            ...extractFilters(ctx.flags),
            page: ctx.flags.page as number,
            pageSize: ctx.flags.size as number,
          });
          ctx.output.table(
            data.data as unknown as Record<string, unknown>[],
            [
              { key: 'timestamp', label: 'Time', width: 20 },
              { key: 'test_name', label: 'Test', width: 25 },
              { key: 'hostname', label: 'Host', width: 16 },
              { key: 'is_protected', label: 'Outcome', width: 14,
                transform: (v) => {
                  if (v === true) return colors.brightGreen('PROTECTED');
                  if (v === false) return colors.brightRed('UNPROTECTED');
                  return colors.yellow('ERROR');
                },
              },
            ],
            {
              total: data.pagination.total,
              limit: data.pagination.pageSize,
              offset: (data.pagination.page - 1) * data.pagination.pageSize,
            },
          );
        }
      },
    },
    coverage: {
      description: 'Test coverage matrix',
      flags: filterFlags,
      handler: async (ctx) => {
        const data = await api.getTestCoverage(extractFilters(ctx.flags));
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'name', label: 'Test', width: 30 },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'unprotected', label: 'Unprotected', width: 12, align: 'right' },
          ],
        );
      },
    },
    heatmap: {
      description: 'Host × test execution matrix',
      flags: filterFlags,
      handler: async (ctx) => {
        const data = await api.getHostTestMatrix(extractFilters(ctx.flags));
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'hostname', label: 'Host', width: 20 },
            { key: 'testName', label: 'Test', width: 25 },
            { key: 'count', label: 'Count', width: 8, align: 'right' },
          ],
        );
      },
    },
    techniques: {
      description: 'MITRE technique distribution',
      flags: filterFlags,
      handler: async (ctx) => {
        const data = await api.getTechniqueDistribution(extractFilters(ctx.flags));
        ctx.output.table(
          data as unknown as Record<string, unknown>[],
          [
            { key: 'technique', label: 'Technique', width: 14 },
            { key: 'protected', label: 'Protected', width: 10, align: 'right' },
            { key: 'unprotected', label: 'Unprotected', width: 12, align: 'right' },
          ],
        );
      },
    },
    errors: {
      description: 'Error rate breakdown',
      flags: filterFlags,
      handler: async (ctx) => {
        const data = await api.getErrorRate(extractFilters(ctx.flags));
        ctx.output.detail(data as unknown as Record<string, unknown>);
      },
    },
    hostnames: {
      description: 'Count of unique hostnames',
      flags: { org: filterFlags.org },
      handler: async (ctx) => {
        const data = await api.getUniqueHostnames(ctx.flags.org as string | undefined);
        ctx.output.result(data.count, 'Unique Hostnames');
      },
    },
    tests: {
      description: 'Count of unique tests executed',
      flags: { org: filterFlags.org },
      handler: async (ctx) => {
        const data = await api.getUniqueTests(ctx.flags.org as string | undefined);
        ctx.output.result(data.count, 'Unique Tests');
      },
    },
  },
});
