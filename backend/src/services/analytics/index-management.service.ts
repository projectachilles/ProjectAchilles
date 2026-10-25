// Index management service — creates and lists ES indices with the canonical
// mapping used by the results ingestion pipeline.

import { SettingsService } from './settings.js';
import { createEsClient } from './client.js';

export interface IndexInfo {
  name: string;
  docsCount: number;
  storeSize: number;
  status: string;
}

export const RESULTS_INDEX_MAPPING = {
  mappings: {
    properties: {
      routing: {
        properties: {
          event_time: { type: 'date' as const },
          oid: { type: 'keyword' as const },
          hostname: { type: 'keyword' as const },
        },
      },
      f0rtika: {
        properties: {
          test_uuid: { type: 'keyword' as const },
          test_name: { type: 'keyword' as const },
          is_protected: { type: 'boolean' as const },
          error_name: { type: 'keyword' as const },
          category: { type: 'keyword' as const },
          subcategory: { type: 'keyword' as const },
          severity: { type: 'keyword' as const },
          techniques: { type: 'keyword' as const },
          tactics: { type: 'keyword' as const },
          target: { type: 'keyword' as const },
          complexity: { type: 'keyword' as const },
          threat_actor: { type: 'keyword' as const },
          tags: { type: 'keyword' as const },
          score: { type: 'float' as const },
          bundle_id: { type: 'keyword' as const },
          bundle_name: { type: 'keyword' as const },
          control_id: { type: 'keyword' as const },
          control_validator: { type: 'keyword' as const },
          control_description: { type: 'text' as const, index: false },
          is_bundle_control: { type: 'boolean' as const },
          defender_detected: { type: 'boolean' as const },
          // Set true only when an alert's evidence contains THIS stage's
          // specific binary (`<uuid>-<control_id>[-<variant>].exe`). Distinct
          // from defender_detected, which is bundle-scoped and so propagates
          // across every stage of a bundle when only one stage was actually
          // detected. Drives the per-stage "Detected" badge in the UI.
          defender_stage_detected: { type: 'boolean' as const },
          // Vendor-confirmed prevention (subset of defender_detected): a
          // matched alert carried a prevention-ish remediationStatus.
          defender_prevented: { type: 'boolean' as const },
          defender_prevention_action: { type: 'keyword' as const },
          // CrowdStrike equivalents of the two Defender flags above, written
          // by CrowdStrikeEnrichmentService (bundle-scoped / stage-scoped).
          crowdstrike_detected: { type: 'boolean' as const },
          crowdstrike_stage_detected: { type: 'boolean' as const },
          // Vendor-confirmed prevention (subset of crowdstrike_detected):
          // a matched alert carried a prevention disposition.
          crowdstrike_prevented: { type: 'boolean' as const },
          crowdstrike_prevention_action: { type: 'keyword' as const },
          // SentinelOne equivalents, written by the SentinelOne enrichment
          // pass (same correlation rules as CrowdStrike).
          sentinelone_detected: { type: 'boolean' as const },
          sentinelone_stage_detected: { type: 'boolean' as const },
          sentinelone_prevented: { type: 'boolean' as const },
          sentinelone_prevention_action: { type: 'keyword' as const },
          tenant_label: { type: 'keyword' as const },
        },
      },
      event: {
        properties: {
          // long, not integer: Windows exit codes are unsigned 32-bit
          // (NTSTATUS/HRESULT-style codes from an EDR kill exceed int32).
          // Indices created before this change keep `integer` — the ingestion
          // path coerces out-of-range codes (see sanitizeExitCode).
          ERROR: { type: 'long' as const },
          ERROR_raw: { type: 'keyword' as const },
        },
      },
    },
  },
};

export async function createResultsIndex(
  indexName: string,
): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured. Configure it in Analytics Settings first.');
  }

  const client = createEsClient(settings);

  try {
    await client.indices.create({
      index: indexName,
      ...RESULTS_INDEX_MAPPING,
    });
    return { created: true, message: `Index "${indexName}" created successfully` };
  } catch (err: unknown) {
    // ES returns 400 with resource_already_exists_exception when the index exists
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) {
      return { created: false, message: `Index "${indexName}" already exists` };
    }
    throw err;
  }
}

export async function listResultsIndices(pattern: string): Promise<IndexInfo[]> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured. Configure it in Analytics Settings first.');
  }

  const client = createEsClient(settings);

  try {
    const response = await client.cat.indices({ index: pattern, format: 'json', bytes: 'b' });
    const indices = Array.isArray(response) ? response : [];

    return indices
      .map((idx) => {
        // Elastic Cloud Serverless returns store.size as "0" — use
        // dataset.size (serverless-only field) as a fallback.
        const record = idx as Record<string, unknown>;
        const storeSize = parseInt(String(idx['store.size'] ?? '0'), 10);
        const datasetSize = parseInt(String(record['dataset.size'] ?? '0'), 10);

        return {
          name: String(idx.index ?? ''),
          docsCount: parseInt(String(idx['docs.count'] ?? '0'), 10),
          storeSize: storeSize || datasetSize,
          status: String(idx.health ?? 'unknown'),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: unknown) {
    // ES returns 404 when no indices match the pattern
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return [];
    }
    throw err;
  }
}
