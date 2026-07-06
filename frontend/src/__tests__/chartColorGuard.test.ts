import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/** Chart files that must reference tokens only — no raw color literals. */
const CHART_FILES = [
  'pages/analytics/components/StackedBarChart.tsx',
  'pages/analytics/components/ErrorTypePieChart.tsx',
  'pages/analytics/components/DefenseScoreByHostChart.tsx',
  'pages/analytics/components/CategoryBreakdownChart.tsx',
  'pages/analytics/components/CoverageTreemap.tsx',
  'pages/analytics/components/SeverityBreakdownChart.tsx',
  'pages/analytics/components/AlertsSummaryCard.tsx',
  'pages/analytics/utils/defenderChartColors.ts',
  'components/browser/TestLibraryOverview.tsx',
  'pages/endpoints/AgentDashboardPage.tsx',
  'components/endpoints/agents/detail/AgentHeartbeatTab.tsx',
];

// Raw color literals we forbid inside chart files. `var(--token)` and
// getChartToken('--token') are the only sanctioned color sources.
const RAW_OKLCH = /oklch\(\s*[\d.]/i;            // oklch( followed by a number = literal
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;           // #rgb / #rrggbb / #rrggbbaa
const srcDir = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) =>
  readFileSync(resolve(srcDir, '..', rel), 'utf8');

describe('chart color guard — no raw literals in chart components', () => {
  for (const rel of CHART_FILES) {
    it(`${rel} uses tokens only`, () => {
      const code = src(rel);
      const offenders: string[] = [];
      code.split('\n').forEach((line, i) => {
        // ignore comments
        const stripped = line.replace(/\/\/.*$/, '');
        if (RAW_OKLCH.test(stripped) || RAW_HEX.test(stripped)) {
          offenders.push(`  ${i + 1}: ${line.trim()}`);
        }
      });
      expect(offenders, `raw color literal(s) in ${rel}:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});
