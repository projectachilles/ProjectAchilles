// Is a test multi-stage, and what is its bundle name? Shared by the passes
// that write a whole-test result for a run that has no stage docs (EDR-killed
// agent, EDR launch block), so the doc carries bundle_id / bundle_name and is
// scored as one more run of that bundle's pair.
import type { Client } from '@elastic/elasticsearch';
import { getTestMetadata } from '../agent/test-catalog.service.js';
import { resolveTestNames } from '../analytics/test-name-lookup.js';

/**
 * Bundle name per multi-stage test uuid. The test catalog decides; the names
 * in ES only cover uuids the catalog doesn't know (e.g. a test removed from
 * the library since it ran).
 */
export async function resolveBundleNames(client: Client, resultsIndexPattern: string, uuids: string[]): Promise<Map<string, string>> {
  const bundles = new Map<string, string>();
  const unknown: string[] = [];
  for (const uuid of uuids) {
    const meta = getTestMetadata(uuid);
    if (!meta) unknown.push(uuid);
    else if (meta.isMultiStage) bundles.set(uuid, meta.name);
  }
  if (unknown.length > 0) {
    const names = await resolveTestNames(client, resultsIndexPattern, unknown);
    for (const [uuid, n] of names) if (n.kind === 'bundle') bundles.set(uuid, n.name);
  }
  return bundles;
}
