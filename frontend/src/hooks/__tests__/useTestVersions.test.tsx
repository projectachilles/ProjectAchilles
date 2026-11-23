import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const caps = vi.hoisted(() => ({ testVersions: false }));
vi.mock('../useCapabilities', () => ({ useCapabilities: () => ({ testVersions: caps.testVersions }) }));
vi.mock('@/services/api/browser', () => ({
  browserApi: {
    getTestVersions: vi.fn(async () => ({ library: {}, tests: {} })),
    checkTestUpdates: vi.fn(async () => ({ library: { checkedAt: 'now' }, tests: {} })),
  },
}));

import { browserApi } from '@/services/api/browser';
import { useTestVersions } from '../useTestVersions';

describe('useTestVersions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('makes no request when the capability is off', async () => {
    caps.testVersions = false;
    const { result } = renderHook(() => useTestVersions());
    await act(async () => {
      await result.current.checkNow();
      await result.current.reload();
    });
    expect(browserApi.getTestVersions).not.toHaveBeenCalled();
    expect(browserApi.checkTestUpdates).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('loads on mount and replaces the data on Check now', async () => {
    caps.testVersions = true;
    const { result } = renderHook(() => useTestVersions());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(browserApi.checkTestUpdates).toHaveBeenCalledTimes(1);
    expect(result.current.data?.library.checkedAt).toBe('now');
    expect(result.current.checking).toBe(false);
  });
});
