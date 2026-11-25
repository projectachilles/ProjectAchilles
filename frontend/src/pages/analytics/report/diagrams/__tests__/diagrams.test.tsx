import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReportAlert, ReportRun, ReportRunStage } from '@/services/api/reports';
import { KillChainFlow } from '../KillChainFlow';
import { LatencyDotPlot, firstAlertMinutes, median } from '../LatencyDotPlot';
import { RunStrip, stageLabelFor } from '../RunStrip';
import { makeRun, makeTest } from '../../__tests__/fixtures';

/** Mirrors the run strip's plot area: X0 = 6, X1 = 680 - 40. */
const STRIP_X0 = 6;
const STRIP_X1 = 640;

const COMPLETED = Date.parse('2026-10-12T12:47:49.000Z');
const minutesFromCompletion = (m: number) => new Date(COMPLETED + m * 60_000).toISOString();

const alertAt = (m: number, over: Partial<ReportAlert> = {}): ReportAlert => ({
  vendor: 'defender', title: 'Alert', severity: 'high', status: 'new', createdAt: minutesFromCompletion(m),
  stageControlId: null, stageControlIds: [], preventionAction: null, portalUrl: null, autoResolvedAt: null, ...over,
});

const stage = (order: number, outcome: ReportRunStage['outcome']): ReportRunStage => ({
  controlId: `T${1000 + order}`, name: `Stage ${order}`, order, outcome, exitCode: null, techniques: [], tactics: [], highImpact: false,
});

const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
const labels = (container: HTMLElement) => Array.from(container.querySelectorAll('text.rp-sub'));
const firstNumber = (path: Element) => Number(/^M(-?[\d.]+)/.exec(path.getAttribute('d') ?? '')?.[1]);

