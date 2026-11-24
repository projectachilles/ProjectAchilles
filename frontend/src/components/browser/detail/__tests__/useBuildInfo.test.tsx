import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { getBuildInfo: vi.fn(), downloadBuild: vi.fn() },
}));
vi.mock('@/services/api/tests', () => ({ testsApi: api }));

const { useBuildInfo } = await import('../useBuildInfo');

beforeEach(() => vi.clearAllMocks());

describe('useBuildInfo', () => {
  it('makes no API call for a null uuid', () => {
    const { result } = renderHook(() => useBuildInfo(null));
    expect(api.getBuildInfo).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.buildInfo).toBeNull();
  });

  it('resets to loading with no build as soon as the uuid changes', async () => {
    api.getBuildInfo.mockResolvedValueOnce({ exists: true, filename: 'a.exe' });
    const { result, rerender } = renderHook(({ id }) => useBuildInfo(id), { initialProps: { id: 'a' } });
    await waitFor(() => expect(result.current.buildInfo?.filename).toBe('a.exe'));

    api.getBuildInfo.mockReturnValueOnce(new Promise(() => {}));
    rerender({ id: 'b' });
    expect(result.current.loading).toBe(true);
    expect(result.current.buildInfo).toBeNull();
  });

  it('counts build requests so the build panel can start one', () => {
    const { result } = renderHook(() => useBuildInfo(null));
    expect(result.current.buildRequest).toBe(0);
    act(() => result.current.requestBuild());
    act(() => result.current.requestBuild());
    expect(result.current.buildRequest).toBe(2);
  });

  it('keeps what the build panel reports', () => {
    const { result } = renderHook(() => useBuildInfo(null));
    expect(result.current.panel).toEqual({ building: false, missingDeps: false });
    act(() => result.current.reportPanel({ building: true, missingDeps: true }));
    expect(result.current.panel).toEqual({ building: true, missingDeps: true });
  });
});
