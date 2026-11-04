import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OutcomeBreakdownCard from '../OutcomeBreakdownCard';
import type { OutcomeBreakdown } from '@/services/api/analytics';

const data: OutcomeBreakdown = {
  pairCount: 685,
  protected: 412,
  prevented: 120,
  detected: 90,
  silent: 63,
  noConclusive: 0,
  riskAccepted: 0,
  windowLabel: '30d',
};

describe('OutcomeBreakdownCard', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  it('renders title, subtitle, four rows with counts and rounded percents', () => {
    render(<OutcomeBreakdownCard data={data} />);
    expect(screen.getByText('Outcome breakdown')).toBeInTheDocument();
    expect(screen.getByText('Latest result per test × host · attack tests · 30d')).toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.getByText('Prevented')).toBeInTheDocument();
    expect(screen.getByText('Detected only')).toBeInTheDocument();
    expect(screen.getByText('Silent')).toBeInTheDocument();
    expect(screen.getByText('412 · 60%')).toBeInTheDocument();
    expect(screen.getByText('685')).toBeInTheDocument();
    expect(screen.getByText('pairs')).toBeInTheDocument();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('calls onSelect with the verdict of the clicked row', async () => {
    const onSelect = vi.fn();
    render(<OutcomeBreakdownCard data={data} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Silent/ }));
    expect(onSelect).toHaveBeenCalledWith('silent');
  });

  it('hides the no-conclusive line and footnote when zero', () => {
    render(<OutcomeBreakdownCard data={data} />);
    expect(screen.queryByText(/No conclusive/)).not.toBeInTheDocument();
    expect(screen.queryByText(/risk-accepted/)).not.toBeInTheDocument();
  });

  it('shows no-conclusive line and risk-accepted footnote when present', () => {
    render(<OutcomeBreakdownCard data={{ ...data, noConclusive: 5, riskAccepted: 12 }} />);
    expect(screen.getByText('No conclusive result yet · 5 pairs')).toBeInTheDocument();
    expect(screen.getByText('12 risk-accepted pairs not counted')).toBeInTheDocument();
  });

  it('shows the empty state at zero pairs', () => {
    render(<OutcomeBreakdownCard data={{ ...data, pairCount: 0, protected: 0, prevented: 0, detected: 0, silent: 0 }} />);
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
  });

  it('shows a load error, not a skeleton, when data is null and not loading', () => {
    const { container } = render(<OutcomeBreakdownCard data={null} />);
    expect(screen.getByText('Outcome breakdown')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load outcome breakdown.")).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('shows a skeleton while loading', () => {
    const { container } = render(<OutcomeBreakdownCard data={null} loading />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Outcome breakdown')).not.toBeInTheDocument();
  });
});
