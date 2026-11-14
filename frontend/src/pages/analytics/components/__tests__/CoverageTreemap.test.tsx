import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

import CoverageTreemap, { BreadthTooltip } from '../CoverageTreemap';
import { buildBreadthModel } from '../testBreadth';
import type { HostTestMatrixCell } from '@/services/api/analytics';

const cell = (hostname: string, testName: string, count = 1): HostTestMatrixCell => ({ hostname, testName, count });
const SIX = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const tiles = () => screen.getAllByTestId('tile');
const tile = (name: string) => {
  const t = tiles().find((el) => el.getAttribute('data-name') === name);
  if (!t) throw new Error(`no tile ${name}`);
  return t;
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

  it('a host with no result has a hollow tile labelled not tested', () => {
    render(<CoverageTreemap {...base} />);
    const t = tile('h-none');
    expect(within(t).getByText('not tested')).toBeInTheDocument();
    expect(t.getAttribute('data-step')).toBe('0');
    expect(t.className).toContain('border-dashed');
    expect(t.style.backgroundColor).toBe('');
  });

  it('with filters on, a hollow tile reads no matching result', () => {
    render(<CoverageTreemap {...base} filtered />);
    expect(within(tile('h-none')).getByText('no matching result')).toBeInTheDocument();
  });

  it('a tested host shows its share and count, shaded by step', () => {
    render(<CoverageTreemap {...base} />);
    expect(within(tile('h-one')).getByText('17% · 1 of 6')).toBeInTheDocument();
    expect(tile('h-one').getAttribute('data-step')).toBe('1');
    expect(within(tile('h-four')).getByText('67% · 4 of 6')).toBeInTheDocument();
    expect(tile('h-four').getAttribute('data-step')).toBe('3');
  });

  it('orders tiles worst first', () => {
    render(<CoverageTreemap {...base} />);
    expect(tiles().map((t) => t.getAttribute('data-name'))).toEqual(['h-none', 'h-one', 'h-four']);
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

    fireEvent.click(screen.getByTitle('Back to overview'));
    expect(tiles()).toHaveLength(3);
  });

  it('an untested host drills down to every test as not run', () => {
    render(<CoverageTreemap {...base} />);
    fireEvent.click(tile('h-none'));
    expect(screen.getByText('h-none · 0 of 6 tests')).toBeInTheDocument();
    expect(screen.getAllByText('not run')).toHaveLength(6);
  });

  it('shows enrolled hosts when there are no results at all', () => {
    render(<CoverageTreemap data={[]} baselineTests90d={SIX} enrolledHostnames={['h-none']} />);
    expect(within(tile('h-none')).getByText('not tested')).toBeInTheDocument();
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

  it('the Others fold says how many of its hosts are tested', () => {
    const { container } = render(<BreadthTooltip tile={{ name: 'Others (3 hosts)', foldTested: 2, foldUntested: 1 }} setSize={6} />);
    expect(container).toHaveTextContent('2 tested, 1 not tested');
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
