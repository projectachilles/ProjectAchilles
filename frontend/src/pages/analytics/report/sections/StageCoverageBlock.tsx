import type { ExecutionReport } from '@/services/api/reports';
import type { StageCoverageGroup, StageCoverageResponse } from '@/services/api/analytics';
import { plural } from '../lib/format';
import { GlyphIcon } from '../diagrams/StageGlyph';

const TITLE = 'Attack chains: how many stages caught them';

/** A printed page has no tooltip: a row names this many tests, then says how many more. */
const NAMES_SHOWN = 6;

const ROWS: { key: keyof Pick<StageCoverageResponse, 'singleStage' | 'depthNotTested' | 'layered' | 'noneCaught'>; label: string; sub: string }[] = [
  { key: 'singleStage', label: 'Rest on a single stage', sub: 'ran every stage, one caught' },
  { key: 'depthNotTested', label: 'Depth not tested', sub: 'one caught, later stages did not run' },
  { key: 'layered', label: 'Two or more stages caught', sub: 'layered' },
  { key: 'noneCaught', label: 'No stage caught', sub: 'ran end to end' },
];

const SEGMENTS = [
  { key: 'blocked', label: 'Blocked', seg: 'protected', glyph: 'protected' },
  { key: 'detected', label: 'Detected', seg: 'detected', glyph: 'detected' },
  { key: 'through', label: 'Got through', seg: 'through', glyph: 'unprotected' },
] as const;

function names(group: StageCoverageGroup): string {
  if (group.bundleNames.length === 0) return '—';
  const shown = group.bundleNames.slice(0, NAMES_SHOWN);
  const more = group.bundleNames.length - shown.length;
  return more > 0 ? `${shown.join('; ')}; and ${more} more` : shown.join('; ');
}

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/**
 * Stage coverage of the attack chains, as on the dashboard card: the latest run of each chain in
 * the period. Nothing is printed when the backend has no such figures or there are no chains.
 */
export function StageCoverageBlock({ report }: { report: ExecutionReport }) {
  if (report.meta.unavailable.includes('stageCoverage')) {
    return (
      <div className="rp-avoid">
        <h3 className="rp-h3">{TITLE}</h3>
        <p className="rp-muted">Stage coverage unavailable — see the notice above.</p>
      </div>
    );
  }
  const sc = report.stageCoverage;
  if (!sc || sc.chains === 0) return null;

  const caught = sc.blocked + sc.detected;
  const present = SEGMENTS.filter((s) => sc[s.key] > 0);
  const barLabel = SEGMENTS.map((s) => `${s.label} ${sc[s.key]}`).join(', ');

  return (
    <div className="rp-avoid">
      <h3 className="rp-h3">
        {TITLE} <small>{plural(sc.chains, 'chain')} · latest run of each multi-stage test per endpoint in this period</small>
      </h3>
      <div className="rp-sc-figs">
        <div className="rp-kpi">
          <b>{sc.coverage === null ? '—' : `${Math.round(sc.coverage)}%`}</b>
          <span>{`of stages caught (${caught} of ${sc.stagesRan})`}</span>
        </div>
        <div className="rp-kpi">
          <b>{pct(sc.chainsProtected, sc.chains)}</b>
          <span>{`of these chains protected (${sc.chainsProtected} of ${sc.chains}): the Defense Score rule, any stage caught`}</span>
        </div>
      </div>
      <div className="rp-obar">
        <div className="rp-obar-track" style={{ height: 12 }} role="img" aria-label={barLabel}>
          {present.map((s) => (
            <span key={s.key} className={`rp-seg rp-seg-${s.seg}`} style={{ flexGrow: sc[s.key] }} />
          ))}
        </div>
        <div className="rp-legend">
          {SEGMENTS.map((s) => (
            <span key={s.key}>
              <GlyphIcon outcome={s.glyph} />
              <span>{s.label}</span>
              <b>{sc[s.key].toLocaleString('en-US')}</b>
            </span>
          ))}
        </div>
      </div>
      <table className="rp-table rp-sc-table">
        <thead>
          <tr>
            <th scope="col">Chains that</th>
            <th scope="col" className="rp-num">Chains</th>
            <th scope="col">Tests</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.key}>
              <td>
                <b>{row.label}</b>
                <span>{row.sub}</span>
              </td>
              <td className="rp-num">{sc[row.key].count.toLocaleString('en-US')}</td>
              <td>{names(sc[row.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rp-caption">
        A chain is one multi-stage test on one endpoint. Only the latest run of each chain in the period is counted, so
        these figures differ from the bar above, which counts every stage result. Runs the EDR stopped before any stage
        ran are not counted. A test appears in more than one row when its chains differ by endpoint.
      </p>
    </div>
  );
}
