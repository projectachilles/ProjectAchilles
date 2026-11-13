import type { ExecutionReport, ReportHost } from '@/services/api/reports';
import { conclusive, protectionRate } from '../lib/outcomes';
import { fmtCount, fmtLatency, fmtPct, plural, truncate } from '../lib/format';
import { buildVerdict } from '../lib/verdict';
import { CampaignTimeline } from '../diagrams/CampaignTimeline';
import { OutcomeBar } from '../diagrams/OutcomeBar';
import { firstAlertMinutes, median } from '../diagrams/LatencyDotPlot';
import { Sheet, type SheetHead } from './Sheet';
import { AlertsIncompleteNote, PartialBanner, defenseScoreText } from './scope';
import { StageCoverageBlock } from './StageCoverageBlock';

const HOSTS_SHOWN = 12;

/** Weakest first: lowest stage protection rate, then the larger sample; hosts with no verdict last. */
function weakestFirst(a: ReportHost, b: ReportHost): number {
  const ra = protectionRate(a.outcomes);
  const rb = protectionRate(b.outcomes);
  if (ra === null || rb === null) return Number(ra === null) - Number(rb === null);
  return ra - rb || conclusive(b.outcomes) - conclusive(a.outcomes);
}

export function ExecutiveSummary({ report, head }: { report: ExecutionReport; head: SheetHead }) {
  const { totals, defenseScore, meta } = report;
  // No configured EDR vendor means no EDR content at all, not even a placeholder tile.
  const showEdr = meta.edrVendors.length > 0;
  const latency = median(firstAlertMinutes(report.runs));
  const scoreText = defenseScoreText(report);
  const rawScore = defenseScore?.rawScore != null && defenseScore.riskAcceptedCount > 0 ? defenseScore.rawScore : null;
  const hosts = [...report.hosts].sort(weakestFirst).slice(0, HOSTS_SHOWN);
  // report.hosts is a capped aggregation (the busiest endpoints), so the pool is named when it is smaller than the fleet.
  const hostsTitle = `Lowest ${hosts.length} of ${fmtCount(totals.endpoints)} endpoints by stage protection rate${
    report.hosts.length < totals.endpoints ? ` (among the ${fmtCount(report.hosts.length)} busiest)` : ''}`;

  return (
    <Sheet label="Executive summary" head={head}>
      <h2 className="rp-h2">Executive summary</h2>
      <PartialBanner report={report} />
      {meta.warnings.length > 0 && (
        <div className="rp-notice" role="note">
          <b>Some sections are incomplete.</b>
          <ul>{meta.warnings.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>
        </div>
      )}
      <p className="rp-lede">{buildVerdict(report).join(' ')}</p>
      <div className={showEdr ? 'rp-kpis' : 'rp-kpis rp-kpis-5'}>
        <div className="rp-kpi">
          <b className={scoreText === 'unavailable' ? 'rp-kpi-na' : undefined}>{scoreText}</b>
          <span>Defense Score (dashboard){rawScore !== null ? ` · ${rawScore.toFixed(1)}% before accepted risks` : ''}</span>
        </div>
        <div className="rp-kpi"><b>{fmtCount(totals.runs, totals.runsApproximate)}</b><span>Runs</span></div>
        <div className="rp-kpi"><b>{fmtCount(totals.stageResults)}</b><span>Stage results</span></div>
        <div className="rp-kpi"><b>{totals.techniques}</b><span>Techniques in {plural(totals.tactics, 'tactic')}</span></div>
        <div className="rp-kpi"><b>{totals.actors}</b><span>Threat actors</span></div>
        {showEdr && (
          <div className="rp-kpi">
            <b>{latency === null ? '—' : fmtLatency(latency * 60)}</b>
            <span>Median first EDR alert, from run completion{meta.truncation.runs ? ' (newest runs)' : ''}</span>
          </div>
        )}
      </div>
      <AlertsIncompleteNote report={report} />
      <div className="rp-avoid">
        <h3 className="rp-h3">Outcome of every stage <small>{plural(totals.stageResults, 'stage result')}</small></h3>
        <OutcomeBar counts={totals.outcomes} />
      </div>
      <StageCoverageBlock report={report} />
      <div className="rp-avoid">
        <h3 className="rp-h3">Campaign timeline</h3>
        <CampaignTimeline report={report} />
      </div>
      {hosts.length > 0 && (
        <div className="rp-avoid">
          <h3 className="rp-h3">{hostsTitle}</h3>
          <div className="rp-bars">
            {hosts.map((h) => {
              const rate = protectionRate(h.outcomes);
              return (
                <div key={h.hostname} className="rp-bar-row">
                  <span className="rp-mono">{truncate(h.hostname, 18)}</span>
                  <span className="rp-bar" role="img" aria-label={`${h.hostname} ${fmtPct(rate)}`}>
                    <span style={{ width: `${(rate ?? 0) * 100}%` }} />
                  </span>
                  <span className="rp-muted"><b className="rp-mono">{fmtPct(rate)}</b> · {plural(h.runs, 'run')}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}
