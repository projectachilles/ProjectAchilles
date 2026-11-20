import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  listVersions: vi.fn(),
}));
vi.mock('@/services/api/agent', () => ({ agentApi: api }));

import EnrollmentSection from '../EnrollmentSection';

const ORDER: Array<[PlatformReadiness['os'], PlatformReadiness['arch']]> = [
  ['windows', 'amd64'], ['linux', 'amd64'], ['linux', 'arm64'], ['darwin', 'arm64'], ['darwin', 'amd64'],
];
function readiness(windowsReady: boolean): InstallReadiness {
  const platforms = ORDER.map(([os, arch]): PlatformReadiness => (os === 'windows' && windowsReady
    ? { os, arch, ready: true, version: '0.7.4', reason: null }
    : { os, arch, ready: false, version: null, reason: 'no version' }));
  return { any_ready: windowsReady, platforms };
}
const windowsVersion = (signed: boolean) => ({
  version: '0.7.4', os: 'windows', arch: 'amd64', binary_sha256: 'x', binary_size: 1, release_notes: '',
  mandatory: false, signed, signer_subject: signed ? '/C=XX/O=Acme/CN=Acme Code Signing' : null,
  created_at: '2026-11-20T00:00:00.000Z',
});

const EXPIRES = '2026-12-20T15:00:00.000Z';

// Capture what the download would save.
let savedBlob: Blob | null = null;
let savedName: string | null = null;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

async function openManagementTab() {
  const user = userEvent.setup();
  render(<MemoryRouter><EnrollmentSection orgId="org-1" /></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: /generate token/i }));
  await screen.findByRole('tablist', { name: 'Platform' });
  await user.click(screen.getByRole('tab', { name: 'Management tool' }));
  return user;
}

describe('EnrollmentSection Management tool tab', () => {
  beforeEach(() => {
    savedBlob = null;
    savedName = null;
    URL.createObjectURL = vi.fn((b: Blob) => { savedBlob = b; return 'blob:test'; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedName = this.download;
    });
    api.listTokens.mockResolvedValue([]);
    api.createToken.mockResolvedValue({
      id: 'tok-1', token: 'acht_test0123', org_id: 'org-1', max_uses: 100, use_count: 0,
      expires_at: EXPIRES, created_at: '2026-11-20T15:00:00.000Z',
    });
    api.getConfig.mockResolvedValue({ server_url: 'https://achilles.example.com' });
    api.getInstallReadiness.mockResolvedValue(readiness(true));
    api.listVersions.mockResolvedValue([windowsVersion(true)]);
  });

  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    vi.restoreAllMocks();
  });

  it('is the last tab and not the one selected by default', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><EnrollmentSection orgId="org-1" /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /generate token/i }));
    const tabs = within(await screen.findByRole('tablist', { name: 'Platform' })).getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(tabs[5]).toHaveTextContent('Management tool');
    expect(tabs[5]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel').textContent).toContain('Invoke-WebRequest');
  });

  it('downloads a script named Install-AchillesAgent.ps1 with this token and server in it', async () => {
    const user = await openManagementTab();
    await user.click(screen.getByRole('button', { name: 'Download Install-AchillesAgent.ps1' }));
    expect(savedName).toBe('Install-AchillesAgent.ps1');
    const text = await savedBlob!.text();
    expect(text).toContain('--enroll acht_test0123 --server https://achilles.example.com --install');
    expect(text).toContain("'Acme Code Signing'");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('does not show the script or the token inside the panel', async () => {
    await openManagementTab();
    expect(screen.getByRole('tabpanel').textContent).not.toContain('acht_test0123');
  });

  it('shows the Intune settings, the detection file and the uninstall command', async () => {
    await openManagementTab();
    const panel = screen.getByRole('tabpanel', { name: 'Management tool' });
    expect(panel.textContent).toContain('Run this script using the logged on credentials');
    expect(panel.textContent).toContain('Enforce script signature check');
    expect(panel.textContent).toContain('Run script in 64-bit PowerShell host');
    expect(within(panel).getByText('C:\\F0\\achilles-agent.exe')).toBeInTheDocument();
    expect(within(panel).getByText('C:\\F0\\achilles-agent.exe --uninstall')).toBeInTheDocument();
  });

  it('copies the uninstall command', async () => {
    const user = await openManagementTab();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Copy uninstall command' }));
    expect(writeText).toHaveBeenCalledWith('C:\\F0\\achilles-agent.exe --uninstall');
  });

  it('shows what the created token allows', async () => {
    await openManagementTab();
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('This token allows 100 installs and expires');
    expect(panel.textContent).toContain(new Date(EXPIRES).toLocaleString());
    expect(panel.textContent).toContain('revoke the token when the rollout is done');
  });

  it('says which signer the script requires when the registered agent is signed', async () => {
    await openManagementTab();
    expect(screen.getByRole('tabpanel').textContent).toContain('The script only runs an agent signed by "Acme Code Signing".');
  });

  it('says the script cannot verify an unsigned agent, and the script has no check', async () => {
    api.listVersions.mockResolvedValue([windowsVersion(false)]);
    const user = await openManagementTab();
    expect(screen.getByRole('tabpanel').textContent).toContain('so the script cannot verify what it downloads');
    await user.click(screen.getByRole('button', { name: 'Download Install-AchillesAgent.ps1' }));
    expect(await savedBlob!.text()).not.toContain('Get-AuthenticodeSignature');
  });

  it('links the guide', async () => {
    await openManagementTab();
    expect(screen.getByRole('link', { name: 'Deploying with Intune' })).toHaveAttribute(
      'href', 'https://docs.projectachilles.io/docs/user-guide/agent-management/deploying-with-intune',
    );
  });

  it('offers no script when this server has no Windows agent', async () => {
    api.getInstallReadiness.mockResolvedValue(readiness(false));
    await openManagementTab();
    expect(screen.queryByRole('button', { name: /download install-achillesagent/i })).toBeNull();
    expect(screen.getByRole('tabpanel').textContent).toContain('No agent binary for Windows');
  });

  it('offers no script when the Windows agent could not be checked', async () => {
    api.getInstallReadiness.mockRejectedValue(new Error('404'));
    await openManagementTab();
    expect(screen.queryByRole('button', { name: /download install-achillesagent/i })).toBeNull();
    expect(screen.getByRole('tabpanel').textContent).toContain('Could not check whether this server has a Windows agent');
  });

  it('offers no script while the registered versions are still unknown', async () => {
    api.listVersions.mockRejectedValue(new Error('403'));
    await openManagementTab();
    expect(screen.queryByRole('button', { name: /download install-achillesagent/i })).toBeNull();
  });

  it('offers no script for a server address that cannot be embedded safely', async () => {
    api.getConfig.mockResolvedValue({ server_url: "https://x.example.com/'a" });
    await openManagementTab();
    expect(screen.queryByRole('button', { name: /download install-achillesagent/i })).toBeNull();
    expect(screen.getByRole('tabpanel').textContent).toContain('cannot be put in a script safely');
  });
});
