// EDR correlation for test outcomes: fetch the Elasticsearch result docs of a
// run's tasks so campaign evidence and notice emails can apply the same Protected > Prevented >
// Detected > Unprotected labels as Analytics. Docs are keyed exactly:
// `_id = <task_id>` for a single result, `<task_id>::<control_id>` per stage.

import type { Client } from '@elastic/elasticsearch';
import { createEsClient } from '../analytics/client.js';
import { SettingsService } from '../analytics/settings.js';
import { EDR_VENDORS } from './vendors.js';

export type EdrStatus = 'ok' | 'unavailable' | 'not_configured';

export interface EdrDocs {
  status: EdrStatus;
  /** _id → _source, for the ids that exist. */
  docs: Map<string, Record<string, unknown>>;
}

const CHUNK = 1000;
const TIMEOUT_MS = 8_000;

export const SOURCE_FIELDS = [
  'event.ERROR',
  'f0rtika.category',
  'f0rtika.is_bundle_control',
  ...EDR_VENDORS.flatMap(({ key }) => [
    `f0rtika.${key}_detected`,
    `f0rtika.${key}_stage_detected`,
    `f0rtika.${key}_prevented`,
    `f0rtika.${key}_prevention_action`,
  ]),
];

let cached: { key: string; client: Client } | null = null;

function clientFor(settings: ReturnType<SettingsService['getSettings']>): Client {
  const key = JSON.stringify(settings);
  if (!cached || cached.key !== key) cached = { key, client: createEsClient(settings) };
  return cached.client;
}

/**
 * Fetch result docs by id. Never throws: an unconfigured or failing
 * Elasticsearch yields `not_configured` / `unavailable` with no docs, and the
 * matrix falls back to exit codes alone.
 */
export async function fetchEdrDocs(ids: string[]): Promise<EdrDocs> {
  const docs = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return { status: 'ok', docs };
  const svc = new SettingsService();
  if (!svc.isConfigured()) return { status: 'not_configured', docs };
  const settings = svc.getSettings();
  try {
    const client = clientFor(settings);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const values = ids.slice(i, i + CHUNK);
      const res = await client.search(
        {
          index: settings.indexPattern,
          size: values.length,
          query: { ids: { values } },
          _source: SOURCE_FIELDS,
          ignore_unavailable: true,
          allow_no_indices: true,
        },
        { requestTimeout: TIMEOUT_MS },
      );
      for (const hit of res.hits.hits) {
        if (hit._id) docs.set(hit._id, (hit._source ?? {}) as Record<string, unknown>);
      }
    }
    return { status: 'ok', docs };
  } catch (err) {
    console.warn('[outcomes] EDR lookup failed:', err instanceof Error ? err.message : err);
    return { status: 'unavailable', docs: new Map() };
  }
}
