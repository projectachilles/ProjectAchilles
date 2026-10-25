// Time from run completion to each run's first EDR alert (spec §5.4).
// Negative values fired before the run completed.
import type { ReportAlert, ReportRun } from '@/services/api/reports';
import { fmtLatency, plural, timeOf } from '../lib/format';

const W = 680;
const X0 = 156;
const X1 = W - 14;
const LO = -10;
const HI = 30;
const ROW_H = 40;

/**
 * Minutes from completion to each run's first alert (optionally for one vendor). Runs without one
 * are skipped, and so are alerts whose time does not parse.
 */
export function firstAlertMinutes(runs: ReportRun[], vendor?: ReportAlert['vendor']): number[] {
  return runs.flatMap((r) => {
    const times = r.alerts
      .filter((a) => !vendor || a.vendor === vendor)
      .map((a) => timeOf(a.createdAt))
      .filter((t): t is number => t !== null);
    return times.length ? [(Math.min(...times) - Date.parse(r.completedAt)) / 60_000] : [];
  });
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ROWS: { key: ReportAlert['vendor'] | 'any'; label: string }[] = [
  { key: 'defender', label: 'Microsoft Defender' },
  { key: 'crowdstrike', label: 'CrowdStrike Falcon' },
  { key: 'sentinelone', label: 'SentinelOne Singularity' },
  { key: 'any', label: 'First alert, any EDR' },
];

export function LatencyDotPlot({ runs }: { runs: ReportRun[] }) {
  const rows = ROWS
    .map((r) => ({ ...r, values: firstAlertMinutes(runs, r.key === 'any' ? undefined : r.key) }))
    .filter((r) => r.values.length > 0);
  if (rows.length === 0) return null;

  const x = (m: number) => X0 + ((Math.max(LO, Math.min(HI, m)) - LO) / (HI - LO)) * (X1 - X0);
  const height = rows.length * ROW_H;
  const tick = (m: number) => (m > 0 ? `+${m}` : m < 0 ? `−${-m}` : '0');

  return (
    <figure className="rp-figure rp-avoid">
      <svg className="rp-svg" viewBox={`0 0 ${W} ${height + 30}`} role="img" aria-label="Minutes from run completion to first EDR alert">
        <rect className="rp-shade" x={x(LO)} y={0} width={x(0) - x(LO)} height={height} />
        {[-10, -5, 0, 5, 10, 20, 30].map((m) => (
          <g key={m}>
            <line className={m === 0 ? 'rp-zero' : 'rp-grid'} x1={x(m)} x2={x(m)} y1={0} y2={height} />
            <text className="rp-tick" stroke="none" x={x(m)} y={height + 11} textAnchor="middle">{tick(m)}{m === HI ? ' min' : ''}</text>
          </g>
        ))}
        <text className="rp-sub" stroke="none" x={(x(LO) + x(0)) / 2} y={height + 24} textAnchor="middle">before completion</text>
        <text className="rp-sub" stroke="none" x={x(12)} y={height + 24} textAnchor="middle">after the run completed</text>
        {rows.map((r, i) => {
          const yc = i * ROW_H + ROW_H / 2;
          const med = median(r.values);
          return (
            <g key={r.key}>
              <line className="rp-grid" x1={X0} x2={X1} y1={(i + 1) * ROW_H} y2={(i + 1) * ROW_H} />
              <text className="rp-lab" stroke="none" x={0} y={yc - 2}>{r.label}</text>
              <text className="rp-sub" stroke="none" x={0} y={yc + 10}>{plural(r.values.length, 'run')} · median {med === null ? '—' : fmtLatency(med * 60)}</text>
              {r.values.map((v, j) => (
                <circle key={j} className={`rp-dot-${r.key}`} cx={x(v)} cy={yc + (((j * 37) % 11) - 5) * (ROW_H / 16)} r={2.6} />
              ))}
              {med !== null && <line className="rp-median" x1={x(med)} x2={x(med)} y1={yc - ROW_H * 0.38} y2={yc + ROW_H * 0.38} />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
