import { describe, it, expect, vi } from 'vitest';
import { AxiosError } from 'axios';
import type { BuildInfo, EmbedDependency } from '@/types/test';
import {
  runBuildQueue,
  PRECHECK_MAX_ATTEMPTS,
  STOP_POLL_MS,
  SKIP_UPLOADED,
  skipMissingFile,
  type BuildQueueDeps,
  type BuildQueueItem,
} from '../buildQueue';

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({ exists: false, ...over }) as BuildInfo;
const dep = (over: Partial<EmbedDependency> = {}): EmbedDependency => ({
  filename: 'x.bin',
  sourceFile: 'x.bin',
  exists: true,
  sourceBuilt: false,
  ...over,
});
const httpError = (status?: number, data?: unknown) =>
  new AxiosError('http', undefined, undefined, undefined,
    status ? ({ status, data, statusText: '', headers: {}, config: {} } as never) : undefined);
/**
 * Wraps getBuildInfo so each call opens a new "attempt" bucket; the recording
 * sleep adds the slice to the bucket of the attempt that preceded it.
 */
function recorder(impl: BuildQueueDeps['getBuildInfo']) {
  const totals: number[] = [];
  const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>(async (u) => {
    totals.push(0);
    return impl(u);
  });
  const sleep = vi.fn(async (ms: number) => {
    totals[totals.length - 1] += ms;
  });
  return { totals, getBuildInfo, sleep };
}
const items = (n: number): BuildQueueItem[] =>
  Array.from({ length: n }, (_, i) => ({ uuid: `u${i + 1}`, name: `Test ${i + 1}` }));

function makeDeps(over: Partial<BuildQueueDeps> = {}): BuildQueueDeps {
  return {
    getBuildInfo: vi.fn(async () => info()),
    getEmbedDependencies: vi.fn(async () => []),
    buildTest: vi.fn(async () => info({ exists: true, source: 'built' })),
    ...over,
  };
}

