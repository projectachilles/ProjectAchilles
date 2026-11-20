import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getInstallReadiness: vi.fn() }));
vi.mock('@/services/api/agent', () => ({ agentApi: api }));

import { useInstallReadiness } from '../useInstallReadiness';

const data = {
  any_ready: true,
  platforms: [{ os: 'windows', arch: 'amd64', ready: true, version: '0.7.4', reason: null }],
};

describe('useInstallReadiness', () => {
  beforeEach(() => {
    api.getInstallReadiness.mockReset();
    api.getInstallReadiness.mockResolvedValue(data);
  });

  it('starts loading, then is ready with the data', async () => {
    const { result } = renderHook(() => useInstallReadiness());
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ status: 'ready', data });
  });

  it('is unknown when the request fails', async () => {
    api.getInstallReadiness.mockRejectedValue(new Error('404'));

    const { result } = renderHook(() => useInstallReadiness());

    await waitFor(() => expect(result.current.status).toBe('unknown'));
  });

  it('asks again when the window gets focus', async () => {
    const { result } = renderHook(() => useInstallReadiness());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => { window.dispatchEvent(new Event('focus')); });

    await waitFor(() => expect(api.getInstallReadiness).toHaveBeenCalledTimes(2));
  });

  it('keeps the last good data when a later check fails', async () => {
    const { result } = renderHook(() => useInstallReadiness());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    api.getInstallReadiness.mockRejectedValue(new Error('network'));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(api.getInstallReadiness).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });

    expect(result.current).toMatchObject({ status: 'ready', data });
  });

  it('makes no request while disabled, and stops listening for focus', () => {
    const { result } = renderHook(() => useInstallReadiness(false));

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(api.getInstallReadiness).not.toHaveBeenCalled();
    expect(result.current.status).toBe('loading');
  });

  it('stops listening for focus after unmount', async () => {
    const { result, unmount } = renderHook(() => useInstallReadiness());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    unmount();
    window.dispatchEvent(new Event('focus'));

    expect(api.getInstallReadiness).toHaveBeenCalledTimes(1);
  });
});
