import { describe, it, expect, vi } from 'vitest';
import { AxiosError } from 'axios';
import type { BuildInfo, EmbedDependency } from '@/types/test';
import {
  runBuildQueue,
  PRECHECK_MAX_ATTEMPTS,
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
      const getBuildInfo = vi
        .fn<BuildQueueDeps['getBuildInfo']>()
        .mockRejectedValueOnce(httpError(503))
        .mockRejectedValueOnce(httpError())
        .mockResolvedValue(info());
      const sleep = vi.fn(async () => {});
      const { results, end } = await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep });
      expect(results[0].outcome).toBe('built');
      expect(end).toBe('completed');
      expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 4000]);
    });

    it('caps the wait at 60 s', async () => {
      const getBuildInfo = vi.fn<BuildQueueDeps['getBuildInfo']>();
      for (let i = 0; i < 7; i++) getBuildInfo.mockRejectedValueOnce(httpError(502));
      getBuildInfo.mockResolvedValue(info());
      const sleep = vi.fn(async () => {});
      await runBuildQueue(items(1), makeDeps({ getBuildInfo }), { sleep });
      expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
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
});
