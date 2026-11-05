import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const caps = vi.hoisted(() => ({ campaigns: true }));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ campaigns: caps.campaigns }) }));

import { TasksSectionTabs, tasksSectionFromPath } from '../TasksSectionTabs';

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><TasksSectionTabs /></MemoryRouter>);
}

describe('tasksSectionFromPath', () => {
  it.each([
    ['/tasks', 'runs'],
    ['/tasks/', 'runs'],
    ['/tasks/schedules', 'schedules'],
    ['/tasks/campaigns', 'campaigns'],
    ['/tasks/campaigns/runs/r1', 'campaigns'],
    ['/tasks/schedulesX', 'runs'],
  ])('%s -> %s', (path, section) => {
    expect(tasksSectionFromPath(path)).toBe(section);
  });
});

describe('TasksSectionTabs', () => {
  it('links the three sections and marks the current one', () => {
    caps.campaigns = true;
    renderAt('/tasks/campaigns/runs/r1');
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/tasks', '/tasks/schedules', '/tasks/campaigns']);
    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Schedules' })).not.toHaveAttribute('aria-current');
  });

  it('marks Runs on /tasks', () => {
    renderAt('/tasks');
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
  });

  it('hides Campaigns where the backend has no campaigns', () => {
    caps.campaigns = false;
    renderAt('/tasks');
    expect(screen.queryByRole('link', { name: 'Campaigns' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
