import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HeartbeatSparkline } from '../HeartbeatSparkline';
import { agentApi } from '@/services/api/agent';

vi.mock('@/services/api/agent', () => ({
  agentApi: {
    getBulkHeartbeatBuckets: vi.fn(),
  },
}));

const mockedBulk = vi.mocked(agentApi.getBulkHeartbeatBuckets);

// NOTE: the module keeps a 5-minute bulk cache, so test order matters:
// the failure case runs first (a failed fetch leaves the cache empty),
// then the success cases share one populated cache.
describe('HeartbeatSparkline', () => {
  it('renders a fallback dash when the bulk fetch fails', async () => {
    mockedBulk.mockRejectedValueOnce(new Error('network'));

    const { container, getByText } = render(
      <HeartbeatSparkline agentId="agent-001" online={true} />
    );

    await waitFor(() => expect(getByText('—')).toBeInTheDocument());
    expect(container.querySelector('svg')).toBeNull();
  });

  it('makes ONE bulk request for many sparklines and renders polylines', async () => {
    const buckets = new Array(24).fill(0);
    buckets[23] = 4;
    mockedBulk.mockResolvedValue({ 'agent-001': buckets, 'agent-002': buckets });

    const callsBefore = mockedBulk.mock.calls.length;
    const { container } = render(
      <div>
        <HeartbeatSparkline agentId="agent-001" online={true} />
        <HeartbeatSparkline agentId="agent-002" online={true} />
        <HeartbeatSparkline agentId="agent-003" online={false} />
      </div>
    );

    await waitFor(() =>
      expect(container.querySelectorAll('svg polyline')).toHaveLength(3)
    );
    expect(mockedBulk.mock.calls.length - callsBefore).toBe(1);
  });

  it('renders a flat line for an agent absent from the bulk map', async () => {
    // agent-003 has no heartbeats in the window → zero buckets → flat polyline
    const { container } = render(
      <HeartbeatSparkline agentId="agent-003" online={false} />
    );

    await waitFor(() =>
      expect(container.querySelector('svg polyline')).not.toBeNull()
    );
    const line = container.querySelector('svg polyline')!;
    expect(line.getAttribute('stroke')).toBe('var(--faint)');
  });
});
