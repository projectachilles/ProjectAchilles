import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { BuildInfo } from '@/types/test';
import type { BuildQueueDeps } from '@/lib/buildQueue';
import { BuildQueueProvider, useBuildQueue } from '../useBuildQueue';

const built = { exists: true, source: 'built' } as BuildInfo;
const A = { uuid: 'a', name: 'A' };
const B = { uuid: 'b', name: 'B' };

function setup(buildTest: BuildQueueDeps['buildTest']) {
  const deps: BuildQueueDeps = {
    getBuildInfo: vi.fn(async () => ({ exists: false }) as BuildInfo),
    getEmbedDependencies: vi.fn(async () => []),
    buildTest,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BuildQueueProvider deps={deps}>{children}</BuildQueueProvider>
  );
  return renderHook(() => useBuildQueue(), { wrapper });
}

function gated() {
  const gates: Array<() => void> = [];
  const buildTest = vi.fn(
    (_uuid: string, opts: { signal?: AbortSignal }) =>
      new Promise<BuildInfo>((resolve, reject) => {
        gates.push(() => resolve(built));
        opts.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
      }),
  );
  return { buildTest, gates };
}

afterEach(() => vi.restoreAllMocks());

describe('useBuildQueue', () => {
  it('runs idle -> running -> done, tracking current and results', async () => {
    const { buildTest, gates } = gated();
    const { result } = setup(buildTest);
    expect(result.current.state.status).toBe('idle');
    let ok = false;
    act(() => {
      ok = result.current.start([A, B]);
    });
    expect(ok).toBe(true);
    expect(result.current.state).toMatchObject({ status: 'running', total: 2 });
    await waitFor(() => expect(result.current.state.current).toEqual(A));
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => gates[0]());
    await waitFor(() => expect(result.current.state.current).toEqual(B));
    expect(result.current.state.results).toHaveLength(1);
    await waitFor(() => expect(gates).toHaveLength(2));
    act(() => gates[1]());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(result.current.state.current).toBeNull();
    expect(result.current.state.results.map((r) => r.outcome)).toEqual(['built', 'built']);
  });

  it('refuses start while running and for an empty list', async () => {
    const { buildTest } = gated();
    const { result } = setup(buildTest);
    expect(result.current.start([])).toBe(false);
    act(() => {
      result.current.start([A]);
    });
    let second = true;
    act(() => {
      second = result.current.start([B]);
    });
    expect(second).toBe(false);
    expect(result.current.state.total).toBe(1);
  });

  it('stop goes to stopping, then done after the build in progress', async () => {
    const { buildTest, gates } = gated();
    const { result } = setup(buildTest);
    act(() => {
      result.current.start([A, B]);
    });
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => result.current.stop());
    expect(result.current.state.status).toBe('stopping');
    act(() => gates[0]());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(result.current.state.results.map((r) => r.uuid)).toEqual(['a']);
    expect(buildTest).toHaveBeenCalledTimes(1);
  });

  it('dismiss resets done, and does nothing while running', async () => {
    const { buildTest, gates } = gated();
    const { result } = setup(buildTest);
    act(() => {
      result.current.start([A]);
    });
    act(() => result.current.dismiss());
    expect(result.current.state.status).toBe('running');
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => gates[0]());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    act(() => result.current.dismiss());
    expect(result.current.state).toMatchObject({ status: 'idle', results: [], total: 0, current: null });
  });

  it('guards against leaving the page only while a run is active', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { buildTest, gates } = gated();
    const { result } = setup(buildTest);
    expect(add.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(0);
    act(() => {
      result.current.start([A]);
    });
    const call = add.mock.calls.find((c) => c[0] === 'beforeunload');
    expect(call).toBeDefined();
    const handler = call![1] as (e: Event) => void;
    const event = new Event('beforeunload', { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => gates[0]());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(remove.mock.calls.some((c) => c[0] === 'beforeunload' && c[1] === handler)).toBe(true);
  });

  it('aborts the run on unmount without state updates', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { buildTest } = gated();
    const { result, unmount } = setup(buildTest);
    act(() => {
      result.current.start([A, B]);
    });
    await waitFor(() => expect(buildTest).toHaveBeenCalledTimes(1));
    const signal = buildTest.mock.calls[0][1].signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(buildTest).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useBuildQueue())).toThrow(/BuildQueueProvider/);
  });
});
