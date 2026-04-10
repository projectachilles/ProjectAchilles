// Elasticsearch index management for Defender data.
// Single index "achilles-defender" with a doc_type discriminator.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import type { IndexInfo } from '../analytics/index-management.service.js';

export const DEFENDER_INDEX = 'achilles-defender';

export const DEFENDER_INDEX_MAPPING = {
  mappings: {
    properties: {
      doc_type: { type: 'keyword' as const },
      timestamp: { type: 'date' as const },
      tenant_id: { type: 'keyword' as const },

      // --- Secure Score fields ---
      current_score: { type: 'float' as const },
      max_score: { type: 'float' as const },
      score_percentage: { type: 'float' as const },
      control_scores: {
        type: 'nested' as const,
        properties: {
          name: { type: 'keyword' as const },
          category: { type: 'keyword' as const },
          score: { type: 'float' as const },
        },
      },
      average_comparative_score: { type: 'float' as const },

      // --- Control Profile fields ---
      control_name: { type: 'keyword' as const },
      control_category: { type: 'keyword' as const },
      title: { type: 'text' as const, fields: { keyword: { type: 'keyword' as const } } },
      implementation_cost: { type: 'keyword' as const },
      user_impact: { type: 'keyword' as const },
      rank: { type: 'integer' as const },
      threats: { type: 'keyword' as const },
      deprecated: { type: 'boolean' as const },
      remediation_summary: { type: 'text' as const },
      action_url: { type: 'keyword' as const },
      tier: { type: 'keyword' as const },

      // --- Alert fields ---
      alert_id: { type: 'keyword' as const },
      alert_title: { type: 'text' as const, fields: { keyword: { type: 'keyword' as const } } },
      description: { type: 'text' as const },
      severity: { type: 'keyword' as const },
      status: { type: 'keyword' as const },
      category: { type: 'keyword' as const },
      service_source: { type: 'keyword' as const },
      mitre_techniques: { type: 'keyword' as const },
      created_at: { type: 'date' as const },
      updated_at: { type: 'date' as const },
      resolved_at: { type: 'date' as const },
      recommended_actions: { type: 'text' as const },
      // text + .keyword multi-field: matches the dynamic mapping that ES
      // produced for the original index. Queries must target the .keyword
      // subfield for exact / wildcard matches on hyphenated UUIDs, since
      // the parent text field tokenizes on '-' and '.'.
      evidence_hostnames: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 256 } },
      },
      evidence_filenames: {
        type: 'text' as const,
        fields: { keyword: { type: 'keyword' as const, ignore_above: 256 } },
      },
    },
  },
};

/** Create the Defender index if it doesn't exist. */
export async function createDefenderIndex(): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    await client.indices.create({
      index: DEFENDER_INDEX,
      ...DEFENDER_INDEX_MAPPING,
    });
    return { created: true, message: `Index "${DEFENDER_INDEX}" created successfully` };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) {
      return { created: false, message: `Index "${DEFENDER_INDEX}" already exists` };
    }
    throw err;
  }
}

/** Ensure the Defender index exists (create if missing, no-op if exists). */
export async function ensureDefenderIndex(): Promise<void> {
  await createDefenderIndex();
}

/** List the Defender index info. */
export async function listDefenderIndices(): Promise<IndexInfo[]> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    const response = await client.cat.indices({ index: DEFENDER_INDEX, format: 'json', bytes: 'b' });
    const indices = Array.isArray(response) ? response : [];

    return indices.map((idx) => {
      const record = idx as Record<string, unknown>;
      const storeSize = parseInt(String(idx['store.size'] ?? '0'), 10);
      const datasetSize = parseInt(String(record['dataset.size'] ?? '0'), 10);

      return {
        name: String(idx.index ?? ''),
        docsCount: parseInt(String(idx['docs.count'] ?? '0'), 10),
        storeSize: storeSize || datasetSize,
        status: String(idx.health ?? 'unknown'),
      };
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return [];
    }
    throw err;
  }
}
