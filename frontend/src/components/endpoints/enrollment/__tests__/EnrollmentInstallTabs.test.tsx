import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  listTokens: vi.fn(),
  createToken: vi.fn(),
  revokeToken: vi.fn(),
  getConfig: vi.fn(),
}));
vi.mock('@/services/api/agent', () => ({ agentApi: api }));

import EnrollmentSection from '../EnrollmentSection';

describe('EnrollmentSection install commands', () => {
  beforeEach(() => {
    api.listTokens.mockResolvedValue([]);
    api.createToken.mockResolvedValue({ id: 'tok-1', token: 'acht_test0123' });
    api.getConfig.mockResolvedValue({ server_url: 'https://achilles.example.com' });
  });

  async function generate() {
    const user = userEvent.setup();
    render(<EnrollmentSection orgId="org-1" />);
    await user.click(screen.getByRole('button', { name: /generate token/i }));
    await screen.findByRole('tablist', { name: 'Platform' });
    return user;
  }

  it('shows one platform at a time, Windows first', async () => {
    await generate();
    expect(screen.getByRole('tab', { name: 'Windows' }).getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Invoke-WebRequest');
    expect(panel.textContent).toContain('--enroll acht_test0123');
    expect(screen.queryByText(/os=linux/)).toBeNull();
  });

  it('switches the command with the platform tab', async () => {
    const user = await generate();
    await user.click(screen.getByRole('tab', { name: 'Linux arm64' }));
    const panel = screen.getByRole('tabpanel', { name: 'Linux arm64' });
    expect(panel.textContent).toContain('os=linux&arch=arm64');
    expect(panel.textContent).not.toContain('Invoke-WebRequest');
  });

  it('copies exactly the command that is shown', async () => {
    const user = await generate();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('tab', { name: 'macOS Apple Silicon' }));
    const panel = screen.getByRole('tabpanel');
    await user.click(within(panel).getByRole('button', { name: /copy command/i }));
    expect(writeText).toHaveBeenCalledWith(panel.querySelector('pre')?.textContent);
    expect(writeText.mock.calls[0][0]).toContain('os=darwin&arch=arm64');
  });

  it('lists tokens for its org (the route rejects a list without org_id)', async () => {
    render(<EnrollmentSection orgId="org-1" />);
    await screen.findByText(/no tokens found/i);
    expect(api.listTokens).toHaveBeenCalledWith('org-1');
  });
});