describe('runBuildQueue', () => {
  it('builds every item in order, one at a time', async () => {
    const releases: Array<() => void> = [];
    const buildTest = vi.fn(
      () => new Promise<BuildInfo>((resolve) => releases.push(() => resolve(info({ exists: true })))),
    );
    const run = runBuildQueue(items(2), makeDeps({ buildTest }), {});
    await vi.waitFor(() => expect(buildTest).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(buildTest).toHaveBeenCalledTimes(1);
    releases[0]();
    await vi.waitFor(() => expect(buildTest).toHaveBeenCalledTimes(2));
    releases[1]();
    const { results } = await run;
    expect(results.map((r) => [r.uuid, r.outcome])).toEqual([['u1', 'built'], ['u2', 'built']]);
    expect(buildTest.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['u1', 'u2']);
  });

  it('skips an uploaded binary without building', async () => {
    const deps = makeDeps({ getBuildInfo: vi.fn(async () => info({ exists: true, source: 'uploaded' })) });
    const [r] = (await runBuildQueue(items(1), deps, {})).results;
    expect(r).toMatchObject({ outcome: 'skipped', reason: SKIP_UPLOADED });
    expect(deps.buildTest).not.toHaveBeenCalled();
  });

  it('skips a missing external dependency, not a source-built one', async () => {
    const missing = makeDeps({
      getEmbedDependencies: vi.fn(async () => [dep({ filename: 'a.dll', exists: false })]),
    });
    const [r] = (await runBuildQueue(items(1), missing, {})).results;
    expect(r).toMatchObject({ outcome: 'skipped', reason: skipMissingFile(['a.dll']) });
    expect(missing.buildTest).not.toHaveBeenCalled();

    const auto = makeDeps({
      getEmbedDependencies: vi.fn(async () => [dep({ exists: false, sourceBuilt: true })]),
    });
    const [r2] = (await runBuildQueue(items(1), auto, {})).results;
    expect(r2.outcome).toBe('built');
  });

  it('records a failed build with the server message and carries on', async () => {
    const buildTest = vi
      .fn<BuildQueueDeps['buildTest']>()
      .mockRejectedValueOnce({ response: { data: { error: 'go build failed' } }, message: 'Request failed' })
      .mockResolvedValueOnce(info({ exists: true }));
    const { results } = await runBuildQueue(items(2), makeDeps({ buildTest }), {});
    expect(results[0]).toMatchObject({ outcome: 'failed', reason: 'go build failed' });
    expect(results[1].outcome).toBe('built');
  });

  it('falls back to Error.message', async () => {
    const buildTest = vi.fn<BuildQueueDeps['buildTest']>().mockRejectedValueOnce(new Error('boom'));
    const [r] = (await runBuildQueue(items(1), makeDeps({ buildTest }), {})).results;
    expect(r).toMatchObject({ outcome: 'failed', reason: 'boom' });
  });

  it('fails an item when getBuildInfo or getEmbedDependencies rejects, and carries on', async () => {
    const getBuildInfo = vi
      .fn<BuildQueueDeps['getBuildInfo']>()
      .mockRejectedValueOnce(Object.assign(new Error('info down')))
      .mockResolvedValue(info());
    const getEmbedDependencies = vi
      .fn<BuildQueueDeps['getEmbedDependencies']>()
      .mockRejectedValueOnce(new Error('deps down'))
      .mockResolvedValue([]);
    const { results } = await runBuildQueue(items(3), makeDeps({ getBuildInfo, getEmbedDependencies }), {});
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'failed', 'built']);
    expect(results[0].reason).toBe('info down');
    expect(results[1].reason).toBe('deps down');
  });

  it('stops when shouldStop turns true during item 2 of 4', async () => {
    let stop = false;
    const buildTest = vi.fn(async (uuid: string) => {
      if (uuid === 'u2') stop = true;
      return info({ exists: true });
    });
    const { results, end } = await runBuildQueue(items(4), makeDeps({ buildTest }), { shouldStop: () => stop });
    expect(end).toBe('stopped');
    expect(results.map((r) => r.uuid)).toEqual(['u1', 'u2']);
    expect(buildTest).toHaveBeenCalledTimes(2);
  });

  it('ends without recording the item when the signal aborts mid-build', async () => {
    const controller = new AbortController();
    const buildTest = vi.fn(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const onResult = vi.fn();
    const { results, end } = await runBuildQueue(items(3), makeDeps({ buildTest }), { signal: controller.signal, onResult });
    expect(end).toBe('aborted');
    expect(results).toEqual([]);
    expect(onResult).not.toHaveBeenCalled();
    expect(buildTest).toHaveBeenCalledTimes(1);
  });

  it('calls onStart and onResult once per reached item, in order', async () => {
    const events: string[] = [];
    await runBuildQueue(items(2), makeDeps(), {
      onStart: (item, index) => events.push(`start ${item.uuid} ${index}`),
      onResult: (r) => events.push(`result ${r.uuid} ${r.outcome}`),
    });
    expect(events).toEqual(['start u1 0', 'result u1 built', 'start u2 1', 'result u2 built']);
  });

  it('reports completed after a full run', async () => {
    const { end } = await runBuildQueue(items(2), makeDeps(), {});
    expect(end).toBe('completed');
  });

  it('ignores a non-string server error and uses the Error message', async () => {
    const err = Object.assign(new Error('plain'), { response: { data: { error: { nested: true } } } });
    const buildTest = vi.fn<BuildQueueDeps['buildTest']>().mockRejectedValueOnce(err);
    const [r] = (await runBuildQueue(items(1), makeDeps({ buildTest }), {})).results;
    expect(r.reason).toBe('plain');
  });

  describe('pre-check outage handling', () => {
    it('waits with doubling backoff on a transient error, then builds', async () => {
      let n = 0;
      const { totals, getBuildInfo, sleep } = recorder(async () => {
        n += 1;
        if (n === 1) throw httpError(503);
        if (n === 2) throw httpError();
        return info();
      });
      const { results, end } = await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep });
      expect(results[0].outcome).toBe('built');
      expect(end).toBe('completed');
      expect(totals.slice(0, 2)).toEqual([2000, 4000]);
      expect(Math.max(...sleep.mock.calls.map((c) => c[0]))).toBeLessThanOrEqual(STOP_POLL_MS);
    });

    it('caps the wait at 60 s per attempt', async () => {
      let n = 0;
      const { totals, getBuildInfo, sleep } = recorder(async () => {
        n += 1;
        if (n <= 7) throw httpError(502);
        return info();
      });
      await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep });
      expect(totals.slice(0, 7)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    });

    it('retries a 429 without limit', async () => {
      const getEmbedDependencies = vi.fn<BuildQueueDeps['getEmbedDependencies']>();
      for (let i = 0; i < 12; i++) getEmbedDependencies.mockRejectedValueOnce(httpError(429));
      getEmbedDependencies.mockResolvedValue([]);
      const { results } = await runBuildQueue(items(1), makeDeps({ getEmbedDependencies }), { sleep: async () => {} });
      expect(results[0].outcome).toBe('built');
    });

    it('ends the run as unreachable after 8 consecutive transient failures', async () => {
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>().mockResolvedValueOnce(info());
      getBuildInfo.mockRejectedValue(httpError(503));
      const deps = makeDeps({ getBuildInfo });
      const { results, end } = await runBuildQueue(items(3), deps, { sleep: async () => {} });
      expect(end).toBe('unreachable');
      expect(results.map((r) => r.uuid)).toEqual(['u1']);
      expect(getBuildInfo).toHaveBeenCalledTimes(1 + PRECHECK_MAX_ATTEMPTS);
      expect(deps.buildTest).toHaveBeenCalledTimes(1);
    });

    it('fails the item at once on a non-transient error and goes on', async () => {
      const getBuildInfo = vi
        .fn<BuildQueueDeps['getBuildInfo']>()
        .mockRejectedValueOnce(httpError(404, { error: 'No such test' }))
        .mockResolvedValue(info());
      const sleep = vi.fn(async () => {});
      const { results, end } = await runBuildQueue(items(2), makeDeps({ getBuildInfo }), { sleep });
      expect(results.map((r) => r.outcome)).toEqual(['failed', 'built']);
      expect(results[0].reason).toBe('No such test');
      expect(end).toBe('completed');
      expect(sleep).not.toHaveBeenCalled();
    });

    it('a buildTest rejection fails that item and the next pre-check waits out the outage', async () => {
      const buildTest = vi.fn<BuildQueueDeps['buildTest']>()
        .mockRejectedValueOnce(new Error('lost'))
        .mockResolvedValue(info({ exists: true }));
      const getBuildInfo = vi
        .fn<BuildQueueDeps['getBuildInfo']>()
        .mockResolvedValueOnce(info())
        .mockRejectedValueOnce(httpError(503))
        .mockResolvedValue(info());
      const { results } = await runBuildQueue(items(2), makeDeps({ buildTest, getBuildInfo }), { sleep: async () => {} });
      expect(results.map((r) => r.outcome)).toEqual(['failed', 'built']);
    });

    it('Stop during a wait ends the run, item not recorded, no build', async () => {
      let stop = false;
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>().mockRejectedValue(httpError(503));
      const sleep = vi.fn(async () => {
        stop = true;
      });
      const deps = makeDeps({ getBuildInfo });
      const { results, end } = await runBuildQueue(items(2), deps, { sleep, shouldStop: () => stop });
      expect(end).toBe('stopped');
      expect(results).toEqual([]);
      expect(deps.buildTest).not.toHaveBeenCalled();
    });

    it('an abort during a wait ends the run as aborted', async () => {
      const controller = new AbortController();
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>().mockRejectedValue(httpError(503));
      const sleep = vi.fn(async () => {
        controller.abort();
        throw new DOMException('x', 'AbortError');
      });
      const { results, end } = await runBuildQueue(items(1), makeDeps({ getBuildInfo }), {
        sleep,
        signal: controller.signal,
      });
      expect(end).toBe('aborted');
      expect(results).toEqual([]);
    });

    it('Stop pressed during the pre-checks (no wait) never starts that build', async () => {
      let stop = false;
      const getEmbedDependencies = vi.fn(async () => {
        stop = true;
        return [];
      });
      const deps = makeDeps({ getEmbedDependencies });
      const { results, end } = await runBuildQueue(items(2), deps, { shouldStop: () => stop });
      expect(end).toBe('stopped');
      expect(results).toEqual([]);
      expect(deps.buildTest).not.toHaveBeenCalled();
    });
  });

  describe('a refused session', () => {
    it.each([403, 401])('a %i on getBuildInfo ends the run as denied, records nothing for that item and calls nothing else', async (status) => {
      const getBuildInfo = vi
        .fn<BuildQueueDeps['getBuildInfo']>()
        .mockResolvedValueOnce(info())
        .mockRejectedValue(httpError(status, { error: 'Forbidden' }));
      const sleep = vi.fn(async () => {});
      const onResult = vi.fn();
      const deps = makeDeps({ getBuildInfo });
      const { results, end } = await runBuildQueue(items(3), deps, { sleep, onResult });
      expect(end).toBe('denied');
      expect(results.map((r) => [r.uuid, r.outcome])).toEqual([['u1', 'built']]);
      expect(onResult).toHaveBeenCalledTimes(1);
      expect(getBuildInfo).toHaveBeenCalledTimes(2);
      expect(deps.getEmbedDependencies).toHaveBeenCalledTimes(1);
      expect(deps.buildTest).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('a 403 on getEmbedDependencies ends the run as denied too', async () => {
      const getEmbedDependencies = vi.fn<BuildQueueDeps['getEmbedDependencies']>().mockRejectedValue(httpError(403));
      const deps = makeDeps({ getEmbedDependencies });
      const { results, end } = await runBuildQueue(items(2), deps, { sleep: async () => {} });
      expect(end).toBe('denied');
      expect(results).toEqual([]);
      expect(deps.getBuildInfo).toHaveBeenCalledTimes(1);
      expect(deps.buildTest).not.toHaveBeenCalled();
    });

    it('a 404 on getBuildInfo still fails only that item', async () => {
      const getBuildInfo = vi
        .fn<BuildQueueDeps['getBuildInfo']>()
        .mockRejectedValueOnce(httpError(404, { error: 'No such test' }))
        .mockResolvedValue(info());
      const { results, end } = await runBuildQueue(items(2), makeDeps({ getBuildInfo }), { sleep: async () => {} });
      expect(end).toBe('completed');
      expect(results.map((r) => r.outcome)).toEqual(['failed', 'built']);
    });

    it('a 403 from buildTest fails that item and the run goes on, ending at the next pre-check if refused again', async () => {
      const buildTest = vi.fn<BuildQueueDeps['buildTest']>().mockRejectedValue(httpError(403, { error: 'Forbidden' }));
      const getBuildInfo = vi
        .fn<BuildQueueDeps['getBuildInfo']>()
        .mockResolvedValueOnce(info())
        .mockRejectedValue(httpError(403, { error: 'Forbidden' }));
      const deps = makeDeps({ buildTest, getBuildInfo });
      const { results, end } = await runBuildQueue(items(3), deps, { sleep: async () => {} });
      expect(results).toEqual([expect.objectContaining({ uuid: 'u1', outcome: 'failed', reason: 'Forbidden' })]);
      expect(end).toBe('denied');
      expect(getBuildInfo).toHaveBeenCalledTimes(2);
      expect(buildTest).toHaveBeenCalledTimes(1);
    });
  });

  describe('Stop and counting during waits', () => {
    it('Stop is honoured between 1 s slices of a 60 s wait', async () => {
      let stop = false;
      let n = 0;
      let slicesInLastWait = 0;
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>(async () => {
        n += 1;
        slicesInLastWait = 0;
        throw httpError(n <= 6 ? 503 : 429);
      });
      const sleep = vi.fn(async () => {
        // waits 1-6 are short; the 7th (60 s) is the one Stop interrupts
        if (n >= 7) {
          slicesInLastWait += 1;
          if (slicesInLastWait === 3) stop = true;
        }
      });
      const deps = makeDeps({ getBuildInfo });
      const { results, end } = await runBuildQueue(items(2), deps, { sleep, shouldStop: () => stop });
      expect(end).toBe('stopped');
      expect(results).toEqual([]);
      expect(slicesInLastWait).toBe(3);
      expect(sleep.mock.calls.slice(-3).map((c) => (c as unknown[])[0])).toEqual([1000, 1000, 1000]);
      expect(n).toBe(7);
      expect(deps.buildTest).not.toHaveBeenCalled();
    });

    it('a 429 storm ends when Stop is pressed, within the 60 s wait instead of after it', async () => {
      let stop = false;
      let n = 0;
      let slicesInWait = 0;
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>(async () => {
        n += 1;
        slicesInWait = 0;
        throw httpError(429);
      });
      const sleep = vi.fn(async () => {
        // waits 1-5 double from 2 s; the 6th is the first 60 s one, and Stop lands on its 2nd slice
        if (n >= 6) {
          slicesInWait += 1;
          if (slicesInWait === 2) stop = true;
        }
      });
      const { end, results } = await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep, shouldStop: () => stop });
      expect(end).toBe('stopped');
      expect(results).toEqual([]);
      expect(n).toBe(6);
      expect(slicesInWait).toBe(2);
    });

    it('a 429 resets the consecutive-failure count', async () => {
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>();
      for (let i = 0; i < 7; i++) getBuildInfo.mockRejectedValueOnce(httpError(503));
      getBuildInfo.mockRejectedValueOnce(httpError(429)).mockRejectedValueOnce(httpError(503)).mockResolvedValue(info());
      const { end, results } = await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep: async () => {} });
      expect(end).toBe('completed');
      expect(results[0].outcome).toBe('built');
    });

    it('Stop pressed as the 8th transient failure lands ends stopped, not unreachable', async () => {
      let stop = false;
      let calls = 0;
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>(async () => {
        calls += 1;
        if (calls === PRECHECK_MAX_ATTEMPTS) stop = true;
        throw httpError(503);
      });
      const { end } = await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep: async () => {}, shouldStop: () => stop });
      expect(end).toBe('stopped');
    });

    it('a sleep rejection that is not an abort propagates', async () => {
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>().mockRejectedValue(httpError(503));
      const sleep = vi.fn(async () => {
        throw new Error('timer broke');
      });
      await expect(runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep })).rejects.toThrow('timer broke');
    });
  });
});
