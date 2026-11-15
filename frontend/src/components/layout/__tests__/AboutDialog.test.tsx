import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AboutDialog } from '../AboutDialog';
import type { AboutResponse } from '@/types/about';

type Props = Parameters<typeof AboutDialog>[0];

function about(patch: (a: AboutResponse) => void = () => {}): AboutResponse {
  const base: AboutResponse = {
    platform: {
      version: '2.11.0',
      commit: 'ca0b830356d6d2ad',
      commitShort: 'ca0b830',
      branch: 'main',
      status: 'official',
      aheadBy: 0,
      releaseDate: '2026-11-15',
      title: 'Stage Coverage and a Security Round',
      notes: '### Added\n- **Stage coverage card.** Shows how much of each chain is caught.',
      releaseUrl: 'https://github.com/projectachilles/ProjectAchilles/releases/tag/v2.11.0',
    },
    agent: { official: { version: '0.7.4', date: '2026-11-15', notes: '### Security\n- Trusted folder.', source: 'bundled' } },
    latest: { enabled: true, checkedAt: '2026-11-15T12:00:00Z', error: null, platform: null, agent: null },
  };
  patch(base);
  return base;
}

function show(props: Partial<Props> = {}) {
  const all: Props = {
    open: true,
    onOpenChange: () => {},
    about: about(),
    loading: false,
    failed: false,
    canSeeFleet: true,
    fleetLoaded: true,
    canManage: true,
    registeredVersions: [{ version: '0.7.4', platforms: ['windows', 'linux'] }],
    fleetByVersion: [
      { version: '0.7.4', count: 41 },
      { version: '0.7.3', count: 3 },
    ],
    ...props,
  };
  return render(<MemoryRouter><AboutDialog {...all} /></MemoryRouter>);
}

const newerPlatform = (a: AboutResponse) => {
  a.latest.platform = {
    version: '2.11.1',
    publishedAt: '2026-11-20T09:00:00Z',
    notes: '### Fixed\n- A later fix.',
    url: 'https://github.com/projectachilles/ProjectAchilles/releases/tag/v2.11.1',
    newer: true,
  };
};

