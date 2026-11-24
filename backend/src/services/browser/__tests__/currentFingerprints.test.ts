import { describe, it, expect, afterEach, vi } from 'vitest';
import type { TestVersionIdentity } from '../../../types/testVersion.js';

const { mockGetService } = vi.hoisted(() => ({ mockGetService: vi.fn() }));
vi.mock('../testVersions.service.js', () => ({ getTestVersionsService: mockGetService }));

const { currentFingerprintMap, VERSION_READ_BUDGET_MS } = await import('../currentFingerprints.js');

const identity = (fingerprint: string, commit: string | null) => ({ fingerprint, commit }) as TestVersionIdentity;
// t1 is a library test at a commit; t2 has none (a custom test, or git sync off).
const IDS = new Map([['t1', identity('fp-1', 'c0ffee1')], ['t2', identity('fp-2', null)]]);
const MAP = new Map([['t1', { fingerprint: 'fp-1', commit: 'c0ffee1' }], ['t2', { fingerprint: 'fp-2', commit: null }]]);

/** A versions service whose synced() is `read`; a new object per call, so reads never mix across tests. */
function serviceReading(read: () => Promise<Map<string, TestVersionIdentity>>) {
  const synced = vi.fn(read);
  mockGetService.mockReturnValue({ synced });
  return synced;
}

/** Tracks whether a promise has settled, without awaiting it. */
function track<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T } = { settled: false };
  p.then((v) => { state.settled = true; state.value = v; });
  return state;
}

describe('currentFingerprintMap', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockGetService.mockReset();
  });

  it('maps every synced test to its fingerprint and its commit', async () => {
    serviceReading(async () => IDS);
    expect(await currentFingerprintMap()).toEqual(MAP);
  });

  it('is undefined without the versions service', async () => {
    mockGetService.mockReturnValue(undefined);
    expect(await currentFingerprintMap()).toBeUndefined();
  });

  it('is undefined when the read fails, and logs only fixed text and the error class', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    serviceReading(async () => { throw new TypeError('fatal: https://token@git.example/repo'); });
    expect(await currentFingerprintMap()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Could not read the current test versions (%s)', 'TypeError');
  });

  it('is undefined when synced() throws before returning a promise', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetService.mockReturnValue({ synced: () => { throw new RangeError('boom'); } });
    expect(await currentFingerprintMap()).toBeUndefined();
  });

  it('the bound is 5 s', () => {
    expect(VERSION_READ_BUDGET_MS).toBe(5_000);
  });

  it('two concurrent callers share one underlying read', async () => {
    let resolve!: (ids: Map<string, TestVersionIdentity>) => void;
    const synced = serviceReading(() => new Promise((r) => { resolve = r; }));
    const first = currentFingerprintMap();
    const second = currentFingerprintMap();
    resolve(IDS);
    expect(await first).toEqual(MAP);
    expect(await second).toEqual(MAP);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  it('a call after the read settled starts a new read', async () => {
    const synced = serviceReading(async () => IDS);
    await currentFingerprintMap();
    await currentFingerprintMap();
    expect(synced).toHaveBeenCalledTimes(2);
  });

  describe('with fake timers', () => {
    it('a read that never settles: both callers get undefined at 5,000 ms, and no timer is left', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const synced = serviceReading(() => new Promise(() => {}));
      const a = track(currentFingerprintMap());
      const b = track(currentFingerprintMap());
      await vi.advanceTimersByTimeAsync(VERSION_READ_BUDGET_MS - 1);
      expect(a.settled).toBe(false);
      expect(b.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(a).toEqual({ settled: true, value: undefined });
      expect(b).toEqual({ settled: true, value: undefined });
      expect(vi.getTimerCount()).toBe(0);
      expect(synced).toHaveBeenCalledTimes(1);
      // One line for the read, not one per waiting caller.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Could not read the current test versions (%s)', 'timeout');
    });

    it('a read that settles first clears the timer', async () => {
      vi.useFakeTimers();
      serviceReading(() => new Promise((r) => setTimeout(() => r(IDS), 1_000)));
      const a = track(currentFingerprintMap());
      await vi.advanceTimersByTimeAsync(1_000);
      expect(a).toEqual({ settled: true, value: MAP });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a caller with a 1,000 ms limit gets undefined at 1,000 ms while another still waits and gets the late read', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const synced = serviceReading(() => new Promise((r) => setTimeout(() => r(IDS), 3_000)));
      const short = track(currentFingerprintMap(1_000));
      const long = track(currentFingerprintMap());
      await vi.advanceTimersByTimeAsync(999);
      expect(short.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(short).toEqual({ settled: true, value: undefined });
      expect(long.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(long).toEqual({ settled: true, value: MAP });
      expect(synced).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a limit above the bound is cut to the bound', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      serviceReading(() => new Promise(() => {}));
      const a = track(currentFingerprintMap(60_000));
      await vi.advanceTimersByTimeAsync(VERSION_READ_BUDGET_MS);
      expect(a).toEqual({ settled: true, value: undefined });
    });

    it('a late rejection of an abandoned read is never an unhandled rejection, and is logged once', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        serviceReading(() => new Promise((_, reject) => setTimeout(() => reject(new Error('library unreadable')), VERSION_READ_BUDGET_MS + 1_000)));
        const a = track(currentFingerprintMap());
        const b = track(currentFingerprintMap());
        await vi.advanceTimersByTimeAsync(VERSION_READ_BUDGET_MS);
        expect(a).toEqual({ settled: true, value: undefined });
        expect(b).toEqual({ settled: true, value: undefined });
        await vi.advanceTimersByTimeAsync(2_000);
        vi.useRealTimers();
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).not.toHaveBeenCalled();
        expect(warn.mock.calls).toEqual([
          ['Could not read the current test versions (%s)', 'timeout'],
          ['Could not read the current test versions (%s)', 'Error'],
        ]);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('two callers of one failed read log it once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      serviceReading(async () => { throw new TypeError('x'); });
      expect(await Promise.all([currentFingerprintMap(), currentFingerprintMap()])).toEqual([undefined, undefined]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
