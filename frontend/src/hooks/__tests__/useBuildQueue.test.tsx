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
    expect(result.current.state).toMatchObject({ status: 'running', total: 2, end: null });
    await waitFor(() => expect(result.current.state.current).toEqual(A));
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => gates[0]());
    await waitFor(() => expect(result.current.state.current).toEqual(B));
    expect(result.current.state.results).toHaveLength(1);
    await waitFor(() => expect(gates).toHaveLength(2));
    act(() => gates[1]());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(result.current.state.current).toBeNull();
    expect(result.current.state.end).toBe('completed');
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
    await waitFor(() => expect(result.current.state.current).toEqual(A));
    expect(result.current.state.results).toEqual([]);
    expect(buildTest).toHaveBeenCalledTimes(1);
    expect(buildTest.mock.calls[0][0]).toBe('a');
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
    expect(result.current.state.end).toBe('stopped');
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
    expect(result.current.state).toMatchObject({ status: 'idle', results: [], total: 0, current: null, end: null });
  });

  it('guards against leaving the page only while a run is active', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const adds = () => add.mock.calls.filter((c) => c[0] === 'beforeunload').length;
    const removes = () => remove.mock.calls.filter((c) => c[0] === 'beforeunload').length;
    const { buildTest, gates } = gated();
    const { result } = setup(buildTest);
    expect(adds()).toBe(0);
    act(() => {
      result.current.start([A, B]);
    });
    expect(adds()).toBe(1);
    const handler = add.mock.calls.find((c) => c[0] === 'beforeunload')![1] as (e: Event) => void;
    const event = { preventDefault: vi.fn(), returnValue: 'unset' };
    handler(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe('');
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => result.current.stop());
    expect(result.current.state.status).toBe('stopping');
    expect(adds()).toBe(1);
    expect(removes()).toBe(0);
    act(() => gates[0]());
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(removes()).toBe(1);
    act(() => result.current.dismiss());
    expect(result.current.state.status).toBe('idle');
    expect(adds()).toBe(1);
    expect(removes()).toBe(1);
  });

  it('unmounting aborts the run: the signal aborts and no further pre-check or build starts', async () => {
    const { buildTest, gates } = gated();
    const getBuildInfo = vi.fn(async () => ({ exists: false }) as BuildInfo);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BuildQueueProvider deps={{ getBuildInfo, getEmbedDependencies: async () => [], buildTest }}>
        {children}
      </BuildQueueProvider>
    );
    const { result, unmount } = renderHook(() => useBuildQueue(), { wrapper });
    act(() => {
      result.current.start([A, B]);
    });
    await waitFor(() => expect(buildTest).toHaveBeenCalledTimes(1));
    const signal = buildTest.mock.calls[0][1].signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    gates[0]();
    await new Promise((r) => setTimeout(r, 20));
    expect(buildTest).toHaveBeenCalledTimes(1);
    expect(getBuildInfo).toHaveBeenCalledTimes(1);
  });

  it('ends in done, never stuck running, when the run throws unexpectedly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps: BuildQueueDeps = {
      getBuildInfo: vi.fn(),
      getEmbedDependencies: vi.fn(async () => []),
      buildTest: vi.fn(async () => built),
    };
    // A rejection value whose inspection throws makes the runner itself throw.
    (deps.getBuildInfo as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(
        new Proxy(new Error('x'), {
          get(target, prop) {
            if (prop === 'response') throw new Error('classifier exploded');
            return Reflect.get(target, prop);
          },
        }),
      ),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BuildQueueProvider deps={deps}>{children}</BuildQueueProvider>
    );
    const { result } = renderHook(() => useBuildQueue(), { wrapper });
    act(() => {
      result.current.start([A]);
    });
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(result.current.state.end).toBe('stopped');
    expect(errors).toHaveBeenCalled();
  });

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useBuildQueue())).toThrow(/BuildQueueProvider/);
  });
});
