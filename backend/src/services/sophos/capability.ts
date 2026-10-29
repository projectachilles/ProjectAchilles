// One classifier for "this Sophos API surface is not usable", shared by the
// background sync and the POST /test capability probe so they cannot drift.
//
//   403 / SophosPermissionError / forbidden-style GraphQL error -> 'forbidden' (role)
//   explicit licence wording (or HTTP 402)                      -> 'not_licensed'
//   plain 404 (no licence wording)                              -> 'unknown'
//   anything else (5xx, 429, network, "service not available")  -> null (transient)
//
// A bare 404 must never read as "not licensed": it can just be a wrong route
// (a CrowdStrike ZTA bug did exactly that and hid it for weeks).

import { SophosApiError, SophosGraphQLError, SophosPermissionError } from './sophos-client.js';
import type { SophosCapabilityState } from '../../types/sophos.js';

/** Explicit licence/entitlement wording only; a generic "not available" is a transient, not a licence signal. */
const LICENCE_SIGNAL = /not (?:enabled|licen[cs]ed|entitled|subscribed)|no (?:xdr )?licen[cs]e|licen[cs]e (?:is )?(?:required|expired|missing|invalid)|subscription (?:is )?(?:required|expired)|not (?:included in|part of) (?:your|the) (?:licen[cs]e|subscription)/i;
const FORBIDDEN_SIGNAL = /forbidden|unauthori[sz]ed|not authori[sz]ed|permission|access denied/i;

/** The capability state for a failure that means "not usable", or null when the failure is transient / unrelated. */
export function classifyUnavailable(err: unknown): SophosCapabilityState | null {
  if (err instanceof SophosPermissionError) return 'forbidden';
  if (err instanceof SophosApiError) {
    const status = err.statusCode;
    if (status === 403) return 'forbidden';
    if (status >= 500 || status === 429) return null;
    if (status === 402 || LICENCE_SIGNAL.test(err.message)) return 'not_licensed';
    if (status === 404) return 'unknown';
    return null;
  }
  if (err instanceof SophosGraphQLError) {
    if (FORBIDDEN_SIGNAL.test(err.message)) return 'forbidden';
    if (LICENCE_SIGNAL.test(err.message)) return 'not_licensed';
  }
  return null;
}
