// Which hosts an EDR covers, so its tab's Detected / Prevented counts only
// the test results that EDR could have seen. In a fleet with several EDRs
// (each on its own group of hosts), dividing by every host in the fleet made
// an EDR on a few hosts look like it missed nearly everything.
//
// Source, best first:
//   1. inventory — the EDR's own agent / endpoint list, when the integration
//      stores one (SentinelOne agents, Sophos endpoints);
//   2. alerts — hosts that raised one of its alerts in the last 90 days
//      (CrowdStrike and Defender store no per-host inventory). A host where
//      the EDR is installed but never alerted is left out;
//   3. none — the tab counts every host and says so.

import type { Client } from '@elastic/elasticsearch';
import type { CoverageHostScope, CoverageVendor } from '../analytics/technique-coverage.js';
import { SENTINELONE_POSTURE_INDEX } from '../sentinelone/index-management.js';
import { SOPHOS_INDEX } from '../sophos/index-management.js';

export const ALERT_HOST_DAYS = 90;
const DAY_MS = 86_400_000;
const MAX_HOSTS = 10_000;

type HostBucket = { key: string | number };

/** A missing index (the integration never synced) reads as no hosts; any other error propagates. */
function emptyIfMissing(err: unknown): null {
  const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
  if (status === 404) return null;
  throw err;
}

function bucketKeys(res: unknown): string[] {
  const buckets = ((res as { aggregations?: { hosts?: { buckets?: HostBucket[] } } } | null)
    ?.aggregations?.hosts?.buckets) ?? [];
  return buckets.map((b) => String(b.key)).filter((h) => h.trim() !== '');
}

async function sentinelOneAgents(client: Client): Promise<string[]> {
  const res = await client.search({
    index: SENTINELONE_POSTURE_INDEX,
    size: 0,
    query: { term: { doc_type: 'agent' } },
    aggs: { hosts: { terms: { field: 'computer_name', size: MAX_HOSTS } } },
  }).catch(emptyIfMissing);
  return bucketKeys(res);
}

/** Sophos `endpoint` is a dynamic object, so read the names from _source rather than assume a mapping. */
async function sophosEndpoints(client: Client): Promise<string[]> {
  const res = await client.search({
    index: SOPHOS_INDEX,
    size: MAX_HOSTS,
    query: { term: { doc_type: 'endpoint_health' } },
    _source: ['endpoint.hostname'],
  }).catch(emptyIfMissing);
  const hits = ((res as { hits?: { hits?: Array<{ _source?: { endpoint?: { hostname?: unknown } } }> } } | null)
    ?.hits?.hits) ?? [];
  return hits
    .map((h) => h._source?.endpoint?.hostname)
    .filter((h): h is string => typeof h === 'string' && h.trim() !== '');
}

const INVENTORY: Partial<Record<CoverageVendor, (client: Client) => Promise<string[]>>> = {
  sentinelone: sentinelOneAgents,
  sophos: sophosEndpoints,
};

async function alertHosts(client: Client, alertIndex: string, now: number): Promise<string[]> {
  const res = await client.search({
    index: alertIndex,
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { doc_type: 'alert' } },
          { range: { created_at: { gte: new Date(now - ALERT_HOST_DAYS * DAY_MS).toISOString() } } },
        ],
      },
    },
    aggs: { hosts: { terms: { field: 'evidence_hostnames.keyword', size: MAX_HOSTS } } },
  }).catch(emptyIfMissing);
  return bucketKeys(res);
}

/** The vendor's host scope for technique coverage; undefined when nothing names its hosts. */
export async function resolveVendorHostScope(
  client: Client,
  vendor: CoverageVendor,
  alertIndex: string,
  now: number = Date.now(),
): Promise<CoverageHostScope | undefined> {
  const inventory = INVENTORY[vendor];
  if (inventory) {
    const hostnames = await inventory(client);
    if (hostnames.length > 0) return { source: 'inventory', hostnames };
  }
  const hostnames = await alertHosts(client, alertIndex, now);
  return hostnames.length > 0 ? { source: 'alerts', hostnames } : undefined;
}
