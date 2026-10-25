// One run on a minutes-from-start axis: the run bar with its stages in order
// (not individually timed), and EDR alerts at their real times (spec §5.4).
import type { ReportAlert, ReportRun, ReportRunStage, ReportTest, StageOutcome } from '@/services/api/reports';
import { COUNTED_OUTCOMES, emptyCounts } from '../lib/outcomes';
import { fmtLatency, plural, timeOf } from '../lib/format';
import { stageForAlert, vendorName } from '../lib/runs';
import { Glyph } from './StageGlyph';

const W = 680;
const X0 = 6;
const X1 = W - 40;
const BAR_Y = 44;
const BAR_H = 20;
/** Without a start time the axis opens at the console's 5-minute correlation lead. */
const LEAD_MIN = 5;
const TICK_MIN = 5;
const MIN_SPAN_MIN = 25;
/** Average advance of the 8 px label face; sizes labels so overlapping or end-anchored ones can be stacked. */
const CHAR_PX = 4.4;
const LABEL_PAD_PX = 6;
const LABEL_ROW_PX = 12;
/** Label rows that fit above the bar in the base height; more rows grow the strip. */
const FREE_LABEL_ROWS = 3;
/** Above this many drawn stages (or with any not fetched) the run bar summarises instead of drawing a glyph each. */
const MAX_GLYPHS = 16;
const SEGMENT_H = 12;
const CAPTION_H = 12;

/**
 * "S<n>" for the stage an alert's evidence names (the same numbering as the kill-chain chevrons),
 * or "bundle". The match is stageForAlert's: case-insensitive, optional variant suffix, and the
 * run's `test` supplies the stages beyond the run's fetched 60. A standalone test's alert gets ''.
 */
export function stageLabelFor(run: ReportRun, token: string | null, test?: ReportTest): string {
  if (test && !test.isBundle) return '';
  const stage = stageForAlert(run, token, test?.stages);
  return stage ? `S${stage.order}` : 'bundle';
}

/** Where a label sits beside a marker at `ax`: to its right, or ending at it when it would leave the page. */
function placeLabel(ax: number, text: string) {
  const w = text.length * CHAR_PX;
  return ax + 4 + w > W
    ? { anchor: 'end' as const, x: ax - 4, from: ax - 4 - w, to: ax }
    : { anchor: 'start' as const, x: ax + 4, from: ax, to: ax + 4 + w };
}

interface Segment { outcome: StageOutcome; highImpact: boolean; n: number }

/** Outcome mix of the drawn stages. Unprotected splits in two so high-impact stages keep their dark-red mark. */
function outcomeSegments(stages: ReportRunStage[]): Segment[] {
  const counts = emptyCounts();
  let highImpact = 0;
  for (const s of stages) {
    counts[s.outcome] += 1;
    if (s.outcome === 'unprotected' && s.highImpact) highImpact += 1;
  }
  return COUNTED_OUTCOMES.flatMap((outcome): Segment[] =>
    outcome === 'unprotected'
      ? [{ outcome, highImpact: false, n: counts[outcome] - highImpact }, { outcome, highImpact: true, n: highImpact }]
      : [{ outcome, highImpact: false, n: counts[outcome] }],
  ).filter((seg) => seg.n > 0);
}

/**
 * `edrVendors` is meta.edrVendors. With none configured the strip carries no EDR content at all:
 * no markers, no labels, and no "none" / "not checked" message (the backend marks every run
 * unchecked then, which would otherwise read as a gap). `test` is the run's test from report.tests,
 * which labels alerts on stages the run did not fetch and marks a standalone test.
 */
