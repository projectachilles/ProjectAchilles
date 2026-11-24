import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
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

  function httpError(status: number, error?: string): AxiosError {
    const err = new AxiosError('failed');
    err.response = { status, data: error ? { error } : {} } as AxiosError['response'];
    return err;
  }

  it('reports a failed check, then clears it after a successful one', async () => {
    caps.testVersions = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(browserApi.checkTestUpdates).mockRejectedValueOnce(httpError(500, 'boom'));
    const { result } = renderHook(() => useTestVersions());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.checkError).toBe('Could not check for updates: boom');
    expect(result.current.checking).toBe(false);
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.checkError).toBeNull();
  });

  it('says so for 403 and for an error without a server message', async () => {
    caps.testVersions = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(browserApi.checkTestUpdates)
      .mockRejectedValueOnce(httpError(403))
      .mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useTestVersions());
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.checkError).toBe("You don't have permission to check for updates");
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.checkError).toBe('Could not check for updates: request failed');
  });

  it('treats a 409 as a check already running: re-reads, no error', async () => {
    caps.testVersions = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(browserApi.checkTestUpdates).mockRejectedValueOnce(httpError(409));
    const { result } = renderHook(() => useTestVersions());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.mocked(browserApi.getTestVersions).mockClear();
    await act(async () => {
      await result.current.checkNow();
    });
    expect(result.current.checkError).toBeNull();
    expect(browserApi.getTestVersions).toHaveBeenCalledTimes(1);
  });
});