describe('AboutDialog', () => {
  it('shows an official release with its date and notes', () => {
    show();
    expect(screen.getByText('About ProjectAchilles')).toBeInTheDocument();
    expect(screen.getByText('Official release · Nov 15 2026')).toBeInTheDocument();
    expect(screen.getByText('Release notes for 2.11.0')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument();
    expect(screen.getByText('Last checked: Nov 15 2026')).toBeInTheDocument();
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(screen.getByRole('link', { name: /full changelog/i })).toHaveAttribute(
      'href',
      'https://github.com/projectachilles/ProjectAchilles/releases/tag/v2.11.0',
    );
  });

  it('shows a later build as not official', () => {
    show({ about: about((a) => { a.platform.status = 'ahead'; a.platform.aheadBy = 4; }) });
    expect(screen.getByText('2.11.0 + 4 commits · not an official release')).toBeInTheDocument();
    expect(screen.queryByText(/Official release/)).toBeNull();
  });

  it('says "1 commit" for one', () => {
    show({ about: about((a) => { a.platform.status = 'ahead'; a.platform.aheadBy = 1; }) });
    expect(screen.getByText('2.11.0 + 1 commit · not an official release')).toBeInTheDocument();
  });

  it('makes no official claim when the status is unknown', () => {
    show({ about: about((a) => { a.platform.status = 'unknown'; a.platform.aheadBy = null; }) });
    expect(screen.queryByText(/Official release/)).toBeNull();
    expect(screen.queryByText(/not an official release/)).toBeNull();
    expect(screen.getByText('commit ca0b830')).toBeInTheDocument();
  });

  it('announces a newer platform release and swaps the notes', () => {
    show({ about: about(newerPlatform) });
    expect(screen.getByText('2.11.1 is available')).toBeInTheDocument();
    expect(screen.getByText(/Upgrading is described in the/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "What's new" }));
    expect(screen.getByText("What's new in 2.11.1")).toBeInTheDocument();
    expect(screen.getByText('A later fix.')).toBeInTheDocument();
    expect(screen.queryByText('Release notes for 2.11.0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to 2.11.0' }));
    expect(screen.getByText('Release notes for 2.11.0')).toBeInTheDocument();
  });

  it('lists what is registered here and what the fleet runs', () => {
    show();
    expect(screen.getByText('Official: 0.7.4')).toBeInTheDocument();
    expect(screen.getByText('Registered here: 0.7.4 (windows, linux)')).toBeInTheDocument();
    expect(screen.getByText('Fleet: 41 on 0.7.4 · 3 on 0.7.3')).toBeInTheDocument();
    expect(screen.queryByText(/is not registered on this install/)).toBeNull();
  });

  it('says when the official agent is not registered here, with a link for admins', () => {
    const withNewAgent = about((a) => {
      a.agent.official = { version: '0.7.5', date: '2026-11-20T09:00:00Z', notes: '### Fixed\n- Agent fix.', source: 'online' };
      a.latest.agent = { version: '0.7.5', publishedAt: '2026-11-20T09:00:00Z', notes: '### Fixed\n- Agent fix.', url: 'https://github.com/projectachilles/ProjectAchilles/releases/tag/agent-v0.7.5' };
    });
    const { unmount } = show({ about: withNewAgent });
    expect(screen.getByText(/Official 0\.7\.5 is not registered on this install/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /agents/i })).toHaveAttribute('href', '/agents');
    fireEvent.click(screen.getByRole('button', { name: "What's new in the agent" }));
    expect(screen.getByText("What's new in agent 0.7.5")).toBeInTheDocument();
    expect(screen.getByText('Agent fix.')).toBeInTheDocument();
    unmount();
    show({ about: withNewAgent, canManage: false });
    expect(screen.getByText(/Official 0\.7\.5 is not registered on this install/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /agents/i })).toBeNull();
  });

  it('says "none" when nothing is registered', () => {
    show({ registeredVersions: [], fleetByVersion: [] });
    expect(screen.getByText('Registered here: none')).toBeInTheDocument();
    expect(screen.queryByText(/^Fleet:/)).toBeNull();
  });

  it('hides fleet lines without the agents permission', () => {
    show({ canSeeFleet: false, registeredVersions: [], fleetByVersion: [] });
    expect(screen.getByText('Official: 0.7.4')).toBeInTheDocument();
    expect(screen.queryByText(/Registered here/)).toBeNull();
    expect(screen.queryByText(/^Fleet:/)).toBeNull();
    expect(screen.queryByText(/is not registered on this install/)).toBeNull();
  });

  it('says nothing about registration until the agent data has loaded', () => {
    show({ fleetLoaded: false, registeredVersions: [], fleetByVersion: [] });
    expect(screen.getByText('Official: 0.7.4')).toBeInTheDocument();
    expect(screen.queryByText(/Registered here/)).toBeNull();
    expect(screen.queryByText(/is not registered on this install/)).toBeNull();
  });

  it('omits the official agent line when there is none', () => {
    show({ about: about((a) => { a.agent.official = null; }) });
    expect(screen.queryByText(/^Official:/)).toBeNull();
    expect(screen.getByText('Registered here: 0.7.4 (windows, linux)')).toBeInTheDocument();
  });

  it('says the update check is off', () => {
    show({ about: about((a) => { a.latest = { enabled: false, checkedAt: null, error: null, platform: null, agent: null }; }) });
    expect(screen.getByText('Update check is off')).toBeInTheDocument();
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(screen.queryByText(/Last checked/)).toBeNull();
  });

  it('says it has never reached GitHub', () => {
    show({ about: about((a) => { a.latest.checkedAt = null; a.latest.error = 'network'; }) });
    expect(screen.getByText('Last checked: never (no connection to GitHub)')).toBeInTheDocument();
  });

  it('renders remote notes without images or raw HTML, and opens links in a new tab', () => {
    const hostile = about((a) => {
      newerPlatform(a);
      a.latest.platform!.notes =
        'Intro <script>window.pwned = 1</script> <img src="https://e.example/t.png"> ![pic](https://e.example/a.png) [a link](https://e.example/page)';
    });
    const { baseElement } = show({ about: hostile });
    fireEvent.click(screen.getByRole('button', { name: "What's new" }));
    expect(baseElement.querySelector('img')).toBeNull();
    expect(baseElement.querySelector('script')).toBeNull();
    const link = screen.getByRole('link', { name: 'a link' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a loading line, then an unavailable line when loading failed', () => {
    const { unmount } = show({ about: null, loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    unmount();
    show({ about: null, failed: true });
    expect(screen.getByText('Version information is unavailable.')).toBeInTheDocument();
  });
});
