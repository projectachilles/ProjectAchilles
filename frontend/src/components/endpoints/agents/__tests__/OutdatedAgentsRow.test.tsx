import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutdatedAgentsRow } from '../OutdatedAgentsRow';

describe('OutdatedAgentsRow', () => {
  it('shows the outdated count as a quiet chip, not an amber banner', () => {
    const { container } = render(<OutdatedAgentsRow outdated={2} total={8} onUpdateAll={vi.fn()} />);
    expect(screen.getByText('attention')).toBeTruthy();
    expect(screen.getByTitle('2 of 8 agent(s) running an outdated version').textContent).toBe('2 of 8 outdated');
    expect(container.innerHTML).not.toContain('bg-warning-dim');
  });

  it('runs Update all for the outdated agents', async () => {
    const onUpdateAll = vi.fn();
    render(<OutdatedAgentsRow outdated={2} total={8} onUpdateAll={onUpdateAll} />);
    await userEvent.click(screen.getByRole('button', { name: /update all \(2\)/i }));
    expect(onUpdateAll).toHaveBeenCalledTimes(1);
  });

  it('hides the action without permission, and renders nothing when all are current', () => {
    const { rerender, container } = render(<OutdatedAgentsRow outdated={2} total={8} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<OutdatedAgentsRow outdated={0} total={8} />);
    expect(container.innerHTML).toBe('');
  });
});
