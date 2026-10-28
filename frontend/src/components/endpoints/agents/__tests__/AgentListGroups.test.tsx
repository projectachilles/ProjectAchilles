import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AgentSummary } from '@/types/agent';
import { Toast } from '@/components/shared/ui/Alert';

vi.mock('@/hooks/useMediaQuery', () => ({ useIsDesktop: () => true }));

import AgentList from '../AgentList';

function agent(id: string, tags: string[]): AgentSummary {
  return {
    id,
    org_id: 'org-1',
    hostname: id.toUpperCase(),
    os: 'windows',
    arch: 'amd64',
    agent_version: '0.7.1',
    status: 'active',
    runtime_status: 'idle',
    last_heartbeat: null,
    tags,
    is_online: true,
    health_score: 80,
  };
}

const allTags = [
  { tag: 'cs-falcon', count: 7 },
  { tag: 's1', count: 2 },
];

function renderList(agents: AgentSummary[], extra: { activeTag?: string; onShowGroup?: (tag: string) => void } = {}) {
  render(
    <MemoryRouter>
      <AgentList
        agents={agents}
        selectedAgents={[]}
        latestVersions={new Map()}
        allTags={allTags}
        {...extra}
        onToggleSelect={vi.fn()}
        onToggleSelectAll={vi.fn()}
        onAction={vi.fn()}
        onSelectAgent={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('AgentList group headers', () => {
  it('says when a group has agents beyond this page, and offers the filter', async () => {
    const onShowGroup = vi.fn();
    renderList([agent('a1', ['cs-falcon']), agent('a2', ['cs-falcon']), agent('a3', ['s1']), agent('a4', ['s1'])], { onShowGroup });
    expect(screen.getByText(/2 of 7 shown/)).toBeTruthy();
    // s1 is complete on this page: a plain count, no link
    expect(screen.getByText(/· 2 agents/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'show all 2' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'show all 7' }));
    expect(onShowGroup).toHaveBeenCalledWith('cs-falcon');
  });

  it('groups by the filter tag, so agents whose first tag differs still count under it', () => {
    renderList([agent('a1', ['cs-falcon']), agent('a2', ['finance', 's1']), agent('a3', ['s1'])], { activeTag: 's1' });
    // two groups (cs-falcon, s1 with both agents), not a third "finance" group
    expect(screen.getAllByText(/online$/)).toHaveLength(2);
    expect(screen.getByText(/· 2 agents/)).toBeTruthy();
  });

  it('shows no link for the group that is already the filter', () => {
    renderList([agent('a1', ['cs-falcon'])], { activeTag: 'cs-falcon', onShowGroup: vi.fn() });
    expect(screen.getByText(/1 of 7 shown/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show all/ })).toBeNull();
  });
});

describe('Toast action', () => {
  it('renders a one-click follow-up such as Undo', async () => {
    const onClick = vi.fn();
    render(<Toast variant="success" message='Tags removed "s1" · 1 agent' action={{ label: 'Undo', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
