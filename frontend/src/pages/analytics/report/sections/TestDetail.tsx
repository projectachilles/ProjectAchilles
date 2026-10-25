import type { ExecutionReport, ReportRun, ReportTest } from '@/services/api/reports';
import { OUTCOME_LABEL, conclusive, defended, protectionRate } from '../lib/outcomes';
import { fmtAlertCount, fmtCount, fmtDateTime, fmtLatency, fmtPct, fmtShortDate, fmtTime, plural, timeOf } from '../lib/format';
import { alertStageText, vendorName } from '../lib/runs';
import { KillChainFlow } from '../diagrams/KillChainFlow';
import { OutcomeBar } from '../diagrams/OutcomeBar';
import { GlyphIcon, GlyphRow, OutcomeLegend } from '../diagrams/StageGlyph';
import { Sheet, type SheetHead } from './Sheet';
import { AlertsIncompleteNote } from './scope';

const MATRIX_MAX_HOSTS = 12;
/** Up to this many stages each get a column; a longer control list becomes one glyph row per endpoint. */
const MATRIX_MAX_STAGE_COLUMNS = 12;
const MATRIX_GLYPHS_MAX = 40;
const ALERTS_SHOWN = 6;

/** `alertsIncomplete`: alert correlation did not complete, so counts are lower bounds (see fmtAlertCount). */
function ControlTable({ test, edr, alertsIncomplete }: { test: ReportTest; edr: boolean; alertsIncomplete: boolean }) {
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>Control</th><th>ID</th><th>Outcomes</th><th className="rp-num">Stage protection rate</th>
          {edr && <th className="rp-num">Alerts</th>}
        </tr>
      </thead>
      <tbody>
        {test.stages.map((s) => (
          <tr key={`${s.order}-${s.controlId ?? 'only'}`}>
            <td>{s.name}</td>
            <td className="rp-mono rp-id">{s.controlId ?? s.techniques.join(', ')}</td>
            <td style={{ width: '28%' }}><OutcomeBar counts={s.outcomes} legend={false} height={6} /></td>
            <td className="rp-num">{fmtPct(protectionRate(s.outcomes))}</td>
            {edr && <td className="rp-num">{fmtAlertCount(s.alerts.defender + s.alerts.crowdstrike + (s.alerts.sentinelone ?? 0), alertsIncomplete)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EndpointMatrix({ test, runs, tz, sampled }: { test: ReportTest; runs: ReportRun[]; tz: string; sampled: boolean }) {
  const latest = new Map<string, ReportRun>();
  for (const r of runs) {
    const current = latest.get(r.hostname);
    if (!current || Date.parse(current.completedAt) < Date.parse(r.completedAt)) latest.set(r.hostname, r);
  }
  const rows = [...latest.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MATRIX_MAX_HOSTS);
  const wide = test.stages.length > MATRIX_MAX_STAGE_COLUMNS;
  const words = test.stages.length <= 5;
  const note = [
    rows.length > MATRIX_MAX_HOSTS ? `First ${MATRIX_MAX_HOSTS} of ${rows.length} endpoints` : '',
    sampled ? 'from the newest runs' : '',
  ].filter(Boolean).join(', ');

  return (
    <div className="rp-avoid">
      <h3 className="rp-h3">Latest result on each endpoint <small>{note}</small></h3>
      <table className="rp-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            {wide ? <th>Stages</th> : test.stages.map((s) => <th key={s.order}>S{s.order}</th>)}
            <th className="rp-num">Last run</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.hostname}>
              <td className="rp-mono rp-id">{r.hostname}</td>
              {wide ? (
                <td><GlyphRow stages={r.stages.filter((x) => x.outcome !== 'skipped')} max={MATRIX_GLYPHS_MAX} /></td>
              ) : (
                test.stages.map((s) => {
                  const rs = r.stages.find((x) => x.controlId === s.controlId) ?? (test.stages.length === 1 ? r.stages[0] : undefined);
                  return (
                    <td key={s.order}>
                      {rs ? (
                        <>
                          <GlyphIcon outcome={rs.outcome} highImpact={rs.highImpact} />
                          {words && <span className="rp-muted"> {OUTCOME_LABEL[rs.outcome]}</span>}
                        </>
                      ) : '—'}
                    </td>
                  );
                })
              )}
              <td className="rp-num">{fmtShortDate(r.completedAt, tz)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!words && <OutcomeLegend highImpact />}
    </div>
  );
}

export function TestDetail({ report, test, head }: { report: ExecutionReport; test: ReportTest; head: SheetHead }) {
  const tz = report.meta.tz;
  const edr = report.meta.edrVendors.length > 0;
  const chain = test.isBundle && test.category !== 'cyber-hygiene';
  const runs = report.runs.filter((r) => r.testKey === test.testKey);
  const alertsIncomplete = report.meta.unavailable.includes('alerts');
  // Stage outcomes are aggregated over every run; the stage alert counts come from the fetched
  // runs only, so they say so when this test's runs were cut to the report's newest.
  const alertsSampled = edr && report.meta.truncation.runs && runs.length < test.runs;
  const runsNote = (
    <small>All {plural(test.runs, 'run')}{alertsSampled ? ` · alert counts from the newest ${fmtCount(runs.length)}` : ''}</small>
  );
  // Newest first; an alert whose time does not parse sorts last and prints a dash for its times.
  const alerts = runs
    .flatMap((r) => r.alerts.map((a) => ({ a, r, t: timeOf(a.createdAt) })))
    .sort((p, q) => (q.t ?? -Infinity) - (p.t ?? -Infinity) || 0)
    .slice(0, ALERTS_SHOWN);

  return (
    <Sheet label={test.name} head={head}>
      <div>
        <h2 className="rp-h2">{test.name}</h2>
        <div className="rp-chips">
          {[test.category, test.subcategory].filter((c): c is string => !!c).map((c) => <span key={c} className="rp-chip">{c}</span>)}
          {test.severity && <span className={`rp-chip${test.severity === 'critical' || test.severity === 'high' ? ' rp-chip-strong' : ''}`}>{test.severity}</span>}
          {test.score !== null && <span className="rp-chip">score {test.score}/10</span>}
          {test.target.map((t) => <span key={t} className="rp-chip">{t}</span>)}
          {test.complexity && <span className="rp-chip">complexity {test.complexity}</span>}
        </div>
      </div>
      <dl className="rp-kv">
        <dt>Test ID</dt>
        <dd className="rp-mono">{test.testKey}</dd>
        <dt>Threat actor</dt>
        <dd>{test.threatActor ?? '—'}</dd>
        <dt>Runs</dt>
        <dd>{plural(test.runs, 'run')} on {plural(test.endpoints, 'endpoint')}{test.lastRun ? ` · last ${fmtDateTime(test.lastRun, tz)}` : ''}</dd>
        <dt>Stage protection rate</dt>
        <dd><b className="rp-mono">{fmtPct(protectionRate(test.outcomes))}</b> · {defended(test.outcomes)} of {conclusive(test.outcomes)} stage results</dd>
      </dl>
      {test.description && <p className="rp-lede">{test.description}</p>}
      {chain ? (
        // The heading rides in the chain's first unbreakable row so it never ends a page alone.
        <KillChainFlow
          test={test}
          edrVendors={report.meta.edrVendors}
          alertsIncomplete={alertsIncomplete}
          heading={<h3 className="rp-h3">Kill chain {runsNote}</h3>}
        />
      ) : (
        <div>
          <h3 className="rp-h3">{test.isBundle ? 'Controls' : 'Result'} {runsNote}</h3>
          <ControlTable test={test} edr={edr} alertsIncomplete={alertsIncomplete} />
        </div>
      )}
      <EndpointMatrix test={test} runs={runs} tz={tz} sampled={report.meta.truncation.runs} />
      <AlertsIncompleteNote report={report} />
      {edr && alerts.length > 0 && (
        <div>
          <h3 className="rp-h3">
            Most recent correlated EDR alerts
            {report.meta.truncation.runs && <small>From the newest runs</small>}
          </h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Raised</th><th>Endpoint</th>{test.isBundle && <th>Stage</th>}<th>EDR</th><th>Alert</th>
                <th className="rp-num">After run</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(({ a, r, t }, i) => (
                <tr key={`${r.key}-${i}`}>
                  <td className="rp-mono rp-nowrap">{t === null ? '—' : `${fmtShortDate(a.createdAt, tz)} ${fmtTime(a.createdAt, tz)}`}</td>
                  <td className="rp-mono rp-id">{r.hostname}</td>
                  {test.isBundle && <td>{alertStageText([test], r, a.stageControlId)}</td>}
                  <td>{vendorName(a.vendor)}</td>
                  <td><span className="rp-chip">{a.severity}</span> {a.title}</td>
                  <td className="rp-num">{t === null ? '—' : fmtLatency((t - Date.parse(r.completedAt)) / 1000)}</td>
                  <td>{a.status}{a.preventionAction ? ` · ${a.preventionAction.replace(/_/g, ' ')}` : ''}{a.autoResolvedAt ? ' · auto-resolved' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  );
}
