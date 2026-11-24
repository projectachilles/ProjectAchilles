// The current fingerprint of every synced test, for the result version states
// (Analytics → Executions and the campaign evidence matrix). Kept out of
// testVersions.service.ts so callers' tests can mock that module's
// getTestVersionsService and still exercise this rule.
import { getTestVersionsService } from './testVersions.service.js';

/**
 * Current fingerprint of every test the library can read (uuid -> fingerprint).
 * undefined when the versions service is missing or the read fails: callers
 * then show no state (never a guess).
 */
export async function currentFingerprintMap(): Promise<Map<string, string> | undefined> {
  const service = getTestVersionsService();
  if (!service) return undefined;
  try {
    const map = new Map<string, string>();
    for (const [uuid, identity] of await service.synced()) map.set(uuid, identity.fingerprint);
    return map;
  } catch (err) {
    // Fixed text and the error class only: git messages can carry a remote URL.
    console.warn('Could not read the current test versions (%s)', err instanceof Error ? err.name : 'error');
    return undefined;
  }
}
