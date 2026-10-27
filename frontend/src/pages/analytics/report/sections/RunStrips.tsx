import type { ExecutionReport, ReportRun, ReportTest } from '@/services/api/reports';
import { conclusive, defended } from '../lib/outcomes';
import { fmtDate, fmtDuration, fmtLatency, fmtTime, timeOf } from '../lib/format';
import { agentKillText, alertStageText, countStages, testOf, vendorName } from '../lib/runs';
import { RunStrip } from '../diagrams/RunStrip';
import { OutcomeLegend } from '../diagrams/StageGlyph';
import { Sheet, type SheetHead } from './Sheet';
import { AlertsIncompleteNote } from './scope';

type EdrVendors = ExecutionReport['meta']['edrVendors'];

interface RunEvent { t: number | null; text: string }

/** Oldest first; an event without a time goes last. */
function byTimeUndatedLast(a: RunEvent, b: RunEvent): number {
  if (a.t === null || b.t === null) return Number(a.t === null) - Number(b.t === null);
  return a.t - b.t;
}

/** With EDR configured: a run with no alert is "silent" only if its alerts were searched; otherwise it is unchecked. */
function AlertFlag({ run }: { run: ReportRun }) {
  if (run.alerts.length > 0 || run.agentTerminated) return null;
  return run.alertsChecked
    ? <span className="rp-silent">SILENT RUN</span>
    : <span className="rp-unchecked">ALERTS NOT CHECKED</span>;
}

function RunBlock({ run, tests, tz, edrVendors }: { run: ReportRun; tests: ReportTest[]; tz: string; edrVendors: EdrVendors }) {
  const edr = edrVendors.length > 0;
  const c = countStages(run.stages);
  const start = run.startedAt ? Date.parse(run.startedAt) : null;
  const end = Date.parse(run.completedAt);
  const alertEvents: RunEvent[] = edr
    ? run.alerts.map((a) => {
        // An alert whose time does not parse is still listed, last and without a time.
        const t = timeOf(a.createdAt);
        const timing = t === null ? null : start !== null && t >= start && t <= end ? 'during run' : fmtLatency((t - end) / 1000);
        return {
          t,
          text: [
            vendorName(a.vendor), a.severity, a.title, alertStageText(tests, run, a.stageControlId),
            timing, a.status, a.preventionAction ? a.preventionAction.replace(/_/g, ' ') : null,
          ].filter(Boolean).join(' · '),
        };
      })
    : [];
  const events = [
    ...(start !== null ? [{ t: start, text: `Started on ${run.hostname}` }] : []),
    ...alertEvents,
    {
      t: end,
      text: `Completed${start !== null ? ` after ${fmtDuration(end - start)}` : ''} · ${
        run.agentTerminated ? 'protected, stages unknown' : `${defended(c)} of ${conclusive(c)} stages defended`
      }`,
    },
  ].sort(byTimeUndatedLast);

  return (
    <div className="rp-run rp-avoid">
      <h3 className="rp-h3">
        <span>{run.testName} <span className="rp-muted">on</span> <span className="rp-mono">{run.hostname}</span></span>
        <small>{fmtDate(run.completedAt, tz)}{edr && <AlertFlag run={run} />}</small>
      </h3>
      <RunStrip run={run} edrVendors={edrVendors} test={testOf(tests, run)} />
      {run.agentTerminated && <p className="rp-caption">{agentKillText(run)}</p>}
      <ol className="rp-events">
        {events.map((e, i) => (
          <li key={i}><span className="rp-mono rp-muted">{e.t === null ? '—' : fmtTime(new Date(e.t).toISOString(), tz, true)}</span><span>{e.text}</span></li>
        ))}
      </ol>
    </div>
  );
}

export function RunStrips({ report, head }: { report: ExecutionReport; head: SheetHead }) {
  const { edrVendors, unavailable, tz } = report.meta;
  const runs = [...report.runs].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  return (
    <Sheet label="Run timelines" head={head}>
      <div>
        <h2 className="rp-h2">Appendix B · Run timelines</h2>
        <p className="rp-muted">
          Oldest first. Each strip shows one run in minutes from its start{edrVendors.length > 0 ? ', with EDR alerts at their real times' : ''}.
          Stage symbols show order only; stages are not timed individually.
        </p>
        {unavailable.includes('startTimes') && <p className="rp-caption">Run start times unavailable; strips show completion only.</p>}
        <AlertsIncompleteNote report={report} />
      </div>
      <OutcomeLegend highImpact />
      {runs.map((r) => <RunBlock key={r.key} run={r} tests={report.tests} tz={tz} edrVendors={edrVendors} />)}
    </Sheet>
  );
}
