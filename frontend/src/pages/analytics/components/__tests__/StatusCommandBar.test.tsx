import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusCommandBar from '../StatusCommandBar';

const baseProps = {
  defenseScore: 52,
  defenseDelta: 1.3,
  actualScore: 51.7,
  edrOnlyScore: 51.9,
  inconclusiveRate: 0.2,
  uniqueEndpoints: 22,
  executedTests: 168,
  bypassedCount: 68,
};

describe('StatusCommandBar', () => {
  it('renders the defense score value', () => {
    render(<StatusCommandBar {...baseProps} />);
    expect(screen.getByText(/52(\.0)?%/)).toBeInTheDocument();
  });

  it('renders a positive delta chip', () => {
    render(<StatusCommandBar {...baseProps} />);
    const chip = screen.getByText(/▲.*1\.3.*7d/);
    expect(chip).toBeInTheDocument();
    expect((chip as HTMLElement).style.color).toBe('var(--success)');
  });

  it('renders a negative delta chip in the bypassed valence color', () => {
    render(<StatusCommandBar {...baseProps} defenseDelta={-2.4} />);
    const chip = screen.getByText(/▼.*2\.4.*7d/);
    expect(chip).toBeInTheDocument();
    expect((chip as HTMLElement).style.color).toBe('var(--chart-bypassed)');
  });

  it('renders the fleet cell — endpoints value and tests caption', () => {
    render(<StatusCommandBar {...baseProps} />);
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText(/endpoints/i)).toBeInTheDocument();
    expect(screen.getByText(/168\s*tests/i)).toBeInTheDocument();
  });

  it('renders the bypassed count in the bypassed valence color', () => {
    render(<StatusCommandBar {...baseProps} bypassedTacticCount={9} />);
    const count = screen.getByText('68');
    expect((count as HTMLElement).style.color).toBe('var(--chart-bypassed)');
    expect(screen.getByText(/bypassed/i)).toBeInTheDocument();
    expect(screen.getByText(/9\s*tactics/i)).toBeInTheDocument();
  });

  it('captions the bypassed count with a unit — "unprotected runs" when no tactic count', () => {
    render(<StatusCommandBar {...baseProps} />);
    expect(screen.getByText(/unprotected runs/i)).toBeInTheDocument();
    // The tactics caption takes precedence when provided
    expect(screen.queryByText(/tactics/i)).not.toBeInTheDocument();
  });

  it('preserves the HeroMetricsCard sub-stat wording: actual, EDR-only, inconclusive', () => {
    render(<StatusCommandBar {...baseProps} excludedCount={4} />);
    expect(screen.getByText(/actual/i)).toBeInTheDocument();
    expect(screen.getByText(/51\.7%/)).toBeInTheDocument();
    expect(screen.getByText(/4 excluded/)).toBeInTheDocument();
    expect(screen.getByText(/EDR-only:\s*51\.9%/)).toBeInTheDocument();
    expect(screen.getByText(/0\.2%\s*inconclusive/)).toBeInTheDocument();
  });

  it('renders the inconclusive line neutral (no valence color) — one-valence-color rule', () => {
    render(<StatusCommandBar {...baseProps} />);
    const line = screen.getByText(/0\.2%\s*inconclusive/);
    // The delta chip is the ONLY valence color in the Defense cell; the
    // inconclusive line must NOT carry the amber --chart-warn signal.
    expect((line as HTMLElement).style.color).not.toBe('var(--chart-warn)');
    expect(line.className).toContain('text-muted-foreground');
  });

  it('hides the EDR-only sub-stat when it equals the defense score', () => {
    render(<StatusCommandBar {...baseProps} edrOnlyScore={52} />);
    expect(screen.queryByText(/EDR-only/)).not.toBeInTheDocument();
  });

  it('renders a BulletBar meter for the defense score', () => {
    render(<StatusCommandBar {...baseProps} />);
    expect(screen.getAllByRole('meter').length).toBeGreaterThanOrEqual(1);
  });

  it('renders an em-dash placeholder when defenseScore is null (not NaN%)', () => {
    render(
      <StatusCommandBar
        {...baseProps}
        defenseScore={null}
        defenseDelta={null}
        actualScore={null}
        edrOnlyScore={null}
        inconclusiveRate={null}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('renders the secure score cell only when secureScore is provided', () => {
    const { rerender } = render(<StatusCommandBar {...baseProps} />);
    expect(screen.queryByText(/Secure Score/i)).not.toBeInTheDocument();
    rerender(<StatusCommandBar {...baseProps} secureScore={73.4} />);
    expect(screen.getByText(/Secure Score/i)).toBeInTheDocument();
    expect(screen.getByText(/73\.4%/)).toBeInTheDocument();
  });

  it('renders the secure score points caption when securePoints is provided', () => {
    render(
      <StatusCommandBar
        {...baseProps}
        secureScore={73.8}
        securePoints={{ current: 1199.5, max: 1625.0 }}
      />
    );
    expect(screen.getByText(/Secure Score/i)).toBeInTheDocument();
    expect(screen.getByText(/73\.8%/)).toBeInTheDocument();
    expect(screen.getByText(/1199\.5\s*\/\s*1625\.0\s*pts/)).toBeInTheDocument();
  });

  it('renders a sparkline when defenseTrend is provided', () => {
    render(<StatusCommandBar {...baseProps} defenseTrend={[40, 45, 48, 50, 52]} />);
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(1);
  });

  it('shows skeletons (not a spinner) and aria-busy when loading', () => {
    const { container } = render(<StatusCommandBar {...baseProps} loading />);
    expect(container.querySelectorAll('[data-testid="skeleton"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
