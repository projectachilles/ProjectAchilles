import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StageCoverageBlock } from '../StageCoverageBlock';
import { ExecutiveSummary } from '../ExecutiveSummary';
import { makeReport } from '../../__tests__/fixtures';
import type { StageCoverageResponse } from '@/services/api/analytics';

const HEADING = 'Attack chains: how many stages caught them';
const LONG_NAME = 'Chain D: GPO-Driven, Living-off-the-Land Intrusion';

const coverage: StageCoverageResponse = {
  chains: 23,
  chainsProtected: 20,
  stagesRan: 97,
  blocked: 28,
  detected: 13,
  through: 56,
  coverage: 42.27,
  singleStage: { count: 6, bundleNames: ['Chain A', LONG_NAME] },
  depthNotTested: { count: 9, bundleNames: ['Chain B'] },
  layered: { count: 5, bundleNames: ['Chain A'] },
  noneCaught: { count: 3, bundleNames: ['Chain C'] },
};

const withCoverage = (over: Partial<StageCoverageResponse> = {}) => makeReport({ stageCoverage: { ...coverage, ...over } });

describe('StageCoverageBlock', () => {
  it('prints the two figures, the stage bar and the basis', () => {
    render(<StageCoverageBlock report={withCoverage()} />);
    expect(screen.getByRole('heading', { name: new RegExp(HEADING) })).toBeInTheDocument();
    expect(screen.getByText(/23 chains · latest run of each multi-stage test per endpoint in this period/)).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('of stages caught (41 of 97)')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText(/of these chains protected \(20 of 23\)/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Blocked 28, Detected 13, Got through 56' })).toBeInTheDocument();
  });

  it('lists the four groups in order, with chain counts and test names', () => {
    render(<StageCoverageBlock report={withCoverage()} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].firstElementChild?.textContent)).toEqual([
      'Rest on a single stage',
      'Depth not tested',
      'Two or more stages caught',
      'No stage caught',
    ]);
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['6', '9', '5', '3']);
    expect(within(rows[0]).getAllByRole('cell')[2].textContent).toBe(`Chain A; ${LONG_NAME}`);
  });

  it('prints at most six test names in a row, then how many more', () => {
    const names = Array.from({ length: 8 }, (_, i) => `Chain ${i + 1}`);
    render(<StageCoverageBlock report={withCoverage({ singleStage: { count: 12, bundleNames: names } })} />);
    const cell = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[2];
    expect(cell.textContent).toBe('Chain 1; Chain 2; Chain 3; Chain 4; Chain 5; Chain 6; and 2 more');
  });

  it('prints a dash for a group with no chains', () => {
    render(<StageCoverageBlock report={withCoverage({ layered: { count: 0, bundleNames: [] } })} />);
    const cells = within(screen.getAllByRole('row')[3]).getAllByRole('cell');
    expect(cells[1].textContent).toBe('0');
    expect(cells[2].textContent).toBe('—');
  });

  it('prints a dash, never NaN, when no stage ran', () => {
    render(<StageCoverageBlock report={withCoverage({ stagesRan: 0, blocked: 0, detected: 0, through: 0, coverage: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders nothing without the field (older backend), for null, or with no chains', () => {
    for (const report of [makeReport(), makeReport({ stageCoverage: null }), withCoverage({ chains: 0 })]) {
      const { container, unmount } = render(<StageCoverageBlock report={report} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('says so when the lookup failed', () => {
    const report = makeReport({ stageCoverage: null });
    report.meta.unavailable = ['stageCoverage'];
    render(<StageCoverageBlock report={report} />);
    expect(screen.getByRole('heading', { name: new RegExp(HEADING) })).toBeInTheDocument();
    expect(screen.getByText('Stage coverage unavailable — see the notice above.')).toBeInTheDocument();
  });

  it('sits in the executive summary after the outcome bar', () => {
    render(<ExecutiveSummary report={withCoverage()} head={{ left: 'h', right: 'r' }} />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
    const bar = headings.findIndex((h) => h.startsWith('Outcome of every stage'));
    expect(headings[bar + 1]).toMatch(new RegExp(`^${HEADING}`));
  });
});
