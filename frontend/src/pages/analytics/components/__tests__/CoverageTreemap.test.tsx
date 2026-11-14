import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within, fireEvent } from '@testing-library/react';

import CoverageTreemap, { BreadthTooltip } from '../CoverageTreemap';
import { buildBreadthModel } from '../testBreadth';
import type { HostTestMatrixCell } from '@/services/api/analytics';

// The open tooltip measures itself; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const cell = (hostname: string, testName: string, count = 1): HostTestMatrixCell => ({ hostname, testName, count });
const SIX = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const tiles = () => screen.getAllByTestId('tile');
const tile = (name: string) => {
  const t = tiles().find((el) => el.getAttribute('data-name') === name);
  if (!t) throw new Error(`no tile ${name}`);
  return t;
};

const chips = () => screen.queryAllByTestId('untested-host');
const chip = (name: string) => {
  const c = chips().find((el) => el.getAttribute('data-name') === name);
  if (!c) throw new Error(`no chip ${name}`);
  return c;
};

const base = {
  data: [cell('h-one', 'T1', 2), cell('h-four', 'T1'), cell('h-four', 'T2'), cell('h-four', 'T3'), cell('h-four', 'T4')],
  baselineTests90d: SIX,
  baselineTests30d: ['T1', 'T2'],
  enrolledHostnames: ['h-one', 'h-four', 'h-none'],
};

