import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AgentSummary } from '@/types/agent';

vi.mock('@/hooks/useMediaQuery', () => ({ useIsDesktop: () => true }));

import AgentList from '../AgentList';

const agent: AgentSummary = {
  id: 'agent-1',
  org_id: 'org-1',
  hostname: 'SBL8973',
  os: 'windows',
  arch: 'amd64',
  agent_version: '0.7.1',
  status: 'active',
  runtime_status: 'idle',
  last_heartbeat: null,
  tags: ['s1'],
  is_online: true,
  health_score: 39,
};

function renderList(onAction = vi.fn(), canDelete = true) {
  render(
    <MemoryRouter>
      <AgentList
        agents={[agent]}
        selectedAgents={[]}
        latestVersions={new Map()}
        canDelete={canDelete}
        onToggleSelect={vi.fn()}
        onToggleSelectAll={vi.fn()}
        onAction={onAction}
        onSelectAgent={vi.fn()}
      />
    </MemoryRouter>,
  );
  return onAction;
}

describe('AgentList actions menu', () => {
  it('renders outside the table so its scroll container cannot clip it', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for SBL8973' }));
    const item = await screen.findByRole('menuitem', { name: /rotate api key/i });
    expect(item.closest('table')).toBeNull();
  });

  it('dispatches the chosen action for that agent', async () => {
    const onAction = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for SBL8973' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /rotate api key/i }));
    expect(onAction).toHaveBeenCalledWith('agent-1', 'rotate-key');
  });

  it('hides the destructive actions without delete permission', async () => {
    renderList(vi.fn(), false);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for SBL8973' }));
    expect(await screen.findByRole('menuitem', { name: /disable/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /rotate api key/i })).toBeNull();
  });
});
