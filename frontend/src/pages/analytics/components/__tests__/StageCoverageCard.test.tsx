import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StageCoverageCard from '../StageCoverageCard';
import type { StageCoverageResponse } from '@/services/api/analytics';

const COMMA_NAME = 'Chain D: GPO-Driven, Living-off-the-Land Intrusion';

const data: StageCoverageResponse = {
  chains: 23,
  chainsProtected: 20,
  stagesRan: 97,
  blocked: 28,
  detected: 13,
  through: 56,
  coverage: 42.27,
  singleStage: { count: 6, bundleNames: ['Chain A', COMMA_NAME] },
  depthNotTested: { count: 9, bundleNames: ['Chain B'] },
  layered: { count: 5, bundleNames: ['Chain A'] },
  noneCaught: { count: 3, bundleNames: ['Chain C'] },
};

const empty: StageCoverageResponse = {
  chains: 0,
  chainsProtected: 0,
  stagesRan: 0,
  blocked: 0,
  detected: 0,
  through: 0,
  coverage: null,
  singleStage: { count: 0, bundleNames: [] },
  depthNotTested: { count: 0, bundleNames: [] },
  layered: { count: 0, bundleNames: [] },
  noneCaught: { count: 0, bundleNames: [] },
};

describe('StageCoverageCard', () => {
  it('renders the percentage, the stage counts and the four chain rows', () => {
    render(<StageCoverageCard data={data} />);
    expect(screen.getByText('Stage coverage')).toBeInTheDocument();
    expect(screen.getByText('23 chains')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('41 of 97 stages caught')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '28 stages blocked, 13 detected, 56 got through' })).toBeInTheDocument();

    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => within(r).getAllByText(/./)[0].textContent)).toEqual([
      'Rest on a single stage',
      'Depth not tested',
      'Two or more stages caught',
      'No stage caught',
    ]);
    expect(within(rows[0]).getByText('6 chains')).toBeInTheDocument();
    expect(within(rows[1]).getByText('9 chains')).toBeInTheDocument();
    expect(within(rows[2]).getByText('5 chains')).toBeInTheDocument();
    expect(within(rows[3]).getByText('3 chains')).toBeInTheDocument();
  });

  it('shows the Defense Score of these chains only', () => {
    render(<StageCoverageCard data={data} />);
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText(/20 of 23/)).toBeInTheDocument();
    expect(screen.getByText(/counts a chain as protected once any stage is caught/)).toBeInTheDocument();
  });

  it('calls onRowClick with the bundle names of the row, commas intact', async () => {
    const onRowClick = vi.fn();
    render(<StageCoverageCard data={data} onRowClick={onRowClick} />);
    await userEvent.click(screen.getAllByRole('button')[0]);
    expect(onRowClick).toHaveBeenCalledWith(['Chain A', COMMA_NAME]);
  });

  it('lists the chains of a row and keeps the full list in its title', () => {
    render(<StageCoverageCard data={data} />);
    const row = screen.getAllByRole('button')[0];
    expect(row).toHaveAttribute('title', `Chain A, ${COMMA_NAME}`);
    expect(within(row).getByText(`Chain A, ${COMMA_NAME}`)).toBeInTheDocument();
  });

  it('disables a row with no chains', async () => {
    const onRowClick = vi.fn();
    render(<StageCoverageCard data={{ ...data, layered: { count: 0, bundleNames: [] } }} onRowClick={onRowClick} />);
    const row = screen.getAllByRole('button')[2];
    expect(row).toBeDisabled();
    await userEvent.click(row);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('says "1 chain" for a single chain', () => {
    render(<StageCoverageCard data={{ ...data, noneCaught: { count: 1, bundleNames: ['Chain C'] } }} />);
    expect(within(screen.getAllByRole('button')[3]).getByText('1 chain')).toBeInTheDocument();
  });

  it('shows the empty state when there are no chains', () => {
    render(<StageCoverageCard data={empty} />);
    expect(screen.getByText('No multi-stage chains in this window')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an error state for null data (failed fetch, or a backend without the endpoint)', () => {
    render(<StageCoverageCard data={null} />);
    expect(screen.getByText("Couldn't load stage coverage")).toBeInTheDocument();
  });

  it('shows a dash, never NaN, when no stage ran', () => {
    render(<StageCoverageCard data={{ ...empty, chains: 2, chainsProtected: 0, noneCaught: { count: 2, bundleNames: ['Chain C'] } }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders a skeleton while loading', () => {
    const { container } = render(<StageCoverageCard data={null} loading />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Stage coverage')).not.toBeInTheDocument();
  });
});
