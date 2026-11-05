import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const caps = vi.hoisted(() => ({ campaigns: false }));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ campaigns: caps.campaigns }) }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: true }) }));
vi.mock('@/hooks/useAppRole', () => ({
  useCanAccessModule: () => true,
  useHasPermission: () => true,
}));
vi.mock('@/hooks/useOutdatedAgentCount', () => ({ useOutdatedAgentCount: () => ({ outdatedCount: 0 }) }));
vi.mock('@/hooks/useAppHotkeys', () => ({ useAppHotkeys: () => undefined }));

import { AppShell } from '../AppShell';

// Campaigns is a section of Tasks (TasksSectionTabs), not a sidebar entry.
describe('AppShell campaigns nav', () => {
  it.each([false, true])('has no Campaigns sidebar entry (capability %s)', (enabled) => {
    caps.campaigns = enabled;
    render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /campaigns/i })).toBeNull();
    expect(screen.getAllByRole('link', { name: /tasks/i }).length).toBeGreaterThan(0);
  });

  it('keeps Tasks highlighted on a campaign run page', () => {
    caps.campaigns = true;
    render(<MemoryRouter initialEntries={['/tasks/campaigns/runs/r1']}><AppShell><div /></AppShell></MemoryRouter>);
    const tasks = screen.getAllByRole('link', { name: /tasks/i });
    expect(tasks.some((a) => a.getAttribute('aria-current') === 'page')).toBe(true);
  });
});
