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
          is_bundle_control: { type: 'boolean' as const },
        },
      },
      event: {
        properties: {
          ERROR: { type: 'integer' as const },
        },
      },
    },
  },
};

export async function createResultsIndex(
  indexName: string,
): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = await settingsService.getSettings();

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
  const settings = await settingsService.getSettings();

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
