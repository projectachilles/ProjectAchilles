import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TopBypassedTechniques from '../TopBypassedTechniques';
import type { TechniqueDistributionItem } from '@/services/api/analytics';

const items: TechniqueDistributionItem[] = [
  { technique: 'T1059.001', protected: 1, unprotected: 9 }, // 90% bypass — worst
  { technique: 'T1055', protected: 5, unprotected: 5 }, // 50% bypass
  { technique: 'T1027', protected: 8, unprotected: 2 }, // 20% bypass
];

describe('TopBypassedTechniques', () => {
  it('renders title and sub-caption', () => {
    render(<TopBypassedTechniques items={items} />);
    expect(screen.getByText('Top Bypassed Techniques')).toBeInTheDocument();
    expect(screen.getByText('sorted by bypass rate')).toBeInTheDocument();
  });

  it('renders techniques sorted worst-first (DOM order)', () => {
    render(<TopBypassedTechniques items={items} />);
    const ids = screen.getAllByText(/^T\d{4}/).map((el) => el.textContent);
    expect(ids).toEqual(['T1059.001', 'T1055', 'T1027']);
  });

  it('renders bypass percentages', () => {
    render(<TopBypassedTechniques items={items} />);
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('the worst row bar uses full var(--chart-bypassed), a later row uses the dimmed color-mix variant', () => {
    const { container } = render(<TopBypassedTechniques items={items} />);
    const bars = container.querySelectorAll('[data-testid="bypass-bar"]');
    expect(bars.length).toBe(3);
    expect((bars[0] as HTMLElement).style.backgroundColor).toBe('var(--chart-bypassed)');
    expect((bars[1] as HTMLElement).style.backgroundColor).toContain('color-mix');
    expect((bars[1] as HTMLElement).style.backgroundColor).toContain('var(--chart-bypassed)');
    expect((bars[2] as HTMLElement).style.backgroundColor).toContain('color-mix');
  });

  it('bar widths reflect bypass rate', () => {
    const { container } = render(<TopBypassedTechniques items={items} />);
    const bars = container.querySelectorAll('[data-testid="bypass-bar"]');
    expect((bars[0] as HTMLElement).style.width).toBe('90%');
    expect((bars[1] as HTMLElement).style.width).toBe('50%');
    expect((bars[2] as HTMLElement).style.width).toBe('20%');
  });

  it('shows the empty state when there are no items', () => {
    render(<TopBypassedTechniques items={[]} />);
    expect(screen.getByText('No bypassed techniques in range.')).toBeInTheDocument();
  });

  it('shows the empty state when all items have zero total', () => {
    render(
      <TopBypassedTechniques
        items={[{ technique: 'T1000', protected: 0, unprotected: 0 }]}
      />
    );
    expect(screen.getByText('No bypassed techniques in range.')).toBeInTheDocument();
  });

  it('renders skeleton rows and aria-busy when loading, with no spinner', () => {
    const { container } = render(<TopBypassedTechniques items={[]} loading />);
    const skeletons = container.querySelectorAll('[data-testid="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