export function RunStrip({ run, edrVendors = ['defender', 'crowdstrike'], test }: {
  run: ReportRun;
  edrVendors?: ReportAlert['vendor'][];
  test?: ReportTest;
}) {
  const edr = edrVendors.length > 0;
  const runAlerts = edr ? run.alerts : [];
  // An alert whose time does not parse has no place on the axis, but it still means the run was not silent.
  const timed = runAlerts.flatMap((a) => {
    const t = timeOf(a.createdAt);
    return t === null ? [] : [{ a, t }];
  });
  const end = Date.parse(run.completedAt);
  const start = run.startedAt ? Date.parse(run.startedAt) : null;
  // Axis zero is the run start, or (start unknown) five minutes before completion. The axis
  // reaches back past zero for an alert raised before it, so no marker is drawn off the page.
  const zero = start ?? end - LEAD_MIN * 60_000;
  const alertMin = timed.map(({ t }) => (t - zero) / 60_000);
  const lo = Math.floor(Math.min(0, ...alertMin) / TICK_MIN) * TICK_MIN;
  const hi = Math.max(MIN_SPAN_MIN, Math.ceil(Math.max((end - zero) / 60_000, ...alertMin) / TICK_MIN) * TICK_MIN);
  const x = (t: number) => X0 + (((t - zero) / 60_000 - lo) / (hi - lo)) * (X1 - X0);
  const ticks = Array.from({ length: (hi - lo) / TICK_MIN + 1 }, (_, i) => lo + i * TICK_MIN);
  const tickLabel = (m: number) => {
    const v = start !== null ? m : m - LEAD_MIN;
    if (v === 0) return '0';
    if (v < 0) return `−${-v}`;
    return start !== null ? `${v}` : `+${v}`;
  };

  // Each alert label goes on the first row where it overlaps no earlier label.
  const taken: Array<Array<[number, number]>> = [];
  const alerts = [...timed]
    .sort((p, q) => p.t - q.t)
    .map(({ a, t }) => {
      const ax = x(t);
      const during = start !== null && t >= start && t <= end;
      const vendor = vendorName(a.vendor);
      const text = [`${vendor} ${during ? 'during run' : fmtLatency((t - end) / 1000)}`, stageLabelFor(run, a.stageControlId, test)]
        .filter(Boolean)
        .join(' · ');
      const label = placeLabel(ax, text);
      let row = 0;
      while (taken[row]?.some(([from, to]) => label.from < to + LABEL_PAD_PX && label.to > from - LABEL_PAD_PX)) row++;
      if (!taken[row]) taken[row] = [];
      taken[row].push([label.from, label.to]);
      return { a, ax, row, label, text };
    });

  const barY = BAR_Y + Math.max(0, taken.length - FREE_LABEL_ROWS) * LABEL_ROW_PX;
  const cy = barY + BAR_H / 2;
  // No alerts is only "none" when every configured vendor was searched; otherwise it is unknown.
  const emptyText = !edr || runAlerts.length > 0 ? null : run.alertsChecked ? 'no EDR alert within 30 min' : 'alerts not checked';
  const empty = emptyText === null ? null : { text: emptyText, ...placeLabel(x(end) + 4, emptyText) };
  // Skipped stages are not results, so they get no mark on the bar. A long run (or one with
  // stages not fetched) is summarised as proportional segments rather than silently cut short.
  const drawn = run.stages.filter((s) => s.outcome !== 'skipped');
  const summarised = drawn.length > MAX_GLYPHS || run.moreStages > 0;
  const bar = start === null ? null : { x0: x(start), w: Math.max(2, x(end) - x(start)) };
  const segments = summarised ? outcomeSegments(drawn) : [];
  const total = segments.reduce((sum, seg) => sum + seg.n, 0);
  let used = 0;
  const placed = bar
    ? segments.map((seg) => {
        const w = (seg.n / total) * bar.w;
        const placedSeg = { seg, x: bar.x0 + used, w };
        used += w;
        return placedSeg;
      })
    : [];
  const caption = bar && summarised
    ? `${plural(drawn.length, 'stage')}${run.moreStages > 0 ? ` (+${run.moreStages.toLocaleString('en-US')} not fetched)` : ''}`
    : null;

  return (
    <svg
      className="rp-svg rp-avoid"
      viewBox={`0 0 ${W} ${barY + BAR_H + 26 + (caption ? CAPTION_H : 0)}`}
      role="img"
      aria-label={start !== null ? 'Run timeline in minutes from start' : 'Alerts in minutes from run completion'}
    >
      {ticks.map((m) => {
        const tx = x(zero + m * 60_000);
        return (
          <g key={m}>
            <line className="rp-grid" x1={tx} x2={tx} y1={barY - 4} y2={barY + BAR_H + 6} />
            <text className="rp-tick" stroke="none" x={tx} y={barY + BAR_H + 17} textAnchor="middle">{tickLabel(m)}{m === hi ? ' min' : ''}</text>
          </g>
        );
      })}
      {bar ? (
        <>
          <rect className="rp-run-bar" x={bar.x0} y={barY} width={bar.w} height={BAR_H} rx={2} />
          {summarised
            ? placed.map(({ seg, x: sx, w }) => (
                <rect
                  key={`${seg.outcome}-${seg.highImpact}`}
                  className={`rp-g rp-g-${seg.outcome}${seg.highImpact ? ' rp-g-hi' : ''}`}
                  x={sx} y={barY + (BAR_H - SEGMENT_H) / 2} width={w} height={SEGMENT_H}
                />
              ))
            : drawn.map((s, i) => {
                const step = bar.w / drawn.length;
                return <Glyph key={i} outcome={s.outcome} highImpact={s.highImpact} x={bar.x0 + step * (i + 0.5) - 4.5} y={barY + (BAR_H - 9) / 2} size={9} />;
              })}
          {caption && <text className="rp-sub" stroke="none" x={bar.x0} y={barY + BAR_H + 29}>{caption}</text>}
        </>
      ) : (
        <>
          <line className="rp-marker" x1={x(end)} x2={x(end)} y1={barY - 2} y2={barY + BAR_H + 2} />
          <text className="rp-sub" stroke="none" x={x(end) + 4} y={barY + BAR_H - 2}>completed (start time unavailable)</text>
        </>
      )}
      {alerts.map(({ a, ax, row, label, text }, i) => {
        const ly = barY - 10 - row * LABEL_ROW_PX;
        return (
          <g key={i}>
            <line className="rp-conn" x1={ax} x2={ax} y1={ly + 3} y2={cy - 6} />
            <path className={`rp-al-${a.vendor}`} d={`M${ax} ${cy - 5.5}L${ax + 5.5} ${cy}L${ax} ${cy + 5.5}L${ax - 5.5} ${cy}Z`} />
            <text className="rp-sub" stroke="none" x={label.x} y={ly} textAnchor={label.anchor}>{text}</text>
          </g>
        );
      })}
      {empty && <text className="rp-sub" stroke="none" x={empty.x} y={barY - 8} textAnchor={empty.anchor}>{empty.text}</text>}
    </svg>
  );
}
