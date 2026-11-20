import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ consoleIdentity: true }) }));
vi.mock('@/hooks/useAppRole', () => ({ useHasPermission: () => false }));
vi.mock('../components/IntegrationsTab', () => ({ IntegrationsTab: () => <div>integrations-body</div> }));
vi.mock('../components/TestsTab', () => ({ TestsTab: () => <div>tests-body</div> }));
vi.mock('../components/AgentTab', () => ({ AgentTab: () => <div>agent-body</div> }));
vi.mock('../components/UsersTab', () => ({ UsersTab: () => <div>users-body</div> }));
vi.mock('../components/ApiKeysTab', () => ({ ApiKeysTab: () => <div>apikeys-body</div> }));
vi.mock('../components/GeneralTab', () => ({ GeneralTab: () => <div>general-body</div> }));
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => <div /> }));

import SettingsPage from '../SettingsPage';

const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><SettingsPage /></MemoryRouter>);

describe('SettingsPage ?tab=', () => {
  it('opens the Agent tab for ?tab=agent', () => {
    renderAt('/settings?tab=agent');
    expect(screen.getByText('agent-body')).toBeInTheDocument();
  });

  it('falls back to the first visible tab for an unknown value', () => {
    renderAt('/settings?tab=nope');
    expect(screen.getByText('integrations-body')).toBeInTheDocument();
  });

  it('falls back to the first visible tab when the named tab is hidden from this user', () => {
    renderAt('/settings?tab=users');
    expect(screen.getByText('integrations-body')).toBeInTheDocument();
  });

  it('still switches when another tab is clicked', async () => {
    renderAt('/settings?tab=agent');
    await userEvent.setup().click(screen.getByRole('button', { name: /Tests/ }));
    expect(screen.getByText('tests-body')).toBeInTheDocument();
  });
});
