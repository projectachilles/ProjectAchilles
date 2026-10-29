// Elasticsearch readiness of an EDR integration: does the analytics API key
// hold what the integration's sync, enrichment and auto-resolve need?
//
// Test calls checkEdrEs() (read-only: `_has_privileges` + index existence).
// Save and startup call prepareEdrEs(), which also creates the indices, so a
// key that can't write shows up on the Settings card right away instead of as
// a sync that silently never runs. The last result is kept per vendor; a
// not-ready result is re-checked (read-only) at most once a minute, so the
// notice clears on its own once the key is fixed.
import type { Client } from '@elastic/elasticsearch';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { DEFENDER_INDEX, ensureDefenderIndex } from '../defender/index-management.js';
import { CROWDSTRIKE_INDEX, ensureCrowdStrikeIndex } from '../crowdstrike/index-management.js';
import {
  SENTINELONE_INDEX, SENTINELONE_POSTURE_INDEX, ensureSentinelOneIndex, ensureSentinelOnePostureIndex,
} from '../sentinelone/index-management.js';
import { SOPHOS_INDEX, ensureSophosIndex } from '../sophos/index-management.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';
import { configuredVendorKeys } from './vendor-settings.js';

export interface EdrEsPrivilegeGap {
  index: string;
  privileges: string[];
}

export interface EdrEsReadiness {
  status: 'ready' | 'not_ready';
  checked_at: string;
  /** False where the cluster can't report privileges (security disabled): only reachability was checked. */
  privileges_checked: boolean;
  /** Privileges the integration can't work without. */
  missing: EdrEsPrivilegeGap[];
  /** `manage`: without it, mapping updates in a later release don't apply to the existing index. */
  recommended: EdrEsPrivilegeGap[];
  error?: string;
}

interface VendorEs {
  indices: string[];
  ensure: () => Promise<void>;
}

const VENDOR_ES: Record<EdrVendorKey, VendorEs> = {
  defender: { indices: [DEFENDER_INDEX], ensure: ensureDefenderIndex },
  crowdstrike: { indices: [CROWDSTRIKE_INDEX], ensure: ensureCrowdStrikeIndex },
  sentinelone: {
    indices: [SENTINELONE_INDEX, SENTINELONE_POSTURE_INDEX],
    ensure: async () => {
      await ensureSentinelOneIndex();
      await ensureSentinelOnePostureIndex();
    },
  },
  sophos: { indices: [SOPHOS_INDEX], ensure: ensureSophosIndex },
};

const VENDOR_PRIVILEGES = ['read', 'write', 'view_index_metadata', 'create_index', 'manage'];
const BASE_REQUIRED = ['read', 'write', 'view_index_metadata'];
/** Enrichment writes the `f0rtika.<vendor>_*` verdict flags onto the test result docs. */
const RESULTS_PRIVILEGES = ['read', 'write'];
const RECHECK_AFTER_MS = 60_000;

const lastResult = new Map<EdrVendorKey, EdrEsReadiness>();
const inflight = new Map<EdrVendorKey, Promise<EdrEsReadiness>>();

function statusOf(err: unknown): number | undefined {
  const e = err as { meta?: { statusCode?: number }; statusCode?: number } | null;
  return e?.meta?.statusCode ?? e?.statusCode;
}

function describeEsError(err: unknown): string {
  const reason = (err as { meta?: { body?: { error?: { reason?: unknown } } } } | null)?.meta?.body?.error?.reason;
  const text = reason ? String(reason) : err instanceof Error ? err.message : String(err);
  return text.split('\n')[0].slice(0, 300);
}

