// Section order, page breaks and the @page rules (spec §5.4).
import type { ExecutionReport } from '@/services/api/reports';
import { RUN_STRIP_MAX_RUNS } from './lib/outcomes';
import { hasRunVersions } from './lib/runs';
import { Sheet, type SheetHead } from './sections/Sheet';
import { ScopeList, orgLabel, windowText } from './sections/scope';
import { Cover } from './sections/Cover';
import { ExecutiveSummary } from './sections/ExecutiveSummary';
import { ActorsAndCoverage } from './sections/ActorsAndCoverage';
import { TestDetail } from './sections/TestDetail';
import { Findings } from './sections/Findings';
import { ExecutionLog } from './sections/ExecutionLog';
import { RunStrips } from './sections/RunStrips';
import { Method } from './sections/Method';

export type Paper = 'A4' | 'Letter';
export const MARKINGS = ['TLP:RED', 'TLP:AMBER+STRICT', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR', 'None'] as const;
export type Marking = (typeof MARKINGS)[number];

/** A CSS string literal for `content:`; quotes and backslashes escaped, line breaks (CR, LF, FF) flattened. */
export function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]+/g, ' ')}"`;
}

function headFor(report: ExecutionReport): SheetHead {
  const org = report.meta.org.name ?? report.meta.org.id;
  return { left: `${org ?? 'ProjectAchilles'} · Security Validation Report`, right: windowText(report) };
}

/** Margin-box typography. The ink is a custom property that report.css defines on the root only while the report is mounted. */
const MARGIN_BOX = 'font-family: "JetBrains Mono Variable", monospace; font-size: 7.5pt; color: var(--rp-margin-ink);';

/**
 * Every `@page` rule the report needs: size, margins and margin-box content and
 * typography. They are injected while the report is mounted and removed with it,
 * because report.css stays loaded after the user navigates away and a global
 * `@page` would then change how every other page prints.
 * Page numbers render in Chromium-based browsers, which support margin boxes.
 */
export function pageCss(report: ExecutionReport, paper: Paper, marking: Marking): string {
  const head = headFor(report);
  const foot = marking === 'None' ? report.meta.reportId : `${marking} · ${report.meta.reportId}`;
  return [
    `@page { size: ${paper === 'Letter' ? 'letter' : 'A4'}; margin: 16mm 14mm 18mm;`,
    `  @top-left { content: ${cssString(head.left)}; ${MARGIN_BOX} }`,
    `  @top-right { content: ${cssString(head.right)}; ${MARGIN_BOX} }`,
    `  @bottom-left { content: ${cssString(foot)}; ${MARGIN_BOX} }`,
    `  @bottom-right { content: "Page " counter(page) " of " counter(pages); ${MARGIN_BOX} } }`,
    `@page :first { @top-left { content: none; } @top-right { content: none; } }`,
  ].join('\n');
}

export function ReportDocument({ report, paper, marking }: { report: ExecutionReport; paper: Paper; marking: Marking }) {
  const head = headFor(report);
  const showStrips = report.totals.runs > 0
    && report.totals.runs <= RUN_STRIP_MAX_RUNS
    && report.runs.length === report.totals.runs;

  return (
    <>
      <style data-report-page>{pageCss(report, paper, marking)}</style>
      <div className={`rp-doc rp-paper-${paper.toLowerCase()}`}>
        <Cover report={report} marking={marking} />
        {report.totals.runs === 0 ? (
          <Sheet label="No executions" head={head}>
            <h2 className="rp-h2">No executions match these filters</h2>
            <p className="rp-muted">
              Nothing ran in this window for {orgLabel(report)} with the filters below. Widen the date range or remove filters on the All Executions tab, then open the report again.
            </p>
            <ScopeList report={report} />
          </Sheet>
        ) : (
          <>
            <ExecutiveSummary report={report} head={head} />
            <ActorsAndCoverage report={report} head={head} />
            {report.tests.map((t) => <TestDetail key={t.testKey} report={report} test={t} head={head} />)}
            <Findings report={report} head={head} />
            <ExecutionLog report={report} head={head} />
            {showStrips && <RunStrips report={report} head={head} />}
            <Method
              head={head}
              edrVendors={report.meta.edrVendors}
              versions={hasRunVersions(report.runs) ? { generatedAt: report.meta.generatedAt, tz: report.meta.tz } : undefined}
            />
          </>
        )}
      </div>
    </>
  );
}
