import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InstallReadiness, PlatformReadiness } from '@/types/agent';

const api = vi.hoisted(() => ({
  listTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  getConfig: vi.fn(),
  getInstallReadiness: vi.fn(),
}));
vi.mock('@/services/api/agent', () => ({ agentApi: api }));

import EnrollmentSection from '../EnrollmentSection';

const ORDER: Array<[PlatformReadiness['os'], PlatformReadiness['arch']]> = [
  ['windows', 'amd64'], ['linux', 'amd64'], ['linux', 'arm64'], ['darwin', 'arm64'], ['darwin', 'amd64'],
];

/** Readiness where the listed platforms differ from "no version". */
function readiness(overrides: Record<string, Partial<PlatformReadiness>> = {}): InstallReadiness {
  const platforms = ORDER.map(([os, arch]): PlatformReadiness => ({
    os, arch, ready: false, version: null, reason: 'no version', ...overrides[`${os}/${arch}`],
  }));
  return { any_ready: platforms.some((p) => p.ready), platforms };
}
const ready = (version = '0.7.4'): Partial<PlatformReadiness> => ({ ready: true, version, reason: null });

function renderSection() {
  return render(<MemoryRouter><EnrollmentSection orgId="org-1" /></MemoryRouter>);
}

async function generate() {
  const user = userEvent.setup();
  renderSection();
  await user.click(await screen.findByRole('button', { name: /generate token/i }));
  await screen.findByRole('tablist', { name: 'Platform' });
  return user;
}

describe('EnrollmentSection agent binary readiness', () => {
  beforeEach(() => {
    api.listTokens.mockResolvedValue([]);
    api.createToken.mockReset();
    api.createToken.mockResolvedValue({ id: 'tok-1', token: 'acht_test0123' });
    api.getConfig.mockResolvedValue({ server_url: 'https://achilles.example.com' });
  });

  describe('no platform has a binary', () => {
    beforeEach(() => { api.getInstallReadiness.mockResolvedValue(readiness()); });

    it('warns above the form and links to the Agent settings', async () => {
      renderSection();
      expect(await screen.findByText('No agent binary on this server')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Build or upload an agent' })).toHaveAttribute('href', '/settings?tab=agent');
    });

    it('still generates a token, from a button that says "anyway"', async () => {
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole('button', { name: 'Generate token anyway' }));
      expect(api.createToken).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('acht_test0123')).toBeInTheDocument();
    });

    it('keeps the first platform selected and offers no command to copy on any tab', async () => {
      api.getInstallReadiness.mockResolvedValue(readiness());
      const user = await generate();
      expect(screen.getByRole('tab', { name: /^Windows/ })).toHaveAttribute('aria-selected', 'true');
      for (const tab of screen.getAllByRole('tab')) {
        await user.click(tab);
        expect(screen.queryByRole('button', { name: /copy command/i })).toBeNull();
        expect(screen.getByRole('tabpanel').textContent).not.toContain('--enroll');
      }
    });
  });

  it('does not say the token works for other platforms when none has a binary', async () => {
    api.getInstallReadiness.mockResolvedValue(readiness());
    await generate();
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('This server has no agent for Windows, so the install command would stop at the download with a 404.');
    expect(panel.textContent).not.toContain('works for the other platforms');
  });

  describe('readiness could not be checked', () => {
    beforeEach(() => { api.getInstallReadiness.mockRejectedValue(new Error('404')); });

    it('shows no warning and the plain button', async () => {
      renderSection();
      await screen.findByText(/no tokens found/i);
      expect(screen.queryByText('No agent binary on this server')).toBeNull();
      expect(screen.getByRole('button', { name: 'Generate Token' })).toBeInTheDocument();
    });

    it('shows every command with its Copy button, as before', async () => {
      const user = await generate();
      for (const tab of screen.getAllByRole('tab')) {
        await user.click(tab);
        const panel = screen.getByRole('tabpanel');
        expect(panel.textContent).toContain('--enroll acht_test0123');
        expect(within(panel).getByRole('button', { name: /copy command/i })).toBeInTheDocument();
      }
      expect(screen.queryByText('no binary')).toBeNull();
    });
  });

  it('shows no warning while readiness is still loading', async () => {
    api.getInstallReadiness.mockReturnValue(new Promise(() => {}));
    renderSection();
    await screen.findByText(/no tokens found/i);
    expect(screen.queryByText('No agent binary on this server')).toBeNull();
  });

  describe('some platforms have a binary', () => {
    beforeEach(() => {
      api.getInstallReadiness.mockResolvedValue(readiness({
        'linux/amd64': ready('0.7.4'),
        'darwin/arm64': ready('0.7.3'),
        'darwin/amd64': { ready: false, version: '0.7.2', reason: 'file missing' },
      }));
    });

    it('shows no server-wide warning', async () => {
      await generate();
      expect(screen.queryByText('No agent binary on this server')).toBeNull();
    });

    it('marks each platform with its version or "no binary"', async () => {
      await generate();
      expect(screen.getByRole('tab', { name: 'Linux amd64 0.7.4' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'macOS Apple Silicon 0.7.3' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Windows no binary' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'macOS Intel no binary' })).toBeInTheDocument();
    });

    it('starts on the first platform that has a binary', async () => {
      await generate();
      expect(screen.getByRole('tab', { name: 'Linux amd64 0.7.4' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel').textContent).toContain('os=linux&arch=amd64');
    });

    it('replaces the command of a platform with no version by the reason and a build link', async () => {
      const user = await generate();
      await user.click(screen.getByRole('tab', { name: 'Linux arm64 no binary' }));
      const panel = screen.getByRole('tabpanel');
      expect(within(panel).getByText('No agent binary for Linux arm64')).toBeInTheDocument();
      expect(panel.textContent).toContain('This server has no agent for Linux arm64, so the install command would stop at the download with a 404.');
      expect(within(panel).getByRole('link', { name: 'Build for Linux arm64' })).toHaveAttribute('href', '/settings?tab=agent');
      expect(within(panel).queryByRole('button', { name: /copy command/i })).toBeNull();
      expect(panel.textContent).not.toContain('--enroll');
    });

    it('says the file is gone when the version is registered but not on disk', async () => {
      const user = await generate();
      await user.click(screen.getByRole('tab', { name: 'macOS Intel no binary' }));
      const panel = screen.getByRole('tabpanel');
      expect(panel.textContent).toContain('Agent 0.7.2 for macOS Intel is registered, but its file is gone from the server, so the download would fail. Build or upload it again.');
      expect(within(panel).queryByRole('button', { name: /copy command/i })).toBeNull();
    });

    it('keeps the tab the user picked when readiness is checked again', async () => {
      const user = await generate();
      await user.click(screen.getByRole('tab', { name: 'macOS Apple Silicon 0.7.3' }));
      window.dispatchEvent(new Event('focus'));
      await screen.findByRole('tablist', { name: 'Platform' });
      expect(screen.getByRole('tab', { name: 'macOS Apple Silicon 0.7.3' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
