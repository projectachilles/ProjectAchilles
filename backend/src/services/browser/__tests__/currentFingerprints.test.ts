import { describe, it, expect, afterEach, vi } from 'vitest';
import type { TestVersionIdentity } from '../../../types/testVersion.js';

const { mockGetService } = vi.hoisted(() => ({ mockGetService: vi.fn() }));
vi.mock('../testVersions.service.js', () => ({ getTestVersionsService: mockGetService }));

const { currentFingerprintMap } = await import('../currentFingerprints.js');

const identity = (fingerprint: string) => ({ fingerprint }) as TestVersionIdentity;

describe('currentFingerprintMap', () => {
  afterEach(() => { vi.restoreAllMocks(); mockGetService.mockReset(); });

  it('maps every synced test to its fingerprint', async () => {
    mockGetService.mockReturnValue({ synced: async () => new Map([['t1', identity('fp-1')], ['t2', identity('fp-2')]]) });
    expect(await currentFingerprintMap()).toEqual(new Map([['t1', 'fp-1'], ['t2', 'fp-2']]));
  });

  it('is undefined without the versions service', async () => {
    mockGetService.mockReturnValue(undefined);
    expect(await currentFingerprintMap()).toBeUndefined();
  });

  it('is undefined when the read fails, and logs only fixed text and the error class', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetService.mockReturnValue({ synced: async () => { throw new TypeError('fatal: https://token@git.example/repo'); } });
    expect(await currentFingerprintMap()).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Could not read the current test versions (%s)', 'TypeError');
  });
});
