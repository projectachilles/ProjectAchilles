import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FleetPulseRail } from '../FleetPulseRail';

function renderRail(staleActive: boolean, onStaleFilter = vi.fn()) {
  render(
    <FleetPulseRail
      metrics={null}
      staleCount={26}
      groups={[]}
      activeTag={undefined}
      staleActive={staleActive}
      onTagFilter={vi.fn()}
      onStaleFilter={onStaleFilter}
    />,
  );
  return onStaleFilter;
}

describe('FleetPulseRail attention chip', () => {
  it('shows the stale count as a chip that toggles the stale filter', async () => {
    const onStaleFilter = renderRail(false);
    const chip = screen.getByRole('button', { name: /26\s*stale · 7d/ });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.className).not.toContain('warning');
    await userEvent.click(chip);
    expect(onStaleFilter).toHaveBeenCalledTimes(1);
  });

  it('marks the chip pressed while the filter is on', () => {
    renderRail(true);
    expect(screen.getByRole('button', { name: /stale · 7d/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