function resultsNames(pattern: string | undefined): string[] {
  const names = (pattern ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? names : ['achilles-results-*'];
}

/** null when the cluster refuses to say (403). */
async function indexExists(client: Client, index: string): Promise<boolean | null> {
  try {
    return await client.indices.exists({ index });
  } catch (err) {
    if (statusOf(err) === 403) return null;
    throw err;
  }
}

/**
 * Read-only: what the key can do, and whether the indices exist. Never throws.
 * `refreshStored` (Test) replaces the stored result of a vendor that has one,
 * so the Settings notice agrees with the Test result right away.
 */
export async function checkEdrEs(vendor: EdrVendorKey, opts: { refreshStored?: boolean } = {}): Promise<EdrEsReadiness> {
  const result = await runCheck(vendor);
  if (opts.refreshStored && lastResult.has(vendor)) lastResult.set(vendor, result);
  return result;
}

async function runCheck(vendor: EdrVendorKey): Promise<EdrEsReadiness> {
  const checked_at = new Date().toISOString();
  const notReady = (error: string): EdrEsReadiness => ({
    status: 'not_ready', checked_at, privileges_checked: false, missing: [], recommended: [], error,
  });

  try {
    const settings = new SettingsService().getSettings();
    if (!settings.configured) return notReady('Elasticsearch is not configured');
    const client = createEsClient(settings);
    const { indices } = VENDOR_ES[vendor];
    const results = resultsNames(settings.indexPattern);

    let granted: Record<string, Record<string, boolean>> | null = null;
    try {
      const res = await client.security.hasPrivileges({
        index: [
          ...indices.map((name) => ({ names: [name], privileges: VENDOR_PRIVILEGES })),
          { names: results, privileges: RESULTS_PRIVILEGES },
        ],
      });
      granted = res.index as Record<string, Record<string, boolean>>;
    } catch (err) {
      if (statusOf(err) === 401) return notReady(`Elasticsearch rejected the API key: ${describeEsError(err)}`);
      // Security disabled (no `_security` endpoint) or similar: fall back to reachability.
    }

    if (!granted) {
      for (const index of indices) await client.indices.exists({ index });
      return { status: 'ready', checked_at, privileges_checked: false, missing: [], recommended: [] };
    }

    const lacks = (index: string, privs: string[]) => privs.filter((p) => granted?.[index]?.[p] !== true);
    const missing: EdrEsPrivilegeGap[] = [];
    const recommended: EdrEsPrivilegeGap[] = [];
    const add = (into: EdrEsPrivilegeGap[], index: string, privileges: string[]) => {
      if (privileges.length > 0) into.push({ index, privileges });
    };

    for (const index of indices) {
      const exists = granted[index]?.view_index_metadata === true ? await indexExists(client, index) : null;
      add(missing, index, lacks(index, exists === true ? BASE_REQUIRED : [...BASE_REQUIRED, 'create_index']));
      add(recommended, index, lacks(index, ['manage']));
    }
    for (const name of results) add(missing, name, lacks(name, RESULTS_PRIVILEGES));

    return { status: missing.length === 0 ? 'ready' : 'not_ready', checked_at, privileges_checked: true, missing, recommended };
  } catch (err) {
    return notReady(describeEsError(err));
  }
}

/** Check, then create the vendor's indices when the key allows it. Stores the result. Never throws. */
export async function prepareEdrEs(vendor: EdrVendorKey): Promise<EdrEsReadiness> {
  let result = await runCheck(vendor);
  if (result.status === 'ready') {
    try {
      await VENDOR_ES[vendor].ensure();
    } catch (err) {
      result = { ...result, status: 'not_ready', error: describeEsError(err) };
    }
  }
  lastResult.set(vendor, result);
  return result;
}

/** Startup: prepare every configured EDR (env-var credentials never go through Save). Never throws. */
export async function prepareConfiguredEdrEs(): Promise<void> {
  let vendors: EdrVendorKey[];
  try {
    vendors = configuredVendorKeys();
  } catch (err) {
    console.warn('[EDR] Elasticsearch readiness check skipped:', err instanceof Error ? err.message : String(err));
    return;
  }
  for (const vendor of vendors) {
    const r = await prepareEdrEs(vendor);
    if (r.status === 'not_ready') {
      const gaps = r.missing.map((m) => `${m.privileges.join('/')} on ${m.index}`).join(', ');
      console.warn(`⚠ ${vendor}: Elasticsearch not ready, sync will fail — ${r.error ?? `missing ${gaps}`}`);
    }
  }
}

/** Last stored result (null before any check); a stale not-ready result is re-checked first. */
export async function getEdrEsReadiness(vendor: EdrVendorKey, now = Date.now()): Promise<EdrEsReadiness | null> {
  const stored = lastResult.get(vendor);
  if (!stored) return null;
  if (stored.status === 'ready' || now - Date.parse(stored.checked_at) < RECHECK_AFTER_MS) return stored;

  let pending = inflight.get(vendor);
  if (!pending) {
    pending = runCheck(vendor).then((r) => {
      lastResult.set(vendor, r);
      return r;
    }).finally(() => inflight.delete(vendor));
    inflight.set(vendor, pending);
  }
  return pending;
}

/** Test hook. */
export function resetEdrEsReadiness(): void {
  lastResult.clear();
  inflight.clear();
}
