// The current version (fingerprint and commit) of every synced test, for the result version states
// (Analytics → Executions, the campaign evidence matrix and the execution
// report). Kept out of testVersions.service.ts so callers' tests can mock that
// module's getTestVersionsService and still exercise this rule.
import { getTestVersionsService } from './testVersions.service.js';
import type { TestVersionsService } from './testVersions.service.js';
import type { CurrentTestVersion } from '../../types/testVersion.js';

/** Longest wait for the library read, per caller; a caller may pass a shorter limit. */
export const VERSION_READ_BUDGET_MS = 5_000;

type FingerprintMap = Map<string, CurrentTestVersion> | undefined;

/**
 * The read in flight, shared by every caller that comes while it runs (keyed by
 * the service it reads, so a replaced service starts its own). Cleared when it
 * settles, so the next caller reads again.
 */
let inFlight: { service: TestVersionsService; read: Promise<FingerprintMap>; timedOutLogged: boolean } | undefined;

function warnUnreadable(reason: string): void {
  // Fixed text and the error class only: git messages can carry a remote URL.
  console.warn('Could not read the current test versions (%s)', reason);
}

/** One read of the library. Never rejects: a failure is undefined, logged once for all its callers. */
async function readFingerprints(service: TestVersionsService): Promise<FingerprintMap> {
  try {
    const map = new Map<string, CurrentTestVersion>();
    for (const [uuid, identity] of await service.synced()) {
      map.set(uuid, { fingerprint: identity.fingerprint, commit: identity.commit ?? null });
    }
    return map;
  } catch (err) {
    warnUnreadable(err instanceof Error ? err.name : 'error');
    return undefined;
  }
}

/**
 * Current version of every test the library can read (uuid -> fingerprint and
 * library commit).
 * undefined when the versions service is missing, the read fails, or it takes
 * longer than `limitMs` (at most VERSION_READ_BUDGET_MS): callers then show no
 * state (never a guess). Callers that come while a read runs share it; one that
 * gives up leaves it running for the others.
 */
export async function currentFingerprintMap(limitMs: number = VERSION_READ_BUDGET_MS): Promise<FingerprintMap> {
  const service = getTestVersionsService();
  if (!service) return undefined;
  if (!inFlight || inFlight.service !== service) {
    const entry = { service, read: readFingerprints(service), timedOutLogged: false };
    inFlight = entry;
    void entry.read.finally(() => {
      if (inFlight === entry) inFlight = undefined;
    });
  }
  const entry = inFlight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, Math.min(limitMs, VERSION_READ_BUDGET_MS)));
  });
  try {
    const result = await Promise.race([entry.read, timeout]);
    if (result !== 'timeout') return result;
    if (!entry.timedOutLogged) {
      entry.timedOutLogged = true;
      warnUnreadable('timeout');
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
