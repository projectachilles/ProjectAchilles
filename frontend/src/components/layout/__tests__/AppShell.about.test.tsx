import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ about: true, settings: true, agentsLoaded: true }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ about: state.about }) }));
vi.mock('@/hooks/useAnalyticsAuth', () => ({ useAnalyticsAuth: () => ({ configured: true }) }));
vi.mock('@/hooks/useAppRole', () => ({
  useCanAccessModule: (module: string) => (module === 'settings' ? state.settings : true),
  useHasPermission: () => true,
}));
vi.mock('@/hooks/useOutdatedAgentCount', () => ({
  useOutdatedAgentCount: () => ({
    outdatedCount: 0,
    loaded: state.agentsLoaded,
    registeredVersions: state.agentsLoaded ? [{ version: '0.7.4', platforms: ['windows'] }] : [],
    fleetByVersion: state.agentsLoaded ? [{ version: '0.7.4', count: 2 }] : [],
  }),
}));
vi.mock('@/hooks/useAppHotkeys', () => ({ useAppHotkeys: () => undefined }));
vi.mock('@/services/api/about', () => ({ aboutApi: api }));

import { AppShell } from '../AppShell';

const response = (newer: boolean) => ({
  platform: {
    version: '2.11.0', commit: 'ca0b830', commitShort: 'ca0b830', branch: 'main', status: 'official', aheadBy: 0,
    releaseDate: '2026-11-15', title: '', notes: '### Added\n- A card.', releaseUrl: 'https://github.com/x/y/releases/tag/v2.11.0',
  },
  agent: { official: { version: '0.7.4', date: '2026-11-15', notes: '', source: 'bundled' } },
  latest: {
    enabled: true, checkedAt: '2026-11-15T12:00:00Z', error: null, agent: null,
    platform: newer
      ? { version: '2.11.1', publishedAt: '2026-11-20T09:00:00Z', notes: 'later', url: 'https://github.com/x/y/releases/tag/v2.11.1', newer: true }
      : null,
  },
});

const shell = () => render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
// The sidebar renders once for desktop; the mobile sheet is closed.
const aboutButton = () => screen.getByRole('button', { name: /about/i });

describe('AppShell about entry', () => {
  beforeEach(() => {
    localStorage.clear();
    state.about = true;
    state.settings = true;
    state.agentsLoaded = true;
    api.get.mockReset();
    api.get.mockResolvedValue(response(false));
  });

  it('has no about button when the backend does not offer it', () => {
    state.about = false;
    shell();
    expect(screen.queryByRole('button', { name: /about/i })).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('opens the dialog from the sidebar', async () => {
    shell();
    fireEvent.click(aboutButton());
    expect(await screen.findByText('About ProjectAchilles')).toBeInTheDocument();
    expect(await screen.findByText('Official release · Nov 15 2026')).toBeInTheDocument();
  });

  it('shows a dot to a settings user when something newer exists, until About is opened', async () => {
    api.get.mockResolvedValue(response(true));
    shell();
    expect(await screen.findByLabelText('Update available')).toBeInTheDocument();
    fireEvent.click(aboutButton());
    await screen.findByText('2.11.1 is available');
    await waitFor(() => expect(screen.queryByLabelText('Update available')).toBeNull());
  });

  it('shows no dot when nothing is newer', async () => {
    shell();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByLabelText('Update available')).toBeNull();
  });

  it('shows no dot and no "not registered" notice while the agent data is still loading', async () => {
    state.agentsLoaded = false;
    shell();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByLabelText('Update available')).toBeNull();
    fireEvent.click(aboutButton());
    await screen.findByText('Official: 0.7.4');
    expect(screen.queryByText(/is not registered on this install/)).toBeNull();
    expect(screen.queryByText(/Registered here/)).toBeNull();
    expect(screen.queryByLabelText('Update available')).toBeNull();
  });

  it('asks again when About is opened, so a failed first load recovers', async () => {
    api.get.mockRejectedValueOnce(new Error('503'));
    shell();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    fireEvent.click(aboutButton());
    expect(await screen.findByText('Official release · Nov 15 2026')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('asks again on every later open, so a long-lived tab learns of a new release', async () => {
    shell();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    api.get.mockResolvedValue(response(true));
    fireEvent.click(aboutButton());
    expect(await screen.findByText('2.11.1 is available')).toBeInTheDocument();
  });

  it('does not ask or show a dot for a user without settings access, until they open About', async () => {
    state.settings = false;
    api.get.mockResolvedValue(response(true));
    shell();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Update available')).toBeNull();
    fireEvent.click(aboutButton());
    await screen.findByText('2.11.1 is available');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Update available')).toBeNull();
  });
});
