import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WeakestHosts from '../WeakestHosts';
import type { DefenseScoreByHostItem } from '@/services/api/analytics';

// Deliberately shuffled (not pre-sorted) so the test actually proves the
// component sorts ascending by score rather than merely passing through input order.
const items: DefenseScoreByHostItem[] = [
  { hostname: 'host-70', score: 70, protected: 7, unprotected: 3, total: 10 },
  { hostname: 'host-16', score: 16, protected: 1, unprotected: 5, total: 6 },
  { hostname: 'host-55', score: 55, protected: 5, unprotected: 4, total: 9 },
];

describe('WeakestHosts', () => {
  it('renders title and sub-caption', () => {
    render(<WeakestHosts items={items} />);
    expect(screen.getByText('Weakest Hosts')).toBeInTheDocument();
    expect(screen.getByText('score vs 80% target')).toBeInTheDocument();
  });

  it('renders hosts in ascending-score order (weakest first) regardless of input order', () => {
    render(<WeakestHosts items={items} />);
    const ids = screen.getAllByText(/^host-\d+$/).map((el) => el.textContent);
    expect(ids).toEqual(['host-16', 'host-55', 'host-70']);
  });

  it('renders one meter (BulletBar) per row', () => {
    render(<WeakestHosts items={items} />);
    expect(screen.getAllByRole('meter')).toHaveLength(3);
  });

  it('band-colors the score text: a <50 host uses var(--chart-bypassed)', () => {
    render(<WeakestHosts items={items} />);
    const weakest = screen.getByText('16%');
    expect((weakest as HTMLElement).style.color).toBe('var(--chart-bypassed)');
  });

  it('band-colors a 50-79 host score using var(--chart-warn)', () => {
    render(<WeakestHosts items={items} />);
    const midRange = screen.getByText('55%');
    expect((midRange as HTMLElement).style.color).toBe('var(--chart-warn)');
  });

  it('band-colors a >=80 host score using var(--chart-protected)', () => {
    render(
      <WeakestHosts
        items={[{ hostname: 'host-90', score: 90, protected: 9, unprotected: 1, total: 10 }]}
      />
    );
    const strong = screen.getByText('90%');
    expect((strong as HTMLElement).style.color).toBe('var(--chart-protected)');
  });

  it('renders a legend with critical/at-risk/target markers', () => {
    render(<WeakestHosts items={items} />);
    expect(screen.getByText(/<50% critical/)).toBeInTheDocument();
    expect(screen.getByText(/50–79% at risk/)).toBeInTheDocument();
    expect(screen.getByText(/▏\s*80% target/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no items', () => {
    render(<WeakestHosts items={[]} />);
    expect(screen.getByText('No host data in range.')).toBeInTheDocument();
  });

  it('renders skeleton rows and aria-busy when loading, with no spinner', () => {
    const { container } = render(<WeakestHosts items={[]} loading />);
    const skeletons = container.querySelectorAll('[data-testid="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