describe('KillChainFlow', () => {
  it('draws one chevron per stage with its band and stage name', () => {
    const { container } = render(<KillChainFlow test={makeTest()} />);
    expect(container.querySelectorAll('polygon.rp-kc')).toHaveLength(5);
    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.getByText('Pre-encryption exfiltration')).toBeInTheDocument();
    expect(screen.getAllByText('Gap').length).toBeGreaterThan(0);
  });

  it('wraps chains longer than six stages onto a second row', () => {
    const test = makeTest();
    const eight = makeTest({ stages: [...test.stages, ...test.stages.slice(0, 3)].map((s, i) => ({ ...s, order: i + 1 })) });
    const { container } = render(<KillChainFlow test={eight} />);
    expect(container.querySelectorAll('svg.rp-svg')).toHaveLength(2);
  });

  it('keeps every chevron the same width when the last row is short', () => {
    const base = makeTest().stages;
    const seven = makeTest({ stages: [...base, ...base.slice(0, 2)].map((s, i) => ({ ...s, order: i + 1 })) });
    const { container } = render(<KillChainFlow test={seven} />);
    const [row1, row2] = Array.from(container.querySelectorAll('svg.rp-svg'));
    const rightEdge = (p: Element) => Math.max(...(p.getAttribute('points') ?? '').split(' ').map((pt) => Number(pt.split(',')[0])));
    // Row 2 holds the lone 7th stage in the first column, not one chevron stretched across the page.
    expect(row2.querySelectorAll('polygon.rp-kc')).toHaveLength(1);
    expect(rightEdge(row1.querySelector('polygon.rp-kc')!)).toBeCloseTo(680 / 6);
    expect(rightEdge(row2.querySelector('polygon.rp-kc')!)).toBeCloseTo(680 / 6);
  });

  it('prints its heading inside the first row, and still prints it when there are no stages', () => {
    const { container } = render(<KillChainFlow test={makeTest()} heading={<h3>Kill chain</h3>} />);
    const firstRow = container.querySelector('.rp-avoid') as HTMLElement;
    expect(firstRow.firstElementChild).toHaveTextContent('Kill chain');
    expect(firstRow.querySelector('svg')).not.toBeNull();
    const empty = render(<KillChainFlow test={makeTest({ stages: [] })} heading={<h3>Empty chain</h3>} />).container;
    expect(empty).toHaveTextContent('Empty chain');
  });

  it('lists the alert counts for every configured EDR vendor by default', () => {
    const { container } = render(<KillChainFlow test={makeTest()} />);
    expect(container.textContent).toContain('Alerts: Defender 1 · Falcon 1');
  });

  it('shows no alert line at all when no EDR vendor is configured', () => {
    const { container } = render(<KillChainFlow test={makeTest()} edrVendors={[]} />);
    expect(container.textContent).not.toContain('Alerts:');
    expect(container.textContent).not.toContain('Defender');
    expect(container.textContent).not.toContain('Falcon');
    // The rest of the stage column is unchanged.
    expect(container.textContent).toContain('Execution · 2 of 2 defended');
  });

  it('lists only the configured vendors', () => {
    const { container } = render(<KillChainFlow test={makeTest()} edrVendors={['crowdstrike']} />);
    expect(container.textContent).toContain('Alerts: Falcon 1');
    expect(container.textContent).not.toContain('Defender');
    const only = render(<KillChainFlow test={makeTest()} edrVendors={['defender']} />).container;
    expect(only.textContent).toContain('Alerts: Defender 1');
    expect(only.textContent).not.toContain('Falcon');
  });

  it('does not print zero alerts as "none" while alert correlation is incomplete', () => {
    const { container } = render(<KillChainFlow test={makeTest()} alertsIncomplete />);
    const lines = Array.from(container.querySelectorAll('.rp-kc-sub')).map((el) => el.textContent ?? '');
    // Stage 1 had 1 + 1 alerts, stage 3 none found.
    expect(lines[0]).toContain('Alerts: Defender ≥1 · Falcon ≥1');
    expect(lines[2]).toContain('Alerts: Defender — · Falcon —');
    expect(container.textContent).not.toMatch(/Defender 0|Falcon 0/);
  });

  it('keeps stroke="none" on every SVG text', () => {
    const { container } = render(<KillChainFlow test={makeTest()} />);
    const texts = Array.from(container.querySelectorAll('svg text'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toHaveAttribute('stroke', 'none');
  });
});

describe('LatencyDotPlot', () => {
  it('measures first alerts from run completion, per vendor and overall', () => {
    const runs = [makeRun()];
    expect(firstAlertMinutes(runs, 'defender')[0]).toBeCloseTo(-3.3, 1);
    expect(firstAlertMinutes(runs, 'crowdstrike')[0]).toBeCloseTo(1.03, 1);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it('only counts runs that raised an alert', () => {
    expect(firstAlertMinutes([makeRun({ alerts: [] })])).toEqual([]);
    expect(firstAlertMinutes([makeRun(), makeRun({ alerts: [] })])).toHaveLength(1);
  });

  it('plots one dot per run and labels the median', () => {
    const { container } = render(<LatencyDotPlot runs={[makeRun(), makeRun({ alerts: [] })]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    // The Defender row and the "any EDR" row share the run's first alert.
    expect(screen.getAllByText('1 run · median −3m 18s')).toHaveLength(2);
    expect(screen.getByText('1 run · median +1m 02s')).toBeInTheDocument();
  });

  it('skips alerts whose time does not parse', () => {
    const undated = alertAt(0, { createdAt: '' });
    expect(firstAlertMinutes([makeRun({ alerts: [undated] })])).toEqual([]);
    expect(firstAlertMinutes([makeRun({ alerts: [undated, alertAt(2)] })])).toEqual([2]);
  });

  it('renders nothing when no run raised an alert', () => {
    const { container } = render(<LatencyDotPlot runs={[makeRun({ alerts: [] })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps stroke="none" on every SVG text', () => {
    const { container } = render(<LatencyDotPlot runs={[makeRun()]} />);
    const texts = Array.from(container.querySelectorAll('svg text'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toHaveAttribute('stroke', 'none');
  });
});

describe('RunStrip', () => {
  it('labels alerts during the run and after it, with their stage', () => {
    render(<RunStrip run={makeRun()} />);
    expect(screen.getByText('Defender during run · S2')).toBeInTheDocument();
    expect(screen.getByText('Falcon +1m 02s · S5')).toBeInTheDocument();
  });

  it('draws the run bar with one glyph per stage when the start time is known', () => {
    const { container } = render(<RunStrip run={makeRun()} />);
    expect(screen.getByRole('img', { name: 'Run timeline in minutes from start' })).toBeInTheDocument();
    expect(container.querySelectorAll('.rp-run-bar')).toHaveLength(1);
    expect(container.querySelectorAll('.rp-g')).toHaveLength(5);
    expect(container.querySelector('.rp-marker')).toBeNull();
  });

  it('draws no glyph for a skipped stage: skipped stages are not results', () => {
    const run = makeRun({ stages: [stage(1, 'protected'), stage(2, 'skipped'), stage(3, 'unprotected')] });
    const { container } = render(<RunStrip run={run} />);
    expect(container.querySelectorAll('.rp-g')).toHaveLength(2);
    expect(container.querySelector('.rp-g-skipped')).toBeNull();
  });

  it('draws only a completion marker when the start time is unknown (Review Focus #2)', () => {
    const { container } = render(<RunStrip run={makeRun({ startedAt: null })} />);
    expect(screen.getByRole('img', { name: 'Alerts in minutes from run completion' })).toBeInTheDocument();
    expect(screen.getByText('completed (start time unavailable)')).toBeInTheDocument();

    // No run bar and no stage glyphs: only the completion marker, five minutes into the axis.
    expect(container.querySelector('.rp-run-bar')).toBeNull();
    expect(container.querySelectorAll('.rp-g')).toHaveLength(0);
    const marker = container.querySelector('.rp-marker')!;
    expect(num(marker, 'x1')).toBeCloseTo(STRIP_X0 + (5 / 25) * (STRIP_X1 - STRIP_X0), 5);

    // The axis runs from -5 min (the correlation lead) to +20 min after completion.
    const ticks = Array.from(container.querySelectorAll('text.rp-tick')).map((t) => t.textContent);
    expect(ticks).toEqual(['−5', '0', '+5', '+10', '+15', '+20 min']);
  });

  it('says so when no EDR alerted', () => {
    render(<RunStrip run={makeRun({ alerts: [] })} />);
    expect(screen.getByText('no EDR alert within 30 min')).toBeInTheDocument();
  });

  it('says "alerts not checked", not "none", when the correlation search did not complete', () => {
    render(<RunStrip run={makeRun({ alerts: [], alertsChecked: false })} />);
    expect(screen.getByText('alerts not checked')).toBeInTheDocument();
    expect(screen.queryByText('no EDR alert within 30 min')).toBeNull();
  });

  it('still draws the alerts that were found when the run is not fully checked', () => {
    render(<RunStrip run={makeRun({ alertsChecked: false })} />);
    expect(screen.getByText('Falcon +1m 02s · S5')).toBeInTheDocument();
    expect(screen.queryByText('alerts not checked')).toBeNull();
    expect(screen.queryByText('no EDR alert within 30 min')).toBeNull();
  });

  it('keeps an alert that precedes a short run inside the axis', () => {
    // A 2-minute run, alert raised 4 minutes before it completed (2 minutes before it started).
    const run = makeRun({
      startedAt: minutesFromCompletion(-2),
      alerts: [alertAt(-4, { stageControlId: null })],
    });
    const { container } = render(<RunStrip run={run} />);
    const diamond = container.querySelector('.rp-al-defender')!;
    expect(firstNumber(diamond)).toBeGreaterThanOrEqual(STRIP_X0);
    const ticks = Array.from(container.querySelectorAll('text.rp-tick')).map((t) => t.textContent);
    expect(ticks[0]).toBe('−5');
    expect(ticks).toContain('0');
  });

  it('stacks alert labels that would overlap onto separate rows', () => {
    const run = makeRun({ alerts: [alertAt(1), alertAt(1.1), alertAt(1.2)] });
    const { container } = render(<RunStrip run={run} />);
    const ys = labels(container).filter((t) => t.textContent?.startsWith('Defender')).map((t) => num(t, 'y'));
    expect(new Set(ys).size).toBe(3);
  });

  it('grows the strip instead of drawing labels above it when many alerts stack', () => {
    const run = makeRun({ alerts: Array.from({ length: 6 }, (_, i) => alertAt(1 + i * 0.05)) });
    const { container } = render(<RunStrip run={run} />);
    const ys = labels(container).filter((t) => t.textContent?.startsWith('Defender')).map((t) => num(t, 'y'));
    expect(new Set(ys).size).toBe(6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(8);
    const base = render(<RunStrip run={makeRun()} />).container.querySelector('svg')!;
    const grown = container.querySelector('svg')!;
    expect(Number(grown.getAttribute('viewBox')!.split(' ')[3])).toBeGreaterThan(Number(base.getAttribute('viewBox')!.split(' ')[3]));
  });

  it('flips a label that would run off the right edge to end at its marker', () => {
    const run = makeRun({ alerts: [alertAt(28, { stageControlId: 't1486' })] });
    const { container } = render(<RunStrip run={run} />);
    const label = labels(container).find((t) => t.textContent?.startsWith('Defender'))!;
    expect(label).toHaveAttribute('text-anchor', 'end');
    expect(num(label, 'x')).toBeLessThanOrEqual(STRIP_X1);
  });

  it('draws no alert markers, labels or "not checked" text when no EDR vendor is configured', () => {
    // With no vendor configured the backend marks every run alertsChecked: false.
    const none = render(<RunStrip run={makeRun({ alerts: [], alertsChecked: false })} edrVendors={[]} />).container;
    expect(none.textContent).not.toContain('not checked');
    expect(none.textContent).not.toContain('no EDR alert');

    const clean = render(<RunStrip run={makeRun({ alerts: [] })} edrVendors={[]} />).container;
    expect(clean.textContent).not.toContain('no EDR alert');

    const withAlerts = render(<RunStrip run={makeRun()} edrVendors={[]} />).container;
    expect(withAlerts.querySelectorAll('.rp-al-defender, .rp-al-crowdstrike')).toHaveLength(0);
    expect(withAlerts.textContent).not.toContain('Defender');
    expect(withAlerts.textContent).not.toContain('Falcon');
    // The run bar and axis are still drawn.
    expect(withAlerts.querySelectorAll('.rp-run-bar')).toHaveLength(1);
    expect(withAlerts.querySelectorAll('.rp-g')).toHaveLength(5);
  });

  it('still says "alerts not checked" when a vendor is configured', () => {
    render(<RunStrip run={makeRun({ alerts: [], alertsChecked: false })} edrVendors={['crowdstrike']} />);
    expect(screen.getByText('alerts not checked')).toBeInTheDocument();
  });

  it('leaves an undated alert off the axis but does not call the run silent', () => {
    const run = makeRun({ alerts: [alertAt(0, { createdAt: '' })] });
    const { container } = render(<RunStrip run={run} />);
    expect(container.querySelectorAll('.rp-al-defender')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.textContent).not.toContain('no EDR alert');
    expect(screen.getAllByText(/^[−+]?\d+( min)?$/).length).toBeGreaterThan(0);
  });

  it('keeps stroke="none" on every SVG text', () => {
    const { container } = render(<RunStrip run={makeRun()} />);
    const texts = Array.from(container.querySelectorAll('svg text'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toHaveAttribute('stroke', 'none');
  });
});

describe('RunStrip on a run with many stages', () => {
  const thirty = (over: Partial<ReportRun> = {}) => makeRun({
    stages: Array.from({ length: 30 }, (_, i) => stage(i + 1, i < 20 ? 'protected' : 'unprotected')),
    ...over,
  });

  it('draws proportional outcome segments instead of a glyph per stage', () => {
    const { container } = render(<RunStrip run={thirty()} />);
    const segments = Array.from(container.querySelectorAll('.rp-g'));
    // 20 protected + 10 unprotected: two segments, 2:1, filling the run bar.
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveClass('rp-g-protected');
    expect(segments[1]).toHaveClass('rp-g-unprotected');
    expect(num(segments[0], 'width') / num(segments[1], 'width')).toBeCloseTo(2);
    const bar = container.querySelector('.rp-run-bar')!;
    expect(num(segments[0], 'width') + num(segments[1], 'width')).toBeCloseTo(num(bar, 'width'));
    expect(num(segments[0], 'x')).toBeCloseTo(num(bar, 'x'));
    expect(screen.getByText('30 stages')).toBeInTheDocument();
  });

  it('keeps the dark-red mark on high-impact unprotected stages', () => {
    const stages = Array.from({ length: 30 }, (_, i) => stage(i + 1, i < 20 ? 'protected' : 'unprotected'));
    stages[29] = { ...stages[29], highImpact: true };
    const { container } = render(<RunStrip run={thirty({ stages })} />);
    const hi = container.querySelectorAll('.rp-g-hi');
    expect(hi).toHaveLength(1);
    expect(hi[0]).toHaveClass('rp-g-unprotected');
    // 9 plain + 1 high-impact unprotected out of 30 stages.
    const plain = container.querySelector('.rp-g-unprotected:not(.rp-g-hi)')!;
    expect(num(plain, 'width') / num(hi[0], 'width')).toBeCloseTo(9);
  });

  it('says how many stages were not fetched, and still summarises a short list', () => {
    render(<RunStrip run={thirty({ moreStages: 5 })} />);
    expect(screen.getByText('30 stages (+5 not fetched)')).toBeInTheDocument();
    const { container } = render(<RunStrip run={makeRun({ moreStages: 5 })} />);
    expect(container.querySelectorAll('.rp-g')).toHaveLength(4);
    expect(screen.getByText('5 stages (+5 not fetched)')).toBeInTheDocument();
  });

  it('switches from glyphs to segments just above 16 drawn stages, not counting skipped ones', () => {
    const run = (n: number, skipped = 0) => makeRun({
      stages: Array.from({ length: n }, (_, i) => stage(i + 1, i < skipped ? 'skipped' : i % 2 ? 'protected' : 'unprotected')),
    });
    const sixteen = render(<RunStrip run={run(16)} />).container;
    expect(sixteen.querySelectorAll('.rp-g')).toHaveLength(16);
    expect(sixteen.textContent).not.toContain('16 stages');

    const seventeen = render(<RunStrip run={run(17)} />).container;
    expect(seventeen.querySelectorAll('.rp-g')).toHaveLength(2);
    expect(seventeen.textContent).toContain('17 stages');

    // 20 stages of which 6 were skipped leave 14 results: still glyphs.
    const skippedMost = render(<RunStrip run={run(20, 6)} />).container;
    expect(skippedMost.querySelectorAll('.rp-g')).toHaveLength(14);
  });

  it('draws no stage summary when the start time is unknown', () => {
    const { container } = render(<RunStrip run={thirty({ startedAt: null })} />);
    expect(container.querySelectorAll('.rp-g')).toHaveLength(0);
    expect(container.textContent).not.toContain('30 stages');
  });
});

/** A 70-control bundle whose run carries only its first 60 stages, with an alert on control 69. */
function seventyControlRun() {
  const stages = Array.from({ length: 70 }, (_, i) => ({
    ...makeTest().stages[0], controlId: `CH-DEF-${String(i + 1).padStart(3, '0')}`, name: `Control ${i + 1}`, order: i + 1,
  }));
  const test = makeTest({ category: 'cyber-hygiene', stages });
  const run = makeRun({
    stages: stages.slice(0, 60).map((s) => ({ ...stage(s.order, 'protected'), controlId: s.controlId })),
    moreStages: 10,
    alerts: [alertAt(2, { stageControlId: 'ch-def-069' })],
  });
  return { test, run };
}

const standaloneCase = () => ({
  test: makeTest({ isBundle: false, category: 'host-hardening', stages: [{ ...makeTest().stages[0], controlId: null }] }),
  run: makeRun({ stages: [{ ...stage(1, 'unprotected'), controlId: null }], alerts: [alertAt(2, { stageControlId: 't1059.001' })] }),
});

describe('stageLabelFor', () => {
  it('labels a stage the run did not fetch from the test\'s stages', () => {
    const { test, run } = seventyControlRun();
    expect(stageLabelFor(run, 'ch-def-069')).toBe('bundle');
    expect(stageLabelFor(run, 'ch-def-069', test)).toBe('S69');
  });

  it('gives a standalone test\'s alert no stage label', () => {
    const { test, run } = standaloneCase();
    expect(stageLabelFor(run, 't1059.001', test)).toBe('');
    expect(stageLabelFor(run, null, test)).toBe('');
  });

  it('draws the resolved label on the strip, and no "bundle" for a standalone test', () => {
    const { test, run } = seventyControlRun();
    const strip = render(<RunStrip run={run} test={test} />).container;
    expect(strip.textContent).toContain('Defender +2m 00s · S69');
    expect(strip.textContent).not.toContain('bundle');

    const single = standaloneCase();
    const plain = render(<RunStrip run={single.run} test={single.test} />).container;
    expect(plain.textContent).toContain('Defender +2m 00s');
    expect(plain.textContent).not.toMatch(/bundle|·\s*$/);
  });

  it('resolves stage tokens to the stage order, including variant suffixes', () => {
    const run = makeRun();
    expect(stageLabelFor(run, 't1486')).toBe('S5');
    expect(stageLabelFor(run, 't1486-variant')).toBe('S5');
    expect(stageLabelFor(run, null)).toBe('bundle');
  });

  it('matches a lowercased backend token against an uppercase controlId', () => {
    const run = makeRun();
    // The backend lowercases ReportAlert.stageControlId; ReportRunStage.controlId keeps its case.
    expect(run.stages[1].controlId).toBe('T1003.001');
    expect(stageLabelFor(run, 't1003.001')).toBe('S2');
    expect(stageLabelFor(run, 'T1003.001')).toBe('S2');
    expect(stageLabelFor(run, 't1003.001-variant')).toBe('S2');
  });

  it('does not need stage names (big-scope reports omit them)', () => {
    const run = makeRun({ stages: makeRun().stages.map(({ name: _name, ...s }) => s) });
    expect(stageLabelFor(run, 't1003.001')).toBe('S2');
  });

  it('says "bundle" when the token names no stage of the run', () => {
    expect(stageLabelFor(makeRun(), 't9999')).toBe('bundle');
    // A prefix is not a match unless it ends at a hyphen.
    expect(stageLabelFor(makeRun(), 't14860')).toBe('bundle');
  });

  it('never matches a stage without a controlId', () => {
    const run: ReportRun = makeRun({ stages: [{ ...stage(1, 'protected'), controlId: null }] });
    expect(stageLabelFor(run, 't1001')).toBe('bundle');
  });
});
