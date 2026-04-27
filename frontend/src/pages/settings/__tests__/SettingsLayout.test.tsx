import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Permission gate — admin-only Users tab needs `settings:users:manage`.
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: () => true,
  useCanAccessModule: () => true,
}));

import { SettingsLayout } from '../SettingsLayout';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<SettingsLayout />}>
          <Route path="/settings/agent" element={<div>AGENT_PAGE</div>} />
          <Route path="/settings/tests" element={<div>TESTS_PAGE</div>} />
          <Route path="/settings/users" element={<div>USERS_PAGE</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('SettingsLayout', () => {
  it('renders the sub-nav with all sections', () => {
    renderAt('/settings/agent');

    // Sub-nav links
    expect(screen.getByRole('link', { name: /Agent/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Tests/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Integrations/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Platform/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Certificate/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Indices/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Users/i })).toBeInTheDocument();
  });

  it('renders the matched sub-route via <Outlet/>', () => {
    renderAt('/settings/agent');
    expect(screen.getByText('AGENT_PAGE')).toBeInTheDocument();
  });

  it('switches outlet content based on the URL', () => {
    renderAt('/settings/tests');
    expect(screen.getByText('TESTS_PAGE')).toBeInTheDocument();
    expect(screen.queryByText('AGENT_PAGE')).not.toBeInTheDocument();
  });

  it('marks the current sub-nav link as active using URL', () => {
    renderAt('/settings/users');

    const usersLink = screen.getByRole('link', { name: /Users/i });
    expect(usersLink).toHaveClass('is-active');

    const agentLink = screen.getByRole('link', { name: /Agent/i });
    expect(agentLink).not.toHaveClass('is-active');
  });

  it('hides the Users link when the user lacks settings:users:manage', async () => {
    vi.resetModules();
    vi.doMock('@/hooks/useAppRole', () => ({
      useHasPermission: () => false,
      useCanAccessModule: () => true,
    }));
    const { SettingsLayout: ScopedLayout } = await import('../SettingsLayout');

    render(
      <MemoryRouter initialEntries={['/settings/agent']}>
        <Routes>
          <Route element={<ScopedLayout />}>
            <Route path="/settings/agent" element={<div>AGENT</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /Users/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agent/i })).toBeInTheDocument();
  });
});
