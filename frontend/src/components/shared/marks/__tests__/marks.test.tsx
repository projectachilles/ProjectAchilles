import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageSquares } from '../StageSquares';
import { VerdictBar, type BarSegment } from '../VerdictBar';

const segs: BarSegment[] = [
  { key: 'unprotected', label: 'unprotected', tone: 'danger', count: 57 },
  { key: 'protected', label: 'protected', tone: 'accent', count: 212 },
  { key: 'no-verdict', label: 'no verdict', tone: 'warning', count: 0 },
];

describe('StageSquares', () => {
  it('names the strip by its stages and hides the squares from assistive tech', () => {
    const { container } = render(
      <StageSquares
        marks={[
          { tone: 'danger', label: 'not blocked' },
          { tone: 'accent', label: 'blocked' },
          { tone: 'hollow', label: 'skipped' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Stage 1 not blocked, stage 2 blocked, stage 3 skipped' })).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });
});

describe('VerdictBar', () => {
  it('draws one segment per non-zero count, sized by its count', () => {
    render(<VerdictBar segments={segs} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: '57 unprotected' })).toHaveStyle({ flexGrow: '57' });
    expect(screen.getByRole('button', { name: '212 protected' })).toHaveStyle({ flexGrow: '212' });
    expect(screen.queryByRole('button', { name: /no verdict/ })).toBeNull();
  });

  it('writes the counts out in words next to the bar', () => {
    render(<VerdictBar segments={segs} onSelect={() => {}} />);
    expect(screen.getByText('57 unprotected')).toBeInTheDocument();
    expect(screen.getByText('212 protected')).toBeInTheDocument();
    expect(screen.queryByText('0 no verdict')).toBeNull();
  });

  it('reports the clicked segment and marks the active one', async () => {
    const onSelect = vi.fn();
    render(<VerdictBar segments={segs} activeKey="protected" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: '57 unprotected' }));
    expect(onSelect).toHaveBeenCalledWith('unprotected');
    expect(screen.getByRole('button', { name: '212 protected' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '57 unprotected' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('has no buttons when nothing listens for a click', () => {
    render(<VerdictBar segments={segs} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('57 unprotected')).toBeInTheDocument();
  });
});
