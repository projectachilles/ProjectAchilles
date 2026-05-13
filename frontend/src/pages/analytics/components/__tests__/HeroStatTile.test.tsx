import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import HeroStatTile from '../HeroStatTile';

function renderInRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('HeroStatTile', () => {
  it('renders title, value, suffix, and subValue', () => {
    renderInRouter(
      <HeroStatTile
        title="Secure Score"
        value="73.4"
        valueSuffix="%"
        subValue="1176 / 1603 pts"
      />
    );

    expect(screen.getByText('Secure Score')).toBeInTheDocument();
    expect(screen.getByText('73.4')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('1176 / 1603 pts')).toBeInTheDocument();
  });

  it('renders a positive delta with green tone by default', () => {
    renderInRouter(<HeroStatTile title="Score" value="73" delta={1.2} deltaLabel="vs 30d" />);

    const deltaNode = screen.getByText(/\+1\.20/);
    expect(deltaNode).toBeInTheDocument();
    expect(deltaNode.className).toContain('text-emerald-500');
    expect(screen.getByText('vs 30d')).toBeInTheDocument();
  });

  it('renders a negative delta with red tone by default', () => {
    renderInRouter(<HeroStatTile title="Score" value="73" delta={-2.4} />);

    const deltaNode = screen.getByText(/−2\.40/);
    expect(deltaNode).toBeInTheDocument();
    expect(deltaNode.className).toContain('text-red-500');
  });

  it('honors deltaTone="negative" override for delta>0 (e.g., more-alerts-is-bad)', () => {
    renderInRouter(
      <HeroStatTile title="Alerts" value="12" delta={3} deltaTone="negative" deltaLabel="vs prev 7d" />
    );

    const deltaNode = screen.getByText(/\+3\.00/);
    expect(deltaNode.className).toContain('text-red-500');
  });

  it('renders the sparkline SVG when sparklineData has 2+ points', () => {
    renderInRouter(
      <HeroStatTile title="Trend" value="50" sparklineData={[10, 20, 30, 25, 40]} />
    );

    expect(screen.getByRole('img', { name: 'Trend trend' })).toBeInTheDocument();
  });

  it('omits the sparkline when data has <2 points', () => {
    renderInRouter(<HeroStatTile title="Trend" value="50" sparklineData={[10]} />);

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the loading spinner when loading=true', () => {
    renderInRouter(<HeroStatTile title="Anything" value="" loading />);

    expect(screen.queryByText('Anything')).toBeNull();
    // The spinner is the only thing rendered — title isn't shown in loading state
  });

  it('renders the error message when error is set', () => {
    renderInRouter(<HeroStatTile title="Anything" value="" error="Something is wrong" />);

    expect(screen.getByText('Something is wrong')).toBeInTheDocument();
    expect(screen.queryByText('Anything')).toBeNull();
  });

  it('wraps the card in a Link when href is provided', () => {
    renderInRouter(<HeroStatTile title="Click me" value="42" href="/settings" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/settings');
    expect(link).toContainElement(screen.getByText('Click me'));
  });

  it('wraps the card in a button and fires onClick when clicked', async () => {
    const onClick = vi.fn();
    renderInRouter(<HeroStatTile title="Alerts" value="12" onClick={onClick} />);

    const button = screen.getByRole('button');
    expect(button).toContainElement(screen.getByText('Alerts'));
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
