import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let perms: Record<string, boolean> = {};
let capIdentity = true;
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ consoleIdentity: capIdentity }) }));
vi.mock('@/hooks/useAppRole', () => ({
  useHasPermission: (p: string) => perms[p] ?? false,
}));
vi.mock('../components/IntegrationsTab', () => ({ IntegrationsTab: () => <div>integrations-body</div> }));
vi.mock('../components/TestsTab', () => ({ TestsTab: () => <div>tests-body</div> }));
vi.mock('../components/AgentTab', () => ({ AgentTab: () => <div>agent-body</div> }));
vi.mock('../components/UsersTab', () => ({ UsersTab: () => <div>users-body</div> }));
vi.mock('../components/ApiKeysTab', () => ({ ApiKeysTab: () => <div>apikeys-body</div> }));
vi.mock('../components/GeneralTab', () => ({ GeneralTab: () => <div>general-body</div> }));
vi.mock('@/components/layout/PageHeader', () => ({ PageHeader: () => <div /> }));

import SettingsPage from '../SettingsPage';

beforeEach(() => {
  perms = {};
  capIdentity = true;
});

describe('SettingsPage General tab', () => {
  it('shows General first and active with settings:platform:write', () => {
    perms = { 'settings:platform:write': true };
    render(<SettingsPage />);
    const tabs = screen.getAllByRole('button');
    expect(tabs[0]).toHaveTextContent('General');
    expect(screen.getByText('general-body')).toBeInTheDocument();
    expect(screen.queryByText('integrations-body')).not.toBeInTheDocument();
  });

  it('hides General when the backend lacks console identity, even with the permission', () => {
    perms = { 'settings:platform:write': true };
    capIdentity = false;
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: /General/ })).not.toBeInTheDocument();
    expect(screen.getByText('integrations-body')).toBeInTheDocument();
  });

  it('hides General and starts on Integrations without it', () => {
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: /General/ })).not.toBeInTheDocument();
    expect(screen.getByText('integrations-body')).toBeInTheDocument();
  });
});
