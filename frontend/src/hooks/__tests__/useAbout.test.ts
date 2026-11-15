import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api/about', () => ({ aboutApi: api }));

import { useAbout } from '../useAbout';

const about = { platform: { version: '2.11.0' }, agent: { official: null }, latest: { enabled: false } };

describe('useAbout', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue(about);
  });

  it('asks nothing while disabled', () => {
    const { result } = renderHook(() => useAbout(false));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ about: null, loading: false, failed: false });
  });

  it('asks once when it becomes enabled', async () => {
    const { result, rerender } = renderHook(({ on }) => useAbout(on), { initialProps: { on: false } });
    rerender({ on: true });
    await waitFor(() => expect(result.current.about).toEqual(about));
    rerender({ on: true });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('reports a failure without data', async () => {
    api.get.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useAbout(true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.about).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('reload asks again', async () => {
    const { result } = renderHook(() => useAbout(true));
    await waitFor(() => expect(result.current.about).toEqual(about));
    act(() => result.current.reload());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});
