import { SOPHOS_SIEM_GAP_MS } from '../sync.service.js';

/**
 * `from_date` (epoch seconds) for the SIEM events call. Sophos rejects a
 * from_date older than one day (HTTP 400), so the look-back is clamped to the
 * same 23 h the sync service uses.
 */
export function siemFromSeconds(nowMs: number, days: number): number {
  const lookbackMs = Math.min(days * 86_400_000, SOPHOS_SIEM_GAP_MS);
  return Math.floor((nowMs - lookbackMs) / 1000);
}
