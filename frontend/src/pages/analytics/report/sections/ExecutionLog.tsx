import type { ExecutionReport, ReportRun } from '@/services/api/reports';
import { conclusive, defended } from '../lib/outcomes';
import { fmtCount, fmtDate, fmtLatency, fmtTime, plural, truncate } from '../lib/format';
import { agentKillText, countStages, firstAlert, vendorName } from '../lib/runs';
import { GlyphRow, OutcomeLegend } from '../diagrams/StageGlyph';
import { Sheet, type SheetHead } from './Sheet';
import { AlertsIncompleteNote } from './scope';

/** Non-breaking spaces: the First alert cell wraps between its parts, never inside one. */
const keep = (part: string) => part.replace(/ /g, '\u00a0');

/**
 * The run's earliest alert; a dash when its alerts were searched and none matched, "not checked" when
 * they were not searched. Alerts that all lack a time still say an alert was raised.
 */
function firstAlertText(run: ReportRun): string {
  const first = firstAlert(run);
  if (first) return `${keep(fmtLatency((Date.parse(first.createdAt) - Date.parse(run.completedAt)) / 1000))} ${vendorName(first.vendor)}`;
  if (run.alerts.length > 0) return `${vendorName(run.alerts[0].vendor)} ${keep('(time unknown)')}`;
  return run.alertsChecked ? '—' : keep('not checked');
}

export function ExecutionLog({ report, head }: { report: ExecutionReport; head: SheetHead }) {
  const tz = report.meta.tz;
  const edr = report.meta.edrVendors.length > 0;
  const runs = [...report.runs].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const summary = report.meta.truncation.runs
    ? `Newest first. The newest ${fmtCount(runs.length)} of ${fmtCount(report.totals.runs, report.totals.runsApproximate)} runs.`
    : `Newest first. All ${plural(runs.length, 'run')}.`;
  return (
    <Sheet label="Execution log" head={head}>
      <div>
        <h2 className="rp-h2">Appendix A · Execution log</h2>
        <p className="rp-muted">{summary}</p>
        <AlertsIncompleteNote report={report} />
      </div>
      <table className="rp-table">
        <thead>
          <tr>
            <th>Completed</th><th>Endpoint</th><th>Test</th><th>Stages</th><th className="rp-num">Defended</th>
            {edr && <th className="rp-num">First alert</th>}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const c = countStages(r.stages);
            return (
              <tr key={r.key}>
                <td className="rp-mono rp-nowrap">{fmtDate(r.completedAt, tz)} {fmtTime(r.completedAt, tz)}</td>
                <td className="rp-mono rp-id">{r.hostname}</td>
                <td>{truncate(r.testName, 40)}</td>
                <td>
                  <GlyphRow stages={r.stages.filter((s) => s.outcome !== 'skipped')} notFetched={r.moreStages} />
                  {r.agentTerminated && <p className="rp-caption">{agentKillText(r)}</p>}
                </td>
                <td className="rp-num">{defended(c)}/{conclusive(c)}</td>
                {edr && <td className="rp-num-wrap">{firstAlertText(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <OutcomeLegend highImpact />
    </Sheet>
  );
}
