import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ listAgents: vi.fn(), listVersions: vi.fn() }));
vi.mock('@/services/api/agent', () => ({ agentApi: api }));
vi.mock('../usePolling', () => ({ usePolling: () => {} }));

import { useOutdatedAgentCount } from '../useOutdatedAgentCount';

// 70 agents: the first 50 are current, the last 20 run 0.7.0 (a typical customer fleet).
const fleet = Array.from({ length: 70 }, (_, i) => ({
  id: `a${i}`, os: 'windows', arch: 'amd64', agent_version: i < 50 ? '0.7.1' : '0.7.0',
}));

describe('useOutdatedAgentCount', () => {
  beforeEach(() => {
    api.listVersions.mockResolvedValue([{ os: 'windows', arch: 'amd64', version: '0.7.1' }]);
    // Honour limit/offset like the API; with no limit it would return only 50.
    api.listAgents.mockImplementation(async (p?: { limit?: number; offset?: number }) => {
      const limit = p?.limit ?? 50;
      const offset = p?.offset ?? 0;
      return { agents: fleet.slice(offset, offset + limit), total: fleet.length };
    });
  });

  it('counts outdated agents across the whole fleet, not the first page', async () => {
    const { result } = renderHook(() => useOutdatedAgentCount());
    await waitFor(() => expect(result.current.totalCount).toBe(70));
    expect(result.current.outdatedCount).toBe(20);
    expect(result.current.outdatedIds).toEqual(fleet.slice(50).map((a) => a.id));
  });

  it('keeps paging until it has every agent', async () => {
    api.listAgents.mockImplementation(async (p?: { limit?: number; offset?: number }) => {
      const offset = p?.offset ?? 0;
      return { agents: fleet.slice(offset, offset + 30), total: fleet.length }; // server caps pages at 30
    });
    const { result } = renderHook(() => useOutdatedAgentCount());
    await waitFor(() => expect(result.current.totalCount).toBe(70));
    expect(result.current.outdatedCount).toBe(20);
  });
});