describe('CoverageTreemap (Test Breadth by Host)', () => {
  it('header counts hosts, tested, not tested and the test set', () => {
    render(<CoverageTreemap {...base} />);
    expect(screen.getByText(/3 hosts · 2 tested · 1 not tested · 6 tests \(90d baseline\)/)).toBeInTheDocument();
  });

  it('says so when the enrolled hosts could not be read, and counts only tested hosts', () => {
    render(<CoverageTreemap {...base} enrolledHostnames={null} />);
    expect(screen.getByText(/2 hosts tested · enrolled hosts unavailable · 6 tests/)).toBeInTheDocument();
    expect(tiles()).toHaveLength(2);
  });

  it('a host with no result is a chip in the Not tested group, not a tile', () => {
    render(<CoverageTreemap {...base} />);
    expect(screen.getByText('Not tested (1)')).toBeInTheDocument();
    expect(chip('h-none').className).toContain('border-dashed');
    expect(tiles().map((t) => t.getAttribute('data-name'))).toEqual(['h-one', 'h-four']);
  });

  it('with filters on, the group reads No matching result', () => {
    render(<CoverageTreemap {...base} filtered />);
    expect(screen.getByText('No matching result (1)')).toBeInTheDocument();
  });

  it('has no Not tested group when every host is tested or the fleet is unreadable', () => {
    render(<CoverageTreemap {...base} enrolledHostnames={null} />);
    expect(screen.queryByText(/^Not tested \(/)).toBeNull();
    expect(chips()).toHaveLength(0);
  });

  it('untested hosts never push tested hosts out of view', () => {
    const none = Array.from({ length: 30 }, (_, i) => `none-${String(i).padStart(2, '0')}`);
    render(<CoverageTreemap {...base} enrolledHostnames={[...none, 'h-one', 'h-four']} />);
    expect(tiles().map((t) => t.getAttribute('data-name'))).toEqual(['h-one', 'h-four']);
    expect(screen.getByText('Not tested (30)')).toBeInTheDocument();
  });

  it('shows the first 40 untested hosts, and the rest on request', () => {
    const none = Array.from({ length: 45 }, (_, i) => `none-${String(i).padStart(2, '0')}`);
    render(<CoverageTreemap {...base} enrolledHostnames={none} />);
    expect(chips()).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 45' }));
    expect(chips()).toHaveLength(45);
    expect(screen.queryByRole('button', { name: 'Show all 45' })).toBeNull();
  });

  it('matches host scores to tiles ignoring hostname case', async () => {
    render(
      <CoverageTreemap {...base} hostScores={[{ hostname: 'H-ONE', score: 50, protected: 1, unprotected: 1, total: 2 }]} />,
    );
    act(() => tile('h-one').focus());
    expect((await screen.findByRole('tooltip')).textContent).toContain('Defense Score: 50% · 1 of 2 protected');
  });

  it('says the order of the tiles', () => {
    render(<CoverageTreemap {...base} />);
    expect(screen.getByText(/lowest breadth first/)).toBeInTheDocument();
  });

  it('a tested host shows its share and count, shaded by step', () => {
    render(<CoverageTreemap {...base} />);
    expect(within(tile('h-one')).getByText('17% · 1 of 6')).toBeInTheDocument();
    expect(tile('h-one').getAttribute('data-step')).toBe('1');
    expect(within(tile('h-four')).getByText('67% · 4 of 6')).toBeInTheDocument();
    expect(tile('h-four').getAttribute('data-step')).toBe('3');
  });

  it('orders tested tiles lowest breadth first', () => {
    render(<CoverageTreemap {...base} />);
    expect(tiles().map((t) => t.getAttribute('data-name'))).toEqual(['h-one', 'h-four']);
  });

  it('uses no outcome colour anywhere', () => {
    const { container } = render(<CoverageTreemap {...base} />);
    expect(container.innerHTML).not.toMatch(/chart-heat|chart-protected|chart-bypassed|chart-warn|text-red/);
  });

  it('the baseline toggle changes the test set', () => {
    render(<CoverageTreemap {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Window' }));
    expect(screen.getByText(/4 tests \(current window\)/)).toBeInTheDocument();
    expect(within(tile('h-one')).getByText('25% · 1 of 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    // 30d baseline T1,T2 plus the window's T3,T4
    expect(screen.getByText(/4 tests \(30d baseline\)/)).toBeInTheDocument();
  });

  it('folds hosts past 25 into Others, keeping the least tested visible', () => {
    const data: HostTestMatrixCell[] = [];
    for (let i = 0; i < 26; i++) data.push(cell(`poor-${String(i).padStart(2, '0')}`, 'T1'));
    for (const t of SIX) data.push(cell('best', t));
    render(<CoverageTreemap data={data} baselineTests90d={SIX} enrolledHostnames={null} />);
    expect(tiles()).toHaveLength(26);
    expect(within(tile('Others (2 hosts)')).getByText('2 hosts ⋯')).toBeInTheDocument();
    expect(tiles().some((t) => t.getAttribute('data-name') === 'best')).toBe(false);

    fireEvent.click(tile('Others (2 hosts)'));
    expect(tiles().map((t) => t.getAttribute('data-name'))).toEqual(['poor-25', 'best']);
  });

  it('clicking a host shows one tile per test, hollow for tests it did not run', () => {
    render(<CoverageTreemap {...base} />);
    fireEvent.click(tile('h-one'));
    expect(screen.getByText('h-one · 1 of 6 tests')).toBeInTheDocument();
    expect(tiles()).toHaveLength(6);
    expect(within(tile('T1')).getByText('2 runs')).toBeInTheDocument();
    expect(within(tile('T2')).getByText('not run')).toBeInTheDocument();
    expect(tile('T2').className).toContain('border-dashed');
    // gaps first
    expect(tiles()[5].getAttribute('data-name')).toBe('T1');

    fireEvent.click(screen.getByLabelText('Back to overview'));
    expect(tiles()).toHaveLength(2);
    expect(chips()).toHaveLength(1);
  });

  it('an untested host drills down to every test as not run', () => {
    render(<CoverageTreemap {...base} />);
    fireEvent.click(chip('h-none'));
    expect(screen.getByText('h-none · 0 of 6 tests')).toBeInTheDocument();
    expect(screen.getAllByText('not run')).toHaveLength(6);
    expect(chips()).toHaveLength(0);
  });

  it('returns to a working overview when the open host leaves the data', () => {
    const { rerender } = render(<CoverageTreemap {...base} />);
    fireEvent.click(chip('h-none'));
    expect(tiles()).toHaveLength(6);
    // e.g. a hostname filter that excludes it
    rerender(<CoverageTreemap {...base} enrolledHostnames={['h-one', 'h-four']} />);
    expect(tiles().map((t) => t.getAttribute('data-name'))).toEqual(['h-one', 'h-four']);
    expect(screen.queryByLabelText('Back to overview')).toBeNull();
    fireEvent.click(tile('h-one'));
    expect(screen.getByText('h-one · 1 of 6 tests')).toBeInTheDocument();
  });

  it('marks the selected baseline for assistive technology', () => {
    render(<CoverageTreemap {...base} />);
    expect(screen.getByRole('button', { name: '90d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Window' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows enrolled hosts when there are no results at all', () => {
    render(<CoverageTreemap data={[]} baselineTests90d={SIX} enrolledHostnames={['h-none']} />);
    expect(chip('h-none')).toBeInTheDocument();
    expect(screen.queryAllByTestId('tile')).toHaveLength(0);
    expect(screen.getByText('No host has a result in this view')).toBeInTheDocument();
  });

  it('has an empty state when there is nothing to show', () => {
    render(<CoverageTreemap data={[]} baselineTests90d={SIX} enrolledHostnames={[]} />);
    expect(screen.getByText(/No test results or enrolled hosts/)).toBeInTheDocument();
  });
});

describe('BreadthTooltip', () => {
  const model = buildBreadthModel(base.data, SIX, ['h-none']);
  const tileFor = (name: string) => ({ name, host: model.hosts.find((h) => h.hostname === name) });

  it('lists figures that agree: 1 of 6 run, 5 missing', () => {
    const { container } = render(<BreadthTooltip tile={tileFor('h-one')} setSize={6} baselineLabel="90d baseline" />);
    expect(container).toHaveTextContent('1 of 6 tests run');
    expect(container).toHaveTextContent('2 runs in this window');
    expect(container).toHaveTextContent('17% (Poor) — 90d baseline');
    expect(screen.getByText('Missing 5 tests:')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('caps the missing list at five and counts the rest', () => {
    const big = buildBreadthModel([cell('h', 'A')], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], null);
    render(<BreadthTooltip tile={{ name: 'h', host: big.hosts[0] }} setSize={8} />);
    expect(screen.getByText('Missing 7 tests:')).toBeInTheDocument();
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
  });

  it('the Others fold says which hosts it holds', () => {
    const { container } = render(<BreadthTooltip tile={{ name: 'Others (3 hosts)', foldCount: 3 }} setSize={6} />);
    expect(container).toHaveTextContent('The 3 tested hosts with the highest breadth');
  });

  it('shows the host Defense Score with its counts, below breadth', () => {
    const { container } = render(
      <BreadthTooltip
        tile={tileFor('h-one')}
        setSize={6}
        score={{ hostname: 'h-one', score: 74.6, protected: 3, unprotected: 1, total: 4 }}
      />,
    );
    expect(container).toHaveTextContent('Defense Score: 75% · 3 of 4 protected');
    expect(container.textContent!.indexOf('Breadth:')).toBeLessThan(container.textContent!.indexOf('Defense Score:'));
  });

  it('has no Defense Score line without a score, or for an untested host', () => {
    const { container, rerender } = render(<BreadthTooltip tile={tileFor('h-one')} setSize={6} />);
    expect(container).not.toHaveTextContent('Defense Score');
    rerender(
      <BreadthTooltip
        tile={tileFor('h-none')}
        setSize={6}
        score={{ hostname: 'h-none', score: 50, protected: 1, unprotected: 1, total: 2 }}
      />,
    );
    expect(container).not.toHaveTextContent('Defense Score');
  });

  it('uses singular forms', () => {
    const one = buildBreadthModel([cell('h', 'A')], ['A', 'B'], null);
    const { container } = render(<BreadthTooltip tile={{ name: 'h', host: one.hosts[0] }} setSize={2} />);
    expect(container).toHaveTextContent('1 run in this window');
    expect(screen.getByText('Missing 1 test:')).toBeInTheDocument();
  });

  it('an untested host says so, or no matching result under filters', () => {
    const { rerender } = render(<BreadthTooltip tile={tileFor('h-none')} setSize={6} />);
    expect(screen.getByText('Not tested in this window')).toBeInTheDocument();
    rerender(<BreadthTooltip tile={tileFor('h-none')} setSize={6} filtered />);
    expect(screen.getByText('No result matches the current filters')).toBeInTheDocument();
  });
});
